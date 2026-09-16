import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildVisionMessages,
  DeepSeekClient,
  DeepSeekTextProvider,
  DeepSeekVisionProvider,
  parseChatCompletion,
  type DeepSeekChatRequest,
} from './deepseek';
import { AiConfigError, AiOutputError, AiProviderError } from './errors';
import { JSON_RETRY_NUDGE } from './prompts';
import type { VisionContext, VisionFrame } from './types';

vi.spyOn(console, 'warn').mockImplementation(() => {});

/** Real reply of deepseek-flash for frames 004+005 of Mintavideok/20260912_213052.mp4 (per-mille boxes). */
const FIXTURE = JSON.parse(readFileSync(new URL('./__fixtures__/deepseek-vision-response.json', import.meta.url), 'utf8'));

const CTX: VisionContext = {
  collectionId: '123456789',
  videoId: 'v1',
  originalFilename: '20260912_213052.mp4',
  sourceSha1: null,
  batchIndex: 0,
  totalBatches: 1,
  locale: 'hu',
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const frame = (index: number): VisionFrame => ({ index, frameId: `f${index}`, jpeg: JPEG, width: 1080, height: 1920, timeSec: index / 2 });

function completion(content: string, extra: { finish?: string; prompt?: number; completion?: number; model?: string } = {}) {
  return {
    id: 'x',
    object: 'chat.completion',
    model: extra.model ?? 'deepseek-flash',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: extra.finish ?? 'stop' }],
    usage: { prompt_tokens: extra.prompt ?? 1000, completion_tokens: extra.completion ?? 200, total_tokens: 1200 },
  };
}

interface Captured {
  url: string;
  init: RequestInit;
  body: DeepSeekChatRequest;
}

function fakeFetch(replies: Array<Response | Error | (() => Response)>) {
  const calls: Captured[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
    const next = replies.shift();
    if (!next) throw new Error('no more replies');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  });
  return { fetchImpl: fn as unknown as typeof fetch, calls };
}

const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });

let sleeps: number[];
function client(fetchImpl: typeof fetch) {
  return new DeepSeekClient({
    apiKey: 'sk-test-key',
    baseUrl: 'https://api.deepseek.test/',
    fetchImpl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });
}

beforeEach(() => {
  sleeps = [];
});

describe('DeepSeekVisionProvider', () => {
  it('sends the OpenAI-compatible request and maps the recorded reply', async () => {
    const { fetchImpl, calls } = fakeFetch([ok(FIXTURE)]);
    const provider = new DeepSeekVisionProvider({ client: client(fetchImpl), model: 'deepseek-flash' });
    const res = await provider.readSpines([frame(4), frame(5)], CTX);

    expect(calls).toHaveLength(1);
    const { url, init, body } = calls[0];
    expect(url).toBe('https://api.deepseek.test/chat/completions');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-test-key');
    expect(body).toMatchObject({
      model: 'deepseek-flash',
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      stream: false,
    });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('"observations"');
    expect(body.messages[0].content).toContain('0..1000');
    const parts = body.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts.map((p) => p.type)).toEqual(['text', 'text', 'image_url', 'text', 'image_url', 'text']);
    expect(parts[1].text).toBe('Frame 1 - 1080 x 1920 px');
    expect(parts[2].image_url!.url).toBe(`data:image/jpeg;base64,${JPEG.toString('base64')}`);

    // 12 raw observations, 2 with empty titles are dropped
    expect(res.observations).toHaveLength(10);
    expect(res.observations[0]).toEqual({
      frame: 4,
      order: 1,
      author: 'Nicholas Christakis',
      title: 'Connected',
      canonicalAuthor: 'Nicholas Christakis',
      canonicalTitle: null,
      publisher: null,
      confidence: 0.65,
      // per-mille → pixels: x × 1.08, y × 1.92
      bbox: { x0: 0, y0: 374, x1: 122, y1: 1690 },
    });
    const last = res.observations[res.observations.length - 1];
    expect(last).toMatchObject({ frame: 5, order: 5, title: 'The Beautiful and Damned', bbox: { x0: 920, y0: 524, x1: 1080, y1: 1642 } });
    expect(res.observations.filter((o) => o.frame === 5).map((o) => o.order)).toEqual([1, 2, 3, 4, 5]);
    expect(res.usage).toEqual({ provider: 'deepseek', model: 'deepseek-flash', inputTokens: 3645, outputTokens: 1193, estCostUsd: 0 });
  });

  it('keeps pixel answers when the reply is clearly in pixels', async () => {
    const reply = completion(
      JSON.stringify({
        observations: [
          { frame: 1, order: 1, author: null, title: 'Capital', canonical_author: null, canonical_title: null, publisher: null, confidence: 0.9, bbox: { x0: 100, y0: 300, x1: 300, y1: 1700 } },
        ],
      }),
    );
    const { fetchImpl } = fakeFetch([ok(reply)]);
    const res = await new DeepSeekVisionProvider({ client: client(fetchImpl), model: 'deepseek-flash' }).readSpines([frame(1)], CTX);
    expect(res.observations[0].bbox).toEqual({ x0: 100, y0: 300, x1: 300, y1: 1700 });
  });

  it('retries invalid JSON once with a "valid JSON only" nudge', async () => {
    const good = completion('```json\n{"observations": [{"frame": 1, "order": 1, "title": "Rokonok", "author": "Móricz Zsigmond", "confidence": 0.9, "bbox": null}]}\n```');
    const { fetchImpl, calls } = fakeFetch([ok(completion('Sorry, here are the books: Rokonok')), ok(good)]);
    const res = await new DeepSeekVisionProvider({ client: client(fetchImpl), model: 'deepseek-flash' }).readSpines([frame(1)], CTX);
    expect(calls).toHaveLength(2);
    const lastParts = calls[1].body.messages[1].content as Array<{ type: string; text?: string }>;
    expect(lastParts[lastParts.length - 1]).toEqual({ type: 'text', text: JSON_RETRY_NUDGE });
    expect(res.observations).toEqual([expect.objectContaining({ title: 'Rokonok', author: 'Móricz Zsigmond', canonicalTitle: null, bbox: null })]);
    expect(res.usage.inputTokens).toBe(2000);
  });

  it('throws AiOutputError after two invalid replies', async () => {
    const { fetchImpl } = fakeFetch([ok(completion('nope')), ok(completion('{"foo": 1}'))]);
    await expect(new DeepSeekVisionProvider({ client: client(fetchImpl), model: 'deepseek-flash' }).readSpines([frame(1)], CTX)).rejects.toBeInstanceOf(
      AiOutputError,
    );
  });

  it('splits a truncated batch once', async () => {
    const half = (title: string) => ok(completion(JSON.stringify({ observations: [{ frame: 2, order: 1, title, author: null, confidence: 0.8, bbox: null }] })));
    const { fetchImpl, calls } = fakeFetch([ok(completion('{"observations": [', { finish: 'length' })), half('A'), half('B')]);
    const res = await new DeepSeekVisionProvider({ client: client(fetchImpl), model: 'deepseek-flash' }).readSpines(
      [frame(1), frame(2), frame(3), frame(4)],
      CTX,
    );
    expect(calls).toHaveLength(3);
    expect((calls[1].body.messages[1].content as unknown[]).length).toBe(6);
    expect(res.observations.map((o) => [o.frame, o.title])).toEqual([
      [2, 'A'],
      [4, 'B'],
    ]);
  });

  it('builds per-frame labels from the stated sizes', () => {
    const msgs = buildVisionMessages([{ ...frame(1), width: 1920, height: 1080 }], { batchIndex: 0, totalBatches: 1 }, 'pixels');
    const parts = msgs[1].content as Array<{ text?: string }>;
    expect(parts[1].text).toBe('Frame 1 - 1920 x 1080 px');
    expect(msgs[0].content).toContain('pixel coordinates of that frame');
    expect(parts[parts.length - 1].text).not.toContain('thousandths');
    const perMille = buildVisionMessages([frame(1), frame(2)], { batchIndex: 0, totalBatches: 1 });
    const last = (perMille[1].content as Array<{ text?: string }>).at(-1)!.text!;
    expect(last).toContain('frames 1 to 2');
    expect(last).toContain('thousandths (0..1000)');
  });

  it('maps a mixed-unit reply (x in pixels, y in thousandths) per axis', async () => {
    const reply = completion(
      JSON.stringify({
        observations: [
          { frame: 1, order: 1, author: 'Arthur C. Clarke', title: 'The Collected Stories', canonical_author: null, canonical_title: null, publisher: null, confidence: 0.95, bbox: { x0: 0, y0: 215, x1: 230, y1: 860 } },
          { frame: 1, order: 2, author: null, title: 'Girls of Riyadh', canonical_author: null, canonical_title: null, publisher: null, confidence: 0.5, bbox: { x0: 905, y0: 270, x1: 1080, y1: 860 } },
        ],
      }),
    );
    const { fetchImpl } = fakeFetch([ok(reply)]);
    const res = await new DeepSeekVisionProvider({ client: client(fetchImpl), model: 'deepseek-flash' }).readSpines([frame(1)], CTX);
    expect(res.observations.map((o) => o.bbox)).toEqual([
      { x0: 0, y0: 413, x1: 230, y1: 1651 },
      { x0: 905, y0: 518, x1: 1080, y1: 1651 },
    ]);
  });
});

describe('DeepSeekClient HTTP handling', () => {
  const body: DeepSeekChatRequest = {
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 10,
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    stream: false,
  };

  it('backs off on 429 and 5xx, honouring Retry-After', async () => {
    const { fetchImpl, calls } = fakeFetch([
      new Response('{"error": {"message": "rate limited"}}', { status: 429, headers: { 'retry-after': '4' } }),
      new Response('oops', { status: 503 }),
      ok(completion('{"a": 1}')),
    ]);
    const res = await client(fetchImpl).chat(body);
    expect(calls).toHaveLength(3);
    expect(res.content).toBe('{"a": 1}');
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(4000);
    expect(sleeps[1]).toBeGreaterThanOrEqual(2400);
  });

  it('gives up after 3 attempts with a retryable AiProviderError', async () => {
    const { fetchImpl, calls } = fakeFetch([
      new Response('x', { status: 500 }),
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      new Response('x', { status: 502 }),
    ]);
    const err = await client(fetchImpl).chat(body).catch((e: unknown) => e);
    expect(calls).toHaveLength(3);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err).toMatchObject({ retryable: true, status: 502 });
  });

  it('does not retry client errors; 401 is a configuration error', async () => {
    const { fetchImpl: f1, calls: c1 } = fakeFetch([new Response('{"error": {"message": "bad"}}', { status: 400 })]);
    await expect(client(f1).chat(body)).rejects.toMatchObject({ name: 'AiProviderError', retryable: false, status: 400 });
    expect(c1).toHaveLength(1);
    const { fetchImpl: f2 } = fakeFetch([new Response('unauthorized', { status: 401 })]);
    await expect(client(f2).chat(body)).rejects.toBeInstanceOf(AiConfigError);
  });

  it('parses usage and tolerates odd completion bodies', () => {
    expect(parseChatCompletion({ choices: [], usage: { prompt_tokens: 'x' } } as never, 'deepseek-flash')).toEqual({
      content: '',
      finishReason: null,
      model: 'deepseek-flash',
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(() => new DeepSeekClient({ apiKey: '', baseUrl: 'https://x' })).toThrow(AiConfigError);
  });
});

describe('DeepSeekTextProvider', () => {
  const book = (i: number) => ({ id: `b${i}`, author: 'Rejtő Jenő', title: `Könyv ${i}`, spineAuthor: null, spineTitle: null, publisher: null });

  it('classifies in chunks of 20 and maps results', async () => {
    const reply = (ids: string[]) =>
      ok(
        completion(
          JSON.stringify({
            books: ids.map((id) => ({
              id,
              known_book: id !== 'b2',
              category: 'humor',
              topics: ['hungarian_literature'],
              author: 'Rejtő Jenő',
              original_title: null,
              language: 'hu',
              original_language: 'hu',
              author_country: 'HU',
              first_published_year: 1941,
              description_hu: 'Kalandregény az idegenlégióról.',
              description_en: 'Adventure novel about the Foreign Legion.',
            })),
          }),
        ),
      );
    const books = Array.from({ length: 23 }, (_, i) => book(i + 1));
    const { fetchImpl, calls } = fakeFetch([
      () => reply(books.slice(0, 20).map((b) => b.id)),
      () => reply(books.slice(20).map((b) => b.id)),
    ]);
    const res = await new DeepSeekTextProvider({ client: client(fetchImpl), model: 'deepseek-flash' }).classifyBooks(books, { locale: 'hu' });
    expect(calls).toHaveLength(2);
    expect(calls[0].body.messages[0].content).toContain('- hungarian_literature: Hungarian literature');
    expect(res.results).toHaveLength(23);
    expect(res.results[0]).toMatchObject({ id: 'b1', category: 'humor', topics: ['hungarian_literature'], firstPublishedYear: 1941, authorCountry: 'HU' });
    expect(res.results[1]).toMatchObject({ id: 'b2', firstPublishedYear: null, descriptionHu: null, descriptionEn: null, language: 'hu' });
    expect(res.usage.inputTokens).toBe(2000);
  });

  it('judges duplicates, defaulting unanswered pairs to false', async () => {
    const { fetchImpl, calls } = fakeFetch([ok(completion('{"answers": [{"id": "q1", "same": true}]}'))]);
    const res = await new DeepSeekTextProvider({ client: client(fetchImpl), model: 'deepseek-v4-pro' }).judgeDuplicates([
      { id: 'q1', a: { author: null, title: 'Az ajtó' }, b: { author: 'Szabó Magda', title: 'Az ajtó' } },
      { id: 'q2', a: { author: null, title: 'A Gyűrűk Ura I' }, b: { author: null, title: 'A Gyűrűk Ura II' } },
    ]);
    expect(calls[0].body.model).toBe('deepseek-v4-pro');
    expect(res.same).toEqual({ q1: true, q2: false });
  });
});
