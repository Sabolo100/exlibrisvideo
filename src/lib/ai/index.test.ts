import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pipeline/text', () => ({
  titleSimilarity: () => 0,
  authorsCompatible: () => true,
}));

const AI_VARS = [
  'AI_PROVIDER',
  'AI_TEXT_PROVIDER',
  'AI_MOCK',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_VISION_MODEL',
  'DEEPSEEK_TEXT_MODEL',
  'ANTHROPIC_VISION_MODEL',
  'ANTHROPIC_TEXT_MODEL',
];

async function load(vars: Record<string, string>) {
  for (const k of AI_VARS) vi.stubEnv(k, vars[k] ?? '');
  vi.resetModules(); // env() caches the parsed environment per module instance
  return import('./index');
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('provider resolution', () => {
  it('auto without keys → mock singletons', async () => {
    const ai = await load({ AI_PROVIDER: 'auto' });
    const v = ai.getVisionProvider();
    expect(v.name).toBe('mock');
    expect(ai.getVisionProvider()).toBe(v);
    expect(ai.getTextProvider().name).toBe('mock');
  });

  it('auto prefers anthropic, then deepseek', async () => {
    let ai = await load({ AI_PROVIDER: 'auto', ANTHROPIC_API_KEY: 'sk-ant-x', DEEPSEEK_API_KEY: 'sk-ds-x' });
    expect(ai.getVisionProvider()).toMatchObject({ name: 'anthropic', model: 'claude-opus-5' });
    expect(ai.getTextProvider().name).toBe('anthropic');

    ai = await load({ AI_PROVIDER: 'auto', DEEPSEEK_API_KEY: 'sk-ds-x', DEEPSEEK_TEXT_MODEL: 'deepseek-v4-pro' });
    expect(ai.getVisionProvider()).toMatchObject({ name: 'deepseek', model: 'deepseek-flash' });
    expect(ai.getTextProvider()).toMatchObject({ name: 'deepseek', model: 'deepseek-v4-pro' });
  });

  it('AI_MOCK wins over keys', async () => {
    const ai = await load({ AI_MOCK: 'true', ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(ai.getVisionProvider().name).toBe('mock');
    expect(ai.getTextProvider().name).toBe('mock');
  });

  it('explicit provider without its key is a clear configuration error', async () => {
    const ai = await load({ AI_PROVIDER: 'anthropic', DEEPSEEK_API_KEY: 'sk-ds-x' });
    expect(() => ai.getVisionProvider()).toThrow(ai.AiConfigError);
    expect(() => ai.getVisionProvider()).toThrow(/AI_PROVIDER=anthropic is set but ANTHROPIC_API_KEY is empty/);

    const ai2 = await load({ AI_PROVIDER: 'auto', AI_TEXT_PROVIDER: 'deepseek' });
    expect(ai2.getVisionProvider().name).toBe('mock');
    expect(() => ai2.getTextProvider()).toThrow(/AI_TEXT_PROVIDER=deepseek is set but DEEPSEEK_API_KEY is empty/);
  });

  it('rejects a text-only DeepSeek model for vision', async () => {
    const ai = await load({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-ds-x', DEEPSEEK_VISION_MODEL: 'deepseek-v4-pro' });
    expect(() => ai.getVisionProvider()).toThrow(/cannot read images/);
  });

  it('resetAiProviders drops the singletons', async () => {
    const ai = await load({});
    const first = ai.getTextProvider();
    ai.resetAiProviders();
    expect(ai.getTextProvider()).not.toBe(first);
  });
});
