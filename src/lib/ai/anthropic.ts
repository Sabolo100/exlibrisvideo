/**
 * Anthropic (Claude) providers – vision (spine reading) and text (classification, duplicates).
 *
 * Request surface: `client.beta.messages.parse` with structured outputs
 * (`output_config.format` = zod schema), adaptive thinking, `output_config.effort`, a cached
 * system prompt, and – for models that support it – server-side refusal fallbacks
 * (`betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`). The beta surface was
 * chosen because in @anthropic-ai/sdk 0.125 `beta.messages.parse` accepts `betas` + `fallbacks`
 * and typechecks together with the zod parse helper (`betaZodOutputFormat`).
 * If the fallback beta is rejected with a 400, the request is retried once without it and
 * fallbacks are switched off for the rest of the process.
 *
 * The SDK's own parse helper throws on unparsable output (e.g. JSON truncated at max_tokens)
 * before `stop_reason` could be inspected, so the output format's `parse` is wrapped to return
 * null instead. That way `stop_reason` is always checked first:
 *   refusal → the batch is skipped (logged, no retry)
 *   max_tokens / model_context_window_exceeded → retried once with the batch split in two
 *   parsed_output null → retried once, then AiOutputError
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaRefusalStopDetails,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import sharp from 'sharp';
import type { z } from 'zod';
import { estimate } from './cost';
import { AiConfigError, AiOutputError, AiProviderError } from './errors';
import {
  CLASSIFY_SYSTEM_PROMPT,
  classifyUserMessage,
  DUPLICATE_SYSTEM_PROMPT,
  duplicateUserMessage,
  frameLabel,
  SPINE_READING_SYSTEM_PROMPT,
  spineBatchIntro,
  spineBatchOutro,
  spineViewLabel,
  VISION_SYSTEM_PROMPT,
  visionBatchIntro,
  visionBatchOutro,
} from './prompts';
import {
  ClassificationOutputSchema,
  DuplicateOutputSchema,
  mapClassificationOutput,
  mapDuplicateOutput,
  mapSpineReadingOutput,
  mapVisionOutput,
  type MapFrameInfo,
  SpineReadingOutputSchema,
  VisionOutputSchema,
} from './schemas';
import type {
  AiUsage,
  BookClassification,
  BookForClassification,
  DuplicateQuestion,
  SpineObservation,
  SpineReading,
  SpineToRead,
  TextProvider,
  VisionContext,
  VisionFrame,
  VisionProvider,
} from './types';
import { chunk, describeError, halves, mapLimit, UsageAccumulator } from './util';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Opus 5 reads images up to this long edge natively (coordinates 1:1 with the sent image). */
export const MAX_IMAGE_EDGE = 2576;
/** Base64 images are limited to 5 MB on the API; stay below with the raw bytes. */
export const MAX_IMAGE_BYTES = 3_700_000;

const CLASSIFY_CHUNK = 25;
const DUPLICATE_CHUNK = 60;
const TEXT_CONCURRENCY = 2;

export function parseEffort(value: string | undefined, fallback: Effort): Effort {
  const v = (value ?? '').trim().toLowerCase();
  if ((EFFORTS as readonly string[]).includes(v)) return v as Effort;
  if (v) console.warn('[ai] invalid Anthropic effort, using default', { value: v, fallback });
  return fallback;
}

/** `xhigh`/`max` need a larger output budget (thinking + answer share max_tokens). */
function budgetFor(effort: Effort): { maxTokens: number; timeoutMs: number } {
  return effort === 'xhigh' || effort === 'max'
    ? { maxTokens: 64_000, timeoutMs: 600_000 }
    : { maxTokens: 16_000, timeoutMs: 180_000 };
}

/** Models with a server-defined default fallback configuration (`fallbacks: "default"`). */
export function supportsDefaultFallbacks(model: string): boolean {
  return /^claude-opus-5(?:$|-)/.test(model.trim().toLowerCase());
}

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 4, timeout: 180_000 });
}

export interface AnthropicProviderOptions {
  client: Anthropic;
  model: string;
  effort: Effort;
  /** default: supportsDefaultFallbacks(model) */
  fallbacks?: boolean;
}

/* ------------------------------------------------------------------ */
/* Structured call core                                                */
/* ------------------------------------------------------------------ */

type CallOutcome<T> =
  | { kind: 'ok'; data: T; usage: CallUsage }
  | { kind: 'refusal'; usage: CallUsage; details: BetaRefusalStopDetails | null }
  | { kind: 'truncated'; usage: CallUsage }
  | { kind: 'invalid'; usage: CallUsage; stopReason: string | null };

interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
}

/** zod output format whose parse never throws (null on invalid/truncated JSON). */
function nonThrowingFormat<S extends z.ZodType>(schema: S) {
  const base = betaZodOutputFormat(schema);
  return {
    ...base,
    parse: (content: string): z.infer<S> | null => {
      try {
        return base.parse(content);
      } catch {
        return null;
      }
    },
  };
}

export function usageFromMessage(res: Pick<BetaMessage, 'model' | 'usage'>): CallUsage {
  const u = res.usage;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const inputTokens = (u.input_tokens ?? 0) + cacheRead + cacheWrite;
  const outputTokens = u.output_tokens ?? 0;
  return {
    model: res.model,
    inputTokens,
    outputTokens,
    estCostUsd: estimate(res.model, {
      inputTokens,
      outputTokens,
      cacheReadInputTokens: cacheRead,
      cacheCreationInputTokens: cacheWrite,
    }),
  };
}

class AnthropicCaller {
  private readonly client: Anthropic;
  readonly model: string;
  private readonly effort: Effort;
  private fallbacks: boolean;

  constructor(opts: AnthropicProviderOptions) {
    this.client = opts.client;
    this.model = opts.model;
    this.effort = opts.effort;
    this.fallbacks = opts.fallbacks ?? supportsDefaultFallbacks(opts.model);
  }

  async call<S extends z.ZodType>(
    label: string,
    system: string,
    content: BetaContentBlockParam[],
    schema: S,
  ): Promise<CallOutcome<z.infer<S>>> {
    const useFallbacks = this.fallbacks;
    try {
      return await this.send(system, content, schema, useFallbacks);
    } catch (err) {
      if (useFallbacks && err instanceof Anthropic.BadRequestError) {
        // Most likely the fallback beta is not enabled for this account/model: retry plainly once.
        let retried: CallOutcome<z.infer<S>>;
        try {
          retried = await this.send(system, content, schema, false);
        } catch (retryErr) {
          throw this.wrap(label, retryErr);
        }
        this.fallbacks = false;
        console.warn('[ai] anthropic: server-side fallbacks rejected, continuing without them', {
          model: this.model,
          error: describeError(err),
        });
        return retried;
      }
      throw this.wrap(label, err);
    }
  }

  private async send<S extends z.ZodType>(
    system: string,
    content: BetaContentBlockParam[],
    schema: S,
    useFallbacks: boolean,
  ): Promise<CallOutcome<z.infer<S>>> {
    const { maxTokens, timeoutMs } = budgetFor(this.effort);
    const params = {
      model: this.model,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' as const },
      output_config: { effort: this.effort, format: nonThrowingFormat(schema) },
      system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
      messages: [{ role: 'user' as const, content }],
      ...(useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    };
    const res = await this.client.beta.messages.parse(params, { timeout: timeoutMs });
    const usage = usageFromMessage(res);

    switch (res.stop_reason) {
      case 'refusal':
        return { kind: 'refusal', usage, details: res.stop_details ?? null };
      case 'max_tokens':
      case 'model_context_window_exceeded':
        return { kind: 'truncated', usage };
      default:
        break;
    }
    const data = res.parsed_output as z.infer<S> | null;
    if (data === null || data === undefined) return { kind: 'invalid', usage, stopReason: res.stop_reason };
    return { kind: 'ok', data, usage };
  }

  private wrap(label: string, err: unknown): Error {
    if (err instanceof AiConfigError || err instanceof AiProviderError || err instanceof AiOutputError) return err;
    const where = `anthropic ${label} (${this.model})`;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      return new AiConfigError(`${where}: the API key was rejected (${err.status}). Check ANTHROPIC_API_KEY.`, {
        cause: err,
      });
    }
    if (err instanceof Anthropic.NotFoundError) {
      return new AiConfigError(`${where}: model or endpoint not found (404). Check the configured model id.`, {
        cause: err,
      });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return new AiProviderError(`${where}: rate limited after retries`, {
        provider: 'anthropic',
        retryable: true,
        status: 429,
        cause: err,
      });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return new AiProviderError(`${where}: connection failed or timed out after retries`, {
        provider: 'anthropic',
        retryable: true,
        cause: err,
      });
    }
    if (err instanceof Anthropic.InternalServerError) {
      return new AiProviderError(`${where}: server error ${err.status} after retries`, {
        provider: 'anthropic',
        retryable: true,
        status: err.status,
        cause: err,
      });
    }
    if (err instanceof Anthropic.BadRequestError) {
      return new AiProviderError(`${where}: request rejected (400): ${describeError(err)}`, {
        provider: 'anthropic',
        retryable: false,
        status: 400,
        cause: err,
      });
    }
    if (err instanceof Anthropic.APIError) {
      const status = typeof err.status === 'number' ? err.status : undefined;
      return new AiProviderError(`${where}: API error ${status ?? ''}: ${describeError(err)}`, {
        provider: 'anthropic',
        retryable: status === undefined || status === 408 || status === 409 || status >= 500,
        status,
        cause: err,
      });
    }
    return new AiProviderError(`${where}: ${describeError(err)}`, { provider: 'anthropic', retryable: true, cause: err });
  }
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export function sniffImageType(buf: Buffer): ImageMediaType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (buf.length >= 6 && buf.subarray(0, 6).toString('ascii').startsWith('GIF8')) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP')
    return 'image/webp';
  return null;
}

export interface PreparedImage {
  data: string;
  mediaType: ImageMediaType;
  /** size of the image as sent (stated in the "Frame k" line) */
  width: number;
  height: number;
  /** stored frame px per sent px */
  scaleX: number;
  scaleY: number;
}

/**
 * Frames are sent as stored (Opus 5 returns coordinates 1:1). Only images the API would
 * downscale or reject (long edge > 2576, > ~5 MB base64, unknown format) are re-encoded, and
 * the scale back to the stored frame is remembered for the bboxes.
 */
export async function prepareImage(frame: Pick<VisionFrame, 'jpeg' | 'width' | 'height'>): Promise<PreparedImage> {
  const type = sniffImageType(frame.jpeg);
  const longEdge = Math.max(frame.width, frame.height);
  if (type && longEdge <= MAX_IMAGE_EDGE && frame.jpeg.length <= MAX_IMAGE_BYTES) {
    return {
      data: frame.jpeg.toString('base64'),
      mediaType: type,
      width: frame.width,
      height: frame.height,
      scaleX: 1,
      scaleY: 1,
    };
  }
  let quality = 88;
  for (;;) {
    // no .rotate(): boxes must stay in the stored frame's pixel grid
    const { data, info } = await sharp(frame.jpeg)
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true });
    if (data.length <= MAX_IMAGE_BYTES || quality <= 60) {
      return {
        data: data.toString('base64'),
        mediaType: 'image/jpeg',
        width: info.width,
        height: info.height,
        scaleX: frame.width / info.width,
        scaleY: frame.height / info.height,
      };
    }
    quality -= 14;
  }
}

/* ------------------------------------------------------------------ */
/* Vision                                                              */
/* ------------------------------------------------------------------ */

export class AnthropicVisionProvider implements VisionProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly caller: AnthropicCaller;

  constructor(opts: AnthropicProviderOptions) {
    this.caller = new AnthropicCaller(opts);
    this.model = opts.model;
  }

  async readSpines(frames: VisionFrame[], ctx: VisionContext): Promise<{ observations: SpineObservation[]; usage: AiUsage }> {
    const acc = new UsageAccumulator('anthropic', this.model);
    if (frames.length === 0) return { observations: [], usage: acc.total() };
    const prepared = await Promise.all(frames.map((f) => prepareImage(f)));
    const items = frames.map((f, i) => ({ frame: f, image: prepared[i] }));
    const observations = await this.readBatch(items, ctx, acc, true);
    return { observations, usage: acc.total() };
  }

  private async readBatch(
    items: { frame: VisionFrame; image: PreparedImage }[],
    ctx: VisionContext,
    acc: UsageAccumulator,
    allowSplit: boolean,
  ): Promise<SpineObservation[]> {
    const content: BetaContentBlockParam[] = [
      { type: 'text', text: visionBatchIntro(items.length, ctx.batchIndex, ctx.totalBatches) },
    ];
    items.forEach(({ image }, i) => {
      content.push({ type: 'text', text: frameLabel(i + 1, image.width, image.height) });
      content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
    });
    content.push({ type: 'text', text: visionBatchOutro(items.length) });

    const mapInfo: MapFrameInfo[] = items.map(({ frame, image }) => ({
      index: frame.index,
      width: frame.width,
      height: frame.height,
      scaleX: image.scaleX,
      scaleY: image.scaleY,
    }));
    const logCtx = { videoId: ctx.videoId, batch: ctx.batchIndex, frames: items.length, model: this.model };

    for (let attempt = 1; attempt <= 2; attempt++) {
      const outcome = await this.caller.call('readSpines', VISION_SYSTEM_PROMPT, content, VisionOutputSchema);
      acc.add(outcome.usage);
      switch (outcome.kind) {
        case 'ok':
          return mapVisionOutput(outcome.data, mapInfo);
        case 'refusal':
          console.warn('[ai] anthropic refused a vision batch – skipping it', {
            ...logCtx,
            category: outcome.details?.category ?? null,
          });
          return [];
        case 'truncated': {
          if (!allowSplit || items.length < 2) {
            throw new AiOutputError(`anthropic readSpines: output truncated for a ${items.length}-frame batch`, {
              provider: 'anthropic',
            });
          }
          console.warn('[ai] anthropic vision output truncated – splitting the batch', logCtx);
          const [a, b] = halves(items);
          const first = await this.readBatch(a, ctx, acc, false);
          const second = await this.readBatch(b, ctx, acc, false);
          return [...first, ...second];
        }
        case 'invalid':
          console.warn('[ai] anthropic vision output did not match the schema', {
            ...logCtx,
            attempt,
            stopReason: outcome.stopReason,
          });
          break;
      }
    }
    throw new AiOutputError('anthropic readSpines: invalid structured output twice', { provider: 'anthropic' });
  }

  async readSpineImages(spines: SpineToRead[], ctx: VisionContext): Promise<{ readings: SpineReading[]; usage: AiUsage }> {
    const acc = new UsageAccumulator('anthropic', this.model);
    if (spines.length === 0) return { readings: [], usage: acc.total() };
    const readings = await this.readSpineBatch(spines, ctx, acc, true);
    return { readings, usage: acc.total() };
  }

  private async readSpineBatch(
    spines: SpineToRead[],
    ctx: VisionContext,
    acc: UsageAccumulator,
    allowSplit: boolean,
  ): Promise<SpineReading[]> {
    const content: BetaContentBlockParam[] = [{ type: 'text', text: spineBatchIntro(spines.length) }];
    for (const spine of spines) {
      for (const [v, view] of spine.views.entries()) {
        const image = await prepareImage(view);
        content.push({ type: 'text', text: spineViewLabel(spine.id, v + 1, spine.wide) });
        content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
      }
    }
    const ids = spines.map((s) => s.id);
    content.push({ type: 'text', text: spineBatchOutro(ids) });
    const logCtx = { videoId: ctx.videoId, batch: ctx.batchIndex, spines: spines.length, model: this.model };

    for (let attempt = 1; attempt <= 2; attempt++) {
      const outcome = await this.caller.call('readSpineImages', SPINE_READING_SYSTEM_PROMPT, content, SpineReadingOutputSchema);
      acc.add(outcome.usage);
      switch (outcome.kind) {
        case 'ok':
          return mapSpineReadingOutput(outcome.data, ids);
        case 'refusal':
          console.warn('[ai] anthropic refused a spine batch – skipping it', { ...logCtx, category: outcome.details?.category ?? null });
          return [];
        case 'truncated': {
          if (!allowSplit || spines.length < 2) {
            throw new AiOutputError(`anthropic readSpineImages: output truncated for ${spines.length} spines`, { provider: 'anthropic' });
          }
          console.warn('[ai] anthropic spine output truncated – splitting the batch', logCtx);
          const [a, b] = halves(spines);
          return [...(await this.readSpineBatch(a, ctx, acc, false)), ...(await this.readSpineBatch(b, ctx, acc, false))];
        }
        case 'invalid':
          console.warn('[ai] anthropic spine output did not match the schema', { ...logCtx, attempt, stopReason: outcome.stopReason });
          break;
      }
    }
    throw new AiOutputError('anthropic readSpineImages: invalid structured output twice', { provider: 'anthropic' });
  }
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

export class AnthropicTextProvider implements TextProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly caller: AnthropicCaller;

  constructor(opts: AnthropicProviderOptions) {
    this.caller = new AnthropicCaller(opts);
    this.model = opts.model;
  }

  async classifyBooks(
    books: BookForClassification[],
    ctx: { locale: 'hu' | 'en' },
  ): Promise<{ results: BookClassification[]; usage: AiUsage }> {
    void ctx; // descriptions are always produced in both languages
    const acc = new UsageAccumulator('anthropic', this.model);
    const unique = dedupeById(books);
    const parts = await mapLimit(chunk(unique, CLASSIFY_CHUNK), TEXT_CONCURRENCY, (part) =>
      this.classifyChunk(part, acc, true),
    );
    const results = parts.flat();
    // one more pass for books the model skipped
    const done = new Set(results.map((r) => r.id));
    const missing = unique.filter((b) => !done.has(b.id));
    if (missing.length > 0 && missing.length < unique.length) {
      for (const part of chunk(missing, CLASSIFY_CHUNK)) results.push(...(await this.classifyChunk(part, acc, true)));
    }
    return { results, usage: acc.total() };
  }

  private async classifyChunk(
    books: BookForClassification[],
    acc: UsageAccumulator,
    allowSplit: boolean,
  ): Promise<BookClassification[]> {
    if (books.length === 0) return [];
    const text = classifyUserMessage(
      books.map((b) => ({
        id: b.id,
        author: b.author,
        title: b.title,
        spine_author: b.spineAuthor,
        spine_title: b.spineTitle,
        publisher: b.publisher,
      })),
    );
    for (let attempt = 1; attempt <= 2; attempt++) {
      const outcome = await this.caller.call(
        'classifyBooks',
        CLASSIFY_SYSTEM_PROMPT,
        [{ type: 'text', text }],
        ClassificationOutputSchema,
      );
      acc.add(outcome.usage);
      switch (outcome.kind) {
        case 'ok':
          return mapClassificationOutput(outcome.data, books.map((b) => b.id));
        case 'refusal':
          console.warn('[ai] anthropic refused a classification batch – leaving those books unclassified', {
            books: books.length,
            category: outcome.details?.category ?? null,
          });
          return [];
        case 'truncated': {
          if (!allowSplit || books.length < 2) {
            throw new AiOutputError('anthropic classifyBooks: output truncated', { provider: 'anthropic' });
          }
          const [a, b] = halves(books);
          return [...(await this.classifyChunk(a, acc, false)), ...(await this.classifyChunk(b, acc, false))];
        }
        case 'invalid':
          console.warn('[ai] anthropic classification output did not match the schema', { attempt });
          break;
      }
    }
    throw new AiOutputError('anthropic classifyBooks: invalid structured output twice', { provider: 'anthropic' });
  }

  async judgeDuplicates(questions: DuplicateQuestion[]): Promise<{ same: Record<string, boolean>; usage: AiUsage }> {
    const acc = new UsageAccumulator('anthropic', this.model);
    const same: Record<string, boolean> = {};
    const parts = await mapLimit(chunk(dedupeById(questions), DUPLICATE_CHUNK), TEXT_CONCURRENCY, (part) =>
      this.judgeChunk(part, acc, true),
    );
    for (const p of parts) Object.assign(same, p);
    return { same, usage: acc.total() };
  }

  private async judgeChunk(
    questions: DuplicateQuestion[],
    acc: UsageAccumulator,
    allowSplit: boolean,
  ): Promise<Record<string, boolean>> {
    const ids = questions.map((q) => q.id);
    if (questions.length === 0) return {};
    const text = duplicateUserMessage(questions);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const outcome = await this.caller.call('judgeDuplicates', DUPLICATE_SYSTEM_PROMPT, [{ type: 'text', text }], DuplicateOutputSchema);
      acc.add(outcome.usage);
      switch (outcome.kind) {
        case 'ok':
          return mapDuplicateOutput(outcome.data, ids);
        case 'refusal':
          console.warn('[ai] anthropic refused a duplicate check – treating pairs as different', {
            pairs: questions.length,
            category: outcome.details?.category ?? null,
          });
          return mapDuplicateOutput({ answers: [] }, ids);
        case 'truncated': {
          if (!allowSplit || questions.length < 2) {
            throw new AiOutputError('anthropic judgeDuplicates: output truncated', { provider: 'anthropic' });
          }
          const [a, b] = halves(questions);
          return { ...(await this.judgeChunk(a, acc, false)), ...(await this.judgeChunk(b, acc, false)) };
        }
        case 'invalid':
          console.warn('[ai] anthropic duplicate output did not match the schema', { attempt });
          break;
      }
    }
    throw new AiOutputError('anthropic judgeDuplicates: invalid structured output twice', { provider: 'anthropic' });
  }
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}
