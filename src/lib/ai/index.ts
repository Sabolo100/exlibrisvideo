/**
 * AI provider selection. Providers are process-wide singletons chosen by
 * resolveVisionProvider()/resolveTextProvider() from '@/lib/env':
 *   AI_MOCK=true → mock; AI_PROVIDER / AI_TEXT_PROVIDER explicit → that provider (its API key is
 *   required, otherwise a configuration error is thrown); 'auto' → anthropic if
 *   ANTHROPIC_API_KEY, else deepseek if DEEPSEEK_API_KEY, else mock.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { env, resolveTextProvider, resolveVisionProvider } from '@/lib/env';
import type { AiProviderName } from '@/lib/types';
import { AnthropicTextProvider, AnthropicVisionProvider, createAnthropicClient, parseEffort } from './anthropic';
import { DeepSeekClient, DeepSeekTextProvider, DeepSeekVisionProvider } from './deepseek';
import { AiConfigError } from './errors';
import { MockTextProvider, MockVisionProvider } from './mock';
import type { TextProvider, VisionProvider } from './types';

let visionSingleton: VisionProvider | undefined;
let textSingleton: TextProvider | undefined;
let anthropicClient: { apiKey: string; client: Anthropic } | undefined;
let deepseekClient: { key: string; client: DeepSeekClient } | undefined;

/** Models known to be text-only on DeepSeek (cannot read spines). */
const DEEPSEEK_TEXT_ONLY_MODELS = new Set(['deepseek-v4-pro']);

function explicitSetting(name: 'AI_PROVIDER' | 'AI_TEXT_PROVIDER'): string {
  return env()[name].trim().toLowerCase();
}

function requireKey(provider: 'anthropic' | 'deepseek', step: 'vision' | 'text'): string {
  const e = env();
  const key = provider === 'anthropic' ? e.ANTHROPIC_API_KEY : e.DEEPSEEK_API_KEY;
  if (key) return key;
  const varName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'DEEPSEEK_API_KEY';
  const setting = step === 'text' && explicitSetting('AI_TEXT_PROVIDER') === provider ? 'AI_TEXT_PROVIDER' : 'AI_PROVIDER';
  throw new AiConfigError(
    `AI configuration error: ${setting}=${provider} is set but ${varName} is empty. ` +
      `Set ${varName}, choose another provider, or use AI_PROVIDER=auto / AI_MOCK=true.`,
  );
}

function getAnthropicClient(apiKey: string): Anthropic {
  if (!anthropicClient || anthropicClient.apiKey !== apiKey) {
    anthropicClient = { apiKey, client: createAnthropicClient(apiKey) };
  }
  return anthropicClient.client;
}

function getDeepSeekClient(apiKey: string): DeepSeekClient {
  const e = env();
  const cacheKey = `${e.DEEPSEEK_BASE_URL}\n${apiKey}`;
  if (!deepseekClient || deepseekClient.key !== cacheKey) {
    deepseekClient = { key: cacheKey, client: new DeepSeekClient({ apiKey, baseUrl: e.DEEPSEEK_BASE_URL }) };
  }
  return deepseekClient.client;
}

export function createVisionProvider(name: AiProviderName): VisionProvider {
  const e = env();
  switch (name) {
    case 'anthropic':
      return new AnthropicVisionProvider({
        client: getAnthropicClient(requireKey('anthropic', 'vision')),
        model: e.ANTHROPIC_VISION_MODEL,
        effort: parseEffort(e.ANTHROPIC_VISION_EFFORT, 'medium'),
      });
    case 'deepseek': {
      const client = getDeepSeekClient(requireKey('deepseek', 'vision'));
      if (DEEPSEEK_TEXT_ONLY_MODELS.has(e.DEEPSEEK_VISION_MODEL)) {
        throw new AiConfigError(
          `AI configuration error: DEEPSEEK_VISION_MODEL=${e.DEEPSEEK_VISION_MODEL} cannot read images. Use deepseek-flash.`,
        );
      }
      return new DeepSeekVisionProvider({ client, model: e.DEEPSEEK_VISION_MODEL });
    }
    case 'mock':
      return new MockVisionProvider();
    default: {
      const exhaustive: never = name;
      throw new AiConfigError(`AI configuration error: unknown provider ${String(exhaustive)}`);
    }
  }
}

export function createTextProvider(name: AiProviderName): TextProvider {
  const e = env();
  switch (name) {
    case 'anthropic':
      return new AnthropicTextProvider({
        client: getAnthropicClient(requireKey('anthropic', 'text')),
        model: e.ANTHROPIC_TEXT_MODEL,
        effort: parseEffort(e.ANTHROPIC_TEXT_EFFORT, 'low'),
      });
    case 'deepseek':
      return new DeepSeekTextProvider({ client: getDeepSeekClient(requireKey('deepseek', 'text')), model: e.DEEPSEEK_TEXT_MODEL });
    case 'mock':
      return new MockTextProvider();
    default: {
      const exhaustive: never = name;
      throw new AiConfigError(`AI configuration error: unknown provider ${String(exhaustive)}`);
    }
  }
}

export function getVisionProvider(): VisionProvider {
  if (!visionSingleton) {
    visionSingleton = createVisionProvider(resolveVisionProvider());
    console.info('[ai] vision provider', { provider: visionSingleton.name, model: visionSingleton.model });
  }
  return visionSingleton;
}

export function getTextProvider(): TextProvider {
  if (!textSingleton) {
    textSingleton = createTextProvider(resolveTextProvider());
    console.info('[ai] text provider', { provider: textSingleton.name, model: textSingleton.model });
  }
  return textSingleton;
}

/** Drops the cached providers/clients (tests, or after changing process.env at runtime). */
export function resetAiProviders(): void {
  visionSingleton = undefined;
  textSingleton = undefined;
  anthropicClient = undefined;
  deepseekClient = undefined;
}

export { AiConfigError, AiOutputError, AiProviderError } from './errors';
export type * from './types';
