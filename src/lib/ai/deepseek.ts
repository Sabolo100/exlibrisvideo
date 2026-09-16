/**
 * DeepSeek providers over the OpenAI-compatible HTTP API (`POST {DEEPSEEK_BASE_URL}/chat/completions`).
 *
 * - `deepseek-flash` accepts images as `image_url` content parts (data URLs); `deepseek-v4-pro`
 *   is text-only, so it may only be used for the text steps.
 * - Both are reasoning models: `thinking: {type: "disabled"}` keeps a 3–4 frame batch at a few
 *   seconds instead of burning thousands of reasoning tokens.
 * - `response_format: {type: "json_object"}` + the exact JSON shape spelled out in the system
 *   prompt; replies are coerced leniently and validated with zod; invalid JSON is retried once
 *   with a "valid JSON only" nudge; truncated replies (finish_reason "length") are retried once
 *   with the batch split in two.
 * - HTTP 429 / 5xx / network errors / timeouts: exponential back-off, 3 attempts, 120 s timeout each.
 * - DeepSeek downsamples images heavily, so its boxes are coarse; normalised (0..1) answers
 *   are detected and scaled, everything is clamped to the frame.
 */
import { estimate } from './cost';
import { AiConfigError, AiOutputError, AiProviderError } from './errors';
import {
  CLASSIFY_SYSTEM_PROMPT_JSON,
  classifyUserMessage,
  DUPLICATE_SYSTEM_PROMPT_JSON,
  duplicateUserMessage,
  frameLabel,
  JSON_RETRY_NUDGE,
  buildVisionSystemPrompt,
  type BoxCoordinates,
  visionBatchIntro,
  visionBatchOutro,
} from './prompts';
import {
  coerceClassificationOutput,
  coerceDuplicateOutput,
  coerceVisionOutput,
  extractJson,
  mapClassificationOutput,
  mapDuplicateOutput,
  mapVisionOutput,
  resolveBoxScale,
} from './schemas';
import type {
  AiUsage,
  BookClassification,
  BookForClassification,
  DuplicateQuestion,
  SpineObservation,
  TextProvider,
  VisionContext,
  VisionFrame,
  VisionProvider,
} from './types';
import { chunk, describeError, halves, mapLimit, sleep, UsageAccumulator } from './util';

const CLASSIFY_CHUNK = 20;
const DUPLICATE_CHUNK = 50;
const TEXT_CONCURRENCY = 2;

/* ------------------------------------------------------------------ */
/* HTTP client                                                         */
/* ------------------------------------------------------------------ */

export type DeepSeekContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | DeepSeekContentPart[];
}

export interface DeepSeekChatRequest {
  model: string;
  messages: DeepSeekMessage[];
  max_tokens: number;
  response_format: { type: 'json_object' };
  thinking: { type: 'disabled' };
  stream: false;
}

export interface DeepSeekChatResult {
  content: string;
  finishReason: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** per attempt, default 120 000 */
  timeoutMs?: number;
  /** total attempts for retryable failures, default 3 */
  maxAttempts?: number;
  /** first back-off delay, doubled per attempt (default 1500 ms, ±20 % jitter) */
  backoffBaseMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

interface ChatCompletionBody {
  model?: unknown;
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  error?: { message?: unknown };
}

export class DeepSeekClient {
  private readonly fetchImpl: typeof fetch;
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(private readonly opts: DeepSeekClientOptions) {
    if (!opts.apiKey) throw new AiConfigError('DeepSeek provider needs DEEPSEEK_API_KEY');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.backoffBaseMs = opts.backoffBaseMs ?? 1500;
    this.sleepImpl = opts.sleepImpl ?? sleep;
  }

  async chat(body: DeepSeekChatRequest): Promise<DeepSeekChatResult> {
    let lastError: AiProviderError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: `Bearer ${this.opts.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        lastError = new AiProviderError(
          `deepseek ${body.model}: ${timedOut ? `request timed out after ${this.timeoutMs} ms` : `network error (${describeError(err)})`}`,
          { provider: 'deepseek', retryable: true, cause: err },
        );
        if (attempt < this.maxAttempts) await this.sleepImpl(this.backoff(attempt));
        continue;
      }

      if (response.ok) {
        let json: ChatCompletionBody;
        try {
          json = (await response.json()) as ChatCompletionBody;
        } catch (err) {
          lastError = new AiProviderError(`deepseek ${body.model}: response body is not JSON`, {
            provider: 'deepseek',
            retryable: true,
            status: response.status,
            cause: err,
          });
          if (attempt < this.maxAttempts) await this.sleepImpl(this.backoff(attempt));
          continue;
        }
        return parseChatCompletion(json, body.model);
      }

      const detail = await safeErrorDetail(response);
      const status = response.status;
      if (status === 401 || status === 403) {
        throw new AiConfigError(`deepseek ${body.model}: API key rejected (${status}). Check DEEPSEEK_API_KEY.`);
      }
      if (status === 402) {
        throw new AiProviderError(`deepseek ${body.model}: insufficient balance (402)`, {
          provider: 'deepseek',
          retryable: false,
          status,
        });
      }
      const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
      lastError = new AiProviderError(`deepseek ${body.model}: HTTP ${status}${detail ? ` – ${detail}` : ''}`, {
        provider: 'deepseek',
        retryable,
        status,
      });
      if (!retryable) throw lastError;
      if (attempt < this.maxAttempts) {
        await this.sleepImpl(Math.max(this.backoff(attempt), retryAfterMs(response.headers.get('retry-after'))));
      }
    }
    throw lastError ?? new AiProviderError('deepseek: request failed', { provider: 'deepseek', retryable: true });
  }

  private backoff(attempt: number): number {
    const base = this.backoffBaseMs * 2 ** (attempt - 1);
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }
}

function retryAfterMs(header: string | null): number {
  if (!header) return 0;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.min(30_000, Math.max(0, secs * 1000));
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(30_000, Math.max(0, date - Date.now())) : 0;
}

async function safeErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const j = JSON.parse(text) as ChatCompletionBody;
      const msg = typeof j.error?.message === 'string' ? j.error.message : text;
      return msg.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return '';
  }
}

const toCount = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function parseChatCompletion(json: ChatCompletionBody, requestedModel: string): DeepSeekChatResult {
  const choice = Array.isArray(json.choices) ? json.choices[0] : undefined;
  const content = choice?.message?.content;
  return {
    content: typeof content === 'string' ? content : '',
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    model: typeof json.model === 'string' && json.model ? json.model : requestedModel,
    promptTokens: toCount(json.usage?.prompt_tokens),
    completionTokens: toCount(json.usage?.completion_tokens),
  };
}

/* ------------------------------------------------------------------ */
/* JSON call with one nudge retry                                      */
/* ------------------------------------------------------------------ */

type JsonOutcome<T> = { kind: 'ok'; value: T } | { kind: 'truncated' };

async function callJson<T>(
  client: DeepSeekClient,
  model: string,
  messages: DeepSeekMessage[],
  maxTokens: number,
  coerce: (root: unknown) => T | null,
  acc: UsageAccumulator,
  label: string,
): Promise<JsonOutcome<T>> {
  let lastProblem = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const msgs = attempt === 1 ? messages : withNudge(messages);
    const res = await client.chat({
      model,
      messages: msgs,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      stream: false,
    });
    acc.add({
      model: res.model,
      inputTokens: res.promptTokens,
      outputTokens: res.completionTokens,
      estCostUsd: estimate(res.model, { inputTokens: res.promptTokens, outputTokens: res.completionTokens }),
    });
    if (res.finishReason === 'length') return { kind: 'truncated' };
    try {
      const value = coerce(extractJson(res.content));
      if (value !== null) return { kind: 'ok', value };
      lastProblem = 'unexpected JSON shape';
    } catch (err) {
      lastProblem = describeError(err, 120);
    }
    console.warn('[ai] deepseek reply was not usable JSON', { label, model, attempt, problem: lastProblem });
  }
  throw new AiOutputError(`deepseek ${label}: invalid JSON twice (${lastProblem})`, { provider: 'deepseek' });
}

/** Appends the "valid JSON only" nudge to the last user message. */
function withNudge(messages: DeepSeekMessage[]): DeepSeekMessage[] {
  const copy = messages.slice();
  const last = copy[copy.length - 1];
  if (last && last.role === 'user') {
    const parts: DeepSeekContentPart[] =
      typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content.slice();
    parts.push({ type: 'text', text: JSON_RETRY_NUDGE });
    copy[copy.length - 1] = { role: 'user', content: parts.every((p) => p.type === 'text') ? parts.map((p) => (p as { text: string }).text).join('\n\n') : parts };
  } else {
    copy.push({ role: 'user', content: JSON_RETRY_NUDGE });
  }
  return copy;
}

/* ------------------------------------------------------------------ */
/* Vision                                                              */
/* ------------------------------------------------------------------ */

export interface DeepSeekProviderOptions {
  client: DeepSeekClient;
  model: string;
}

export interface DeepSeekVisionOptions extends DeepSeekProviderOptions {
  /** how the model is asked to report boxes (default DEEPSEEK_BOX_COORDINATES) */
  coordinates?: BoxCoordinates;
}

/**
 * DeepSeek is asked for boxes on a 0..1000 grid. Live tests on the sample shelf videos
 * (portrait 1080 x 1920 frames) showed that, asked for pixels, deepseek-flash answers some
 * batches with pixel x but y squashed into 0..1080 (boxes ending mid-frame), while its
 * normalised answers are mostly consistent. Replies that nevertheless contain pixel values –
 * on both axes or only on one (x up to 1080 with y still in thousandths was observed) – are
 * detected per batch and per axis (resolveBoxScale); 0..1 fractions are detected per box.
 */
export const DEEPSEEK_BOX_COORDINATES: BoxCoordinates = 'per_mille';

const DEEPSEEK_VISION_PROMPTS: Record<BoxCoordinates, string> = {
  pixels: buildVisionSystemPrompt({ coordinates: 'pixels', jsonShape: true }),
  per_mille: buildVisionSystemPrompt({ coordinates: 'per_mille', jsonShape: true }),
};

export function buildVisionMessages(
  frames: VisionFrame[],
  ctx: Pick<VisionContext, 'batchIndex' | 'totalBatches'>,
  coordinates: BoxCoordinates = DEEPSEEK_BOX_COORDINATES,
): DeepSeekMessage[] {
  const parts: DeepSeekContentPart[] = [{ type: 'text', text: visionBatchIntro(frames.length, ctx.batchIndex, ctx.totalBatches) }];
  frames.forEach((f, i) => {
    parts.push({ type: 'text', text: frameLabel(i + 1, f.width, f.height) });
    parts.push({ type: 'image_url', image_url: { url: `data:${mediaTypeOf(f.jpeg)};base64,${f.jpeg.toString('base64')}` } });
  });
  parts.push({ type: 'text', text: visionBatchOutro(frames.length, coordinates) });
  return [
    { role: 'system', content: DEEPSEEK_VISION_PROMPTS[coordinates] },
    { role: 'user', content: parts },
  ];
}

function mediaTypeOf(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP')
    return 'image/webp';
  return 'image/jpeg';
}

export class DeepSeekVisionProvider implements VisionProvider {
  readonly name = 'deepseek' as const;
  readonly model: string;
  private readonly client: DeepSeekClient;
  private readonly coordinates: BoxCoordinates;

  constructor(opts: DeepSeekVisionOptions) {
    this.client = opts.client;
    this.model = opts.model;
    this.coordinates = opts.coordinates ?? DEEPSEEK_BOX_COORDINATES;
  }

  async readSpines(frames: VisionFrame[], ctx: VisionContext): Promise<{ observations: SpineObservation[]; usage: AiUsage }> {
    const acc = new UsageAccumulator('deepseek', this.model);
    if (frames.length === 0) return { observations: [], usage: acc.total() };
    const observations = await this.readBatch(frames, ctx, acc, true);
    return { observations, usage: acc.total() };
  }

  private async readBatch(
    frames: VisionFrame[],
    ctx: VisionContext,
    acc: UsageAccumulator,
    allowSplit: boolean,
  ): Promise<SpineObservation[]> {
    const outcome = await callJson(
      this.client,
      this.model,
      buildVisionMessages(frames, ctx, this.coordinates),
      8000,
      (root) => coerceVisionOutput(root, frames.length),
      acc,
      'readSpines',
    );
    if (outcome.kind === 'ok') {
      const scales = resolveBoxScale(outcome.value.observations, frames, this.coordinates);
      return mapVisionOutput(
        outcome.value,
        frames.map((f, i) => ({ index: f.index, width: f.width, height: f.height, ...scales[i] })),
      );
    }
    if (!allowSplit || frames.length < 2) {
      throw new AiOutputError(`deepseek readSpines: reply truncated for a ${frames.length}-frame batch`, {
        provider: 'deepseek',
      });
    }
    console.warn('[ai] deepseek vision reply truncated – splitting the batch', { videoId: ctx.videoId, batch: ctx.batchIndex });
    const [a, b] = halves(frames);
    return [...(await this.readBatch(a, ctx, acc, false)), ...(await this.readBatch(b, ctx, acc, false))];
  }
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

export class DeepSeekTextProvider implements TextProvider {
  readonly name = 'deepseek' as const;
  readonly model: string;
  private readonly client: DeepSeekClient;

  constructor(opts: DeepSeekProviderOptions) {
    this.client = opts.client;
    this.model = opts.model;
  }

  async classifyBooks(
    books: BookForClassification[],
    ctx: { locale: 'hu' | 'en' },
  ): Promise<{ results: BookClassification[]; usage: AiUsage }> {
    void ctx; // descriptions are always produced in both languages
    const acc = new UsageAccumulator('deepseek', this.model);
    const unique = dedupeById(books);
    const parts = await mapLimit(chunk(unique, CLASSIFY_CHUNK), TEXT_CONCURRENCY, (part) => this.classifyChunk(part, acc, true));
    const results = parts.flat();
    const done = new Set(results.map((r) => r.id));
    const missing = unique.filter((b) => !done.has(b.id));
    if (missing.length > 0 && missing.length < unique.length) {
      for (const part of chunk(missing, CLASSIFY_CHUNK)) results.push(...(await this.classifyChunk(part, acc, true)));
    }
    return { results, usage: acc.total() };
  }

  private async classifyChunk(books: BookForClassification[], acc: UsageAccumulator, allowSplit: boolean): Promise<BookClassification[]> {
    if (books.length === 0) return [];
    const user = classifyUserMessage(
      books.map((b) => ({
        id: b.id,
        author: b.author,
        title: b.title,
        spine_author: b.spineAuthor,
        spine_title: b.spineTitle,
        publisher: b.publisher,
      })),
    );
    const outcome = await callJson(
      this.client,
      this.model,
      [
        { role: 'system', content: CLASSIFY_SYSTEM_PROMPT_JSON },
        { role: 'user', content: user },
      ],
      8000,
      coerceClassificationOutput,
      acc,
      'classifyBooks',
    );
    if (outcome.kind === 'ok') return mapClassificationOutput(outcome.value, books.map((b) => b.id));
    if (!allowSplit || books.length < 2) {
      throw new AiOutputError('deepseek classifyBooks: reply truncated', { provider: 'deepseek' });
    }
    const [a, b] = halves(books);
    return [...(await this.classifyChunk(a, acc, false)), ...(await this.classifyChunk(b, acc, false))];
  }

  async judgeDuplicates(questions: DuplicateQuestion[]): Promise<{ same: Record<string, boolean>; usage: AiUsage }> {
    const acc = new UsageAccumulator('deepseek', this.model);
    const same: Record<string, boolean> = {};
    const parts = await mapLimit(chunk(dedupeById(questions), DUPLICATE_CHUNK), TEXT_CONCURRENCY, (part) =>
      this.judgeChunk(part, acc, true),
    );
    for (const p of parts) Object.assign(same, p);
    return { same, usage: acc.total() };
  }

  private async judgeChunk(questions: DuplicateQuestion[], acc: UsageAccumulator, allowSplit: boolean): Promise<Record<string, boolean>> {
    if (questions.length === 0) return {};
    const ids = questions.map((q) => q.id);
    const outcome = await callJson(
      this.client,
      this.model,
      [
        { role: 'system', content: DUPLICATE_SYSTEM_PROMPT_JSON },
        { role: 'user', content: duplicateUserMessage(questions) },
      ],
      4000,
      coerceDuplicateOutput,
      acc,
      'judgeDuplicates',
    );
    if (outcome.kind === 'ok') return mapDuplicateOutput(outcome.value, ids);
    if (!allowSplit || questions.length < 2) {
      throw new AiOutputError('deepseek judgeDuplicates: reply truncated', { provider: 'deepseek' });
    }
    const [a, b] = halves(questions);
    return { ...(await this.judgeChunk(a, acc, false)), ...(await this.judgeChunk(b, acc, false)) };
  }
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}
