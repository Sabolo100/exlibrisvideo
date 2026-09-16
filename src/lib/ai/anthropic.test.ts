import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AnthropicTextProvider,
  AnthropicVisionProvider,
  FALLBACK_BETA,
  parseEffort,
  prepareImage,
  supportsDefaultFallbacks,
  usageFromMessage,
} from './anthropic';
import { AiConfigError, AiOutputError, AiProviderError } from './errors';
import { CLASSIFY_SYSTEM_PROMPT, VISION_SYSTEM_PROMPT } from './prompts';
import type { BookForClassification, VisionContext, VisionFrame } from './types';

vi.spyOn(console, 'warn').mockImplementation(() => {});

const CTX: VisionContext = {
  collectionId: '123456789',
  videoId: 'video-1',
  originalFilename: 'shelf.mp4',
  sourceSha1: null,
  batchIndex: 2,
  totalBatches: 5,
  locale: 'hu',
};

let frames: VisionFrame[];

beforeAll(async () => {
  const jpeg = await sharp({ create: { width: 60, height: 100, channels: 3, background: '#884422' } }).jpeg().toBuffer();
  frames = [1, 2, 3, 4].map((i) => ({ index: i, frameId: `f${i}`, jpeg, width: 60, height: 100, timeSec: (i - 1) * 0.5 }));
});

type Json = Record<string, unknown>;

function wireObs(frame: number, title: string, extra: Json = {}): Json {
  return {
    frame,
    order: 1,
    author: 'Szabó Magda',
    title,
    canonical_author: null,
    canonical_title: null,
    publisher: null,
    confidence: 0.9,
    bbox: { x0: 5, y0: 5, x1: 30, y1: 95 },
    ...extra,
  };
}

function message(opts: { parsed?: unknown; text?: string; stop?: string; model?: string; usage?: Json; stopDetails?: Json | null }) {
  const text = opts.text ?? (opts.parsed === undefined ? '' : JSON.stringify(opts.parsed));
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: opts.model ?? 'claude-opus-5',
    content: text ? [{ type: 'text', text, citations: null }] : [],
    stop_reason: opts.stop ?? 'end_turn',
    stop_sequence: null,
    stop_details: opts.stopDetails ?? null,
    container: null,
    context_management: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      service_tier: 'standard',
      ...opts.usage,
    },
  };
}

/** Fake client: `responses` are returned in order (Error instances are thrown). */
function fakeClient(responses: Array<unknown>) {
  const calls: Array<{ params: Json; options: Json | undefined }> = [];
  const parse = vi.fn(async (params: Json, options?: Json) => {
    calls.push({ params, options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('no more fake responses');
    const m = next as ReturnType<typeof message> & { parsed_output?: unknown };
    const text = m.content[0]?.text ?? '';
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { ...m, parsed_output: 'parsed_output' in m ? m.parsed_output : parsed };
  });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, calls, parse };
}

function contentTexts(params: Json): string[] {
  const msgs = params.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
  return msgs[0].content.filter((b) => b.type === 'text').map((b) => b.text!);
}

describe('request shape on the wire (real SDK client, fake fetch)', () => {
  it('sends structured-output vision requests with adaptive thinking, cache control and fallbacks', async () => {
    const requests: Array<{ url: string; headers: Headers; body: Json }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      const reply = message({
        parsed: { observations: [wireObs(2, 'Az ajtó'), wireObs(1, 'Abigél', { bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.9 } })] },
        usage: { input_tokens: 40, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 500 },
      });
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = new Anthropic({ apiKey: 'sk-ant-test', maxRetries: 0, timeout: 180_000, fetch: fetchImpl as typeof fetch });
    const provider = new AnthropicVisionProvider({ client, model: 'claude-opus-5', effort: 'medium' });

    const res = await provider.readSpines(frames.slice(0, 2), CTX);

    expect(requests).toHaveLength(1);
    const { url, headers, body } = requests[0];
    expect(url).toContain('/v1/messages');
    expect(headers.get('x-api-key')).toBe('sk-ant-test');
    expect(headers.get('anthropic-beta')).toContain(FALLBACK_BETA);
    expect(body).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
      fallbacks: 'default',
      system: [{ type: 'text', text: VISION_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    });
    for (const banned of ['betas', 'temperature', 'top_p', 'top_k', 'budget_tokens']) expect(body).not.toHaveProperty(banned);
    const schema = (body.output_config as { format: { schema: Json } }).format.schema;
    expect(schema).toMatchObject({ type: 'object', required: ['observations'], additionalProperties: false });

    const messages = body.messages as Array<{ role: string; content: Array<Json> }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    const types = messages[0].content.map((b) => b.type);
    expect(types).toEqual(['text', 'text', 'image', 'text', 'image', 'text']);
    expect(messages[0].content[1]).toEqual({ type: 'text', text: 'Frame 1 - 60 x 100 px' });
    expect(messages[0].content[3]).toEqual({ type: 'text', text: 'Frame 2 - 60 x 100 px' });
    expect(messages[0].content[2]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: frames[0].jpeg.toString('base64') },
    });
    expect(String(messages[0].content[0].text)).toContain('batch 3 of 5');

    expect(res.observations).toEqual([
      expect.objectContaining({ frame: 1, order: 1, title: 'Abigél', bbox: { x0: 6, y0: 10, x1: 30, y1: 90 } }),
      expect.objectContaining({ frame: 2, order: 1, title: 'Az ajtó', author: 'Szabó Magda', canonicalAuthor: null }),
    ]);
    // 40 uncached + 1000 cache read + 200 cache write; $5/$25 per MTok with 0.1x / 1.25x cache pricing
    expect(res.usage).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5',
      inputTokens: 1240,
      outputTokens: 500,
      estCostUsd: (40 * 5 + 1000 * 0.5 + 200 * 6.25 + 500 * 25) / 1e6,
    });
  });

  it('survives a truncated JSON answer from the real parse helper and splits the batch', async () => {
    let n = 0;
    const bodies: Json[] = [];
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      n++;
      const reply =
        n === 1
          ? message({ text: '{"observations": [{"frame": 1, "order": 1, "author": "Sz', stop: 'max_tokens' })
          : message({ parsed: { observations: [wireObs(2, `Half ${n}`)] } });
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = new Anthropic({ apiKey: 'sk-ant-test', maxRetries: 0, fetch: fetchImpl as typeof fetch });
    const provider = new AnthropicVisionProvider({ client, model: 'claude-opus-5', effort: 'low' });
    const res = await provider.readSpines(frames, CTX);
    expect(n).toBe(3);
    expect(res.observations.map((o) => [o.frame, o.title])).toEqual([
      [2, 'Half 2'],
      [4, 'Half 3'],
    ]);
    expect(res.usage.inputTokens).toBe(300);
  });

  it('omits the fallback beta for models without a default fallback configuration', async () => {
    const requests: Array<{ headers: Headers; body: Json }> = [];
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(message({ parsed: { answers: [{ id: 'q1', same: true }] }, model: 'claude-sonnet-5' })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new Anthropic({ apiKey: 'sk-ant-test', maxRetries: 0, fetch: fetchImpl as typeof fetch });
    const provider = new AnthropicTextProvider({ client, model: 'claude-sonnet-5', effort: 'low' });
    const res = await provider.judgeDuplicates([{ id: 'q1', a: { author: null, title: 'Az ajtó' }, b: { author: 'Szabó Magda', title: 'Az ajtó' } }]);
    expect(res.same).toEqual({ q1: true });
    expect(requests[0].body).not.toHaveProperty('fallbacks');
    expect(requests[0].headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback');
    expect(res.usage).toMatchObject({ model: 'claude-sonnet-5', estCostUsd: (100 * 2 + 50 * 10) / 1e6 });
  });
});

describe('AnthropicVisionProvider control flow (fake client)', () => {
  it('skips a refused batch without retrying', async () => {
    const { client, parse } = fakeClient([message({ stop: 'refusal', stopDetails: { category: 'cyber', explanation: null } })]);
    const provider = new AnthropicVisionProvider({ client, model: 'claude-opus-5', effort: 'medium' });
    const res = await provider.readSpines(frames, CTX);
    expect(res.observations).toEqual([]);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('retries once with the batch split in two on max_tokens and maps frame numbers back', async () => {
    const { client, calls } = fakeClient([
      message({ stop: 'max_tokens', text: '{"observations": [' }),
      message({ parsed: { observations: [wireObs(1, 'A'), wireObs(2, 'B')] } }),
      message({ parsed: { observations: [wireObs(1, 'C'), wireObs(2, 'D')] } }),
    ]);
    const provider = new AnthropicVisionProvider({ client, model: 'claude-opus-5', effort: 'medium' });
    const res = await provider.readSpines(frames, CTX);
    expect(calls).toHaveLength(3);
    expect(contentTexts(calls[1].params).filter((t) => t.startsWith('Frame'))).toEqual(['Frame 1 - 60 x 100 px', 'Frame 2 - 60 x 100 px']);
    expect(contentTexts(calls[2].params).filter((t) => t.startsWith('Frame'))).toEqual(['Frame 1 - 60 x 100 px', 'Frame 2 - 60 x 100 px']);
    expect(res.observations.map((o) => [o.frame, o.title])).toEqual([
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
      [4, 'D'],
    ]);
    expect(res.usage.inputTokens).toBe(300);
    expect(res.usage.outputTokens).toBe(150);
  });

  it('throws AiOutputError when a split half is truncated again', async () => {
    const { client } = fakeClient([
      message({ stop: 'max_tokens' }),
      message({ stop: 'max_tokens' }),
      message({ parsed: { observations: [] } }),
    ]);
    const provider = new AnthropicVisionProvider({ client, model: 'claude-opus-5', effort: 'medium' });
    await expect(provider.readSpines(frames, CTX)).rejects.toBeInstanceOf(AiOutputError);
  });

  it('retries invalid structured output once, then fails', async () => {
    const { client, parse } = fakeClient([
      { ...message({ text: 'not json' }), parsed_output: null },
      { ...message({ text: 'still not json' }), parsed_output: null },
    ]);
    const provider = new AnthropicVisionProvider({ client, model: 'claude-opus-5', effort: 'medium' });
    await expect(provider.readSpines(frames, CTX)).rejects.toBeInstanceOf(AiOutputError);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('drops the fallback beta after a 400 and keeps working without it', async () => {
    const badRequest = new Anthropic.BadRequestError(400, { type: 'error' }, 'fallbacks not enabled', new Headers());
    const { client, calls } = fakeClient([
      badRequest,
      message({ parsed: { observations: [wireObs(1, 'Ok')] } }),
      message({ parsed: { observations: [] } }),
    ]);
    const provider = new AnthropicVisionProvider({ client, model: 'claude-opus-5', effort: 'medium' });
    expect((await provider.readSpines(frames.slice(0, 1), CTX)).observations).toHaveLength(1);
    await provider.readSpines(frames.slice(0, 1), CTX);
    expect(calls[0].params).toMatchObject({ betas: [FALLBACK_BETA], fallbacks: 'default' });
    expect(calls[1].params).not.toHaveProperty('fallbacks');
    expect(calls[2].params).not.toHaveProperty('betas');
  });

  it('wraps SDK errors into typed AI errors', async () => {
    const rate = new Anthropic.RateLimitError(429, { type: 'error' }, 'slow down', new Headers());
    const auth = new Anthropic.AuthenticationError(401, { type: 'error' }, 'bad key', new Headers());
    const conn = new Anthropic.APIConnectionTimeoutError();
    const make = (err: Error) =>
      new AnthropicVisionProvider({ client: fakeClient([err]).client, model: 'claude-opus-5', effort: 'medium', fallbacks: false });

    const e1 = await make(rate).readSpines(frames, CTX).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(AiProviderError);
    expect(e1).toMatchObject({ retryable: true, status: 429 });
    await expect(make(auth).readSpines(frames, CTX)).rejects.toBeInstanceOf(AiConfigError);
    const e3 = await make(conn).readSpines(frames, CTX).catch((e: unknown) => e);
    expect(e3).toMatchObject({ name: 'AiProviderError', retryable: true });
  });

  it('uses a larger output budget for xhigh effort', async () => {
    const { client, calls } = fakeClient([message({ parsed: { observations: [] } })]);
    await new AnthropicVisionProvider({ client, model: 'claude-opus-5', effort: 'xhigh' }).readSpines(frames.slice(0, 1), CTX);
    expect(calls[0].params.max_tokens).toBe(64000);
    expect(calls[0].options).toEqual({ timeout: 600000 });
  });
});

describe('images', () => {
  it('sends frames as stored when within limits', async () => {
    const img = await prepareImage(frames[0]);
    expect(img).toMatchObject({ mediaType: 'image/jpeg', width: 60, height: 100, scaleX: 1, scaleY: 1 });
  });

  it('downscales frames above 2576 px and maps boxes back to the stored frame', async () => {
    const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#224488' } }).jpeg().toBuffer();
    const img = await prepareImage({ jpeg: big, width: 3000, height: 1500 });
    expect(img.width).toBe(2576);
    expect(img.height).toBe(1288);
    expect(img.scaleX).toBeCloseTo(3000 / 2576, 6);

    const { client, calls } = fakeClient([message({ parsed: { observations: [wireObs(1, 'Big', { bbox: { x0: 1288, y0: 0, x1: 2576, y1: 1288 } })] } })]);
    const provider = new AnthropicVisionProvider({ client, model: 'claude-opus-5', effort: 'medium' });
    const res = await provider.readSpines([{ index: 7, frameId: 'big', jpeg: big, width: 3000, height: 1500, timeSec: 0 }], CTX);
    expect(contentTexts(calls[0].params)).toContain('Frame 1 - 2576 x 1288 px');
    expect(res.observations[0]).toMatchObject({ frame: 7, bbox: { x0: 1500, y0: 0, x1: 3000, y1: 1500 } });
  });
});

describe('AnthropicTextProvider', () => {
  const book = (i: number): BookForClassification => ({
    id: `b${i}`,
    author: 'Móricz Zsigmond',
    title: `Könyv ${i}`,
    spineAuthor: 'MÓRICZ ZSIGMOND',
    spineTitle: `KÖNYV ${i}`,
    publisher: null,
  });
  const cls = (id: string) => ({
    id,
    known_book: true,
    category: 'hungarian_literature',
    topics: ['classics'],
    author: 'Móricz Zsigmond',
    original_title: null,
    language: 'hu',
    original_language: 'hu',
    author_country: 'HU',
    first_published_year: 1932,
    description_hu: 'Regény.',
    description_en: 'A novel.',
  });

  it('classifies in chunks of 25 and re-asks for skipped ids once', async () => {
    const books = Array.from({ length: 30 }, (_, i) => book(i + 1));
    const first = books.slice(0, 25).filter((b) => b.id !== 'b7').map((b) => cls(b.id));
    const { client, calls } = fakeClient([
      message({ parsed: { books: first } }),
      message({ parsed: { books: books.slice(25).map((b) => cls(b.id)) } }),
      message({ parsed: { books: [cls('b7')] } }),
    ]);
    const provider = new AnthropicTextProvider({ client, model: 'claude-opus-5', effort: 'low' });
    const res = await provider.classifyBooks(books, { locale: 'hu' });
    expect(calls).toHaveLength(3);
    expect(calls[0].params).toMatchObject({ output_config: { effort: 'low' }, system: [{ text: CLASSIFY_SYSTEM_PROMPT }] });
    const userJson = contentTexts(calls[2].params)[0];
    expect(userJson).toContain('"id": "b7"');
    expect(userJson).toContain('"spine_title": "KÖNYV 7"');
    expect(res.results.map((r) => r.id).sort()).toEqual(books.map((b) => b.id).sort());
    expect(res.results[0]).toMatchObject({ category: 'hungarian_literature', authorCountry: 'HU', firstPublishedYear: 1932 });
    expect(res.usage.inputTokens).toBe(300);
  });

  it('treats a refused duplicate check as "not the same"', async () => {
    const { client } = fakeClient([message({ stop: 'refusal' })]);
    const provider = new AnthropicTextProvider({ client, model: 'claude-opus-5', effort: 'low' });
    const res = await provider.judgeDuplicates([
      { id: 'q1', a: { author: null, title: 'A' }, b: { author: null, title: 'A' } },
      { id: 'q2', a: { author: null, title: 'B' }, b: { author: null, title: 'C' } },
    ]);
    expect(res.same).toEqual({ q1: false, q2: false });
  });
});

describe('helpers', () => {
  it('parses effort values and knows which models support default fallbacks', () => {
    expect(parseEffort('HIGH', 'medium')).toBe('high');
    expect(parseEffort('extreme', 'medium')).toBe('medium');
    expect(parseEffort(undefined, 'low')).toBe('low');
    expect(supportsDefaultFallbacks('claude-opus-5')).toBe(true);
    expect(supportsDefaultFallbacks('claude-opus-4-8')).toBe(false);
    expect(supportsDefaultFallbacks('claude-haiku-4-5')).toBe(false);
  });

  it('sums cache tokens into input usage', () => {
    const u = usageFromMessage({
      model: 'claude-haiku-4-5',
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: null, cache_creation_input_tokens: 5 } as never,
    });
    expect(u).toEqual({ model: 'claude-haiku-4-5', inputTokens: 15, outputTokens: 20, estCostUsd: (10 * 1 + 5 * 1.25 + 20 * 5) / 1e6 });
  });
});

describe('AnthropicVisionProvider – cut-out spines', () => {
  const spine = (id: number) => ({ id, views: [{ jpeg: frames[0].jpeg, width: 60, height: 100 }] });
  const wire = (id: number, title: string) => ({
    id,
    part: 1,
    status: 'book',
    author: null,
    title,
    canonical_author: null,
    canonical_title: null,
    publisher: null,
    confidence: 0.9,
  });

  it('sends labelled spine pictures and maps the structured output', async () => {
    const { client, calls } = fakeClient([message({ parsed: { spines: [wire(1, 'Abigél'), wire(2, 'Az ajtó')] } })]);
    const provider = new AnthropicVisionProvider({ client, model: 'claude-opus-5', effort: 'medium' });
    const res = await provider.readSpineImages([spine(1), spine(2)], CTX);
    expect(contentTexts(calls[0].params)).toEqual([
      'The following pictures show 2 book spines cut out of one bookshelf video.',
      'Spine 1, view 1',
      'Spine 2, view 1',
      'Return one entry for each of the spines 1, 2.',
    ]);
    expect(res.readings.map((r) => r.title)).toEqual(['Abigél', 'Az ajtó']);
  });

  it('skips a refused spine batch', async () => {
    const { client } = fakeClient([message({ stop: 'refusal', stopDetails: { category: 'cyber', explanation: null } })]);
    const provider = new AnthropicVisionProvider({ client, model: 'claude-opus-5', effort: 'medium' });
    expect((await provider.readSpineImages([spine(1)], CTX)).readings).toEqual([]);
  });
});
