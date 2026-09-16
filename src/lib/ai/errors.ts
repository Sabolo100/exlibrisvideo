/**
 * Error types thrown by the AI providers. Callers (vision step, enrichment) can branch on
 * `retryable` to decide between retrying the job later and failing/skipping the step.
 */
import type { AiProviderName } from '@/lib/types';

/** Misconfiguration (explicit provider without API key, invalid key, unknown model…). Never retryable. */
export class AiConfigError extends Error {
  readonly retryable = false;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiConfigError';
  }
}

/** Transport / API failure after the provider's own retries were exhausted. */
export class AiProviderError extends Error {
  readonly provider: AiProviderName;
  readonly retryable: boolean;
  readonly status: number | undefined;
  constructor(
    message: string,
    opts: { provider: AiProviderName; retryable: boolean; status?: number; cause?: unknown },
  ) {
    super(message, { cause: opts.cause });
    this.name = 'AiProviderError';
    this.provider = opts.provider;
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

/** The model answered, but the answer could not be used (invalid JSON / schema, truncated twice). */
export class AiOutputError extends Error {
  readonly provider: AiProviderName;
  /** a later attempt may well succeed (non-deterministic model output) */
  readonly retryable = true;
  constructor(message: string, opts: { provider: AiProviderName; cause?: unknown }) {
    super(message, { cause: opts.cause });
    this.name = 'AiOutputError';
    this.provider = opts.provider;
  }
}
