import type { AIConfig } from '../services/aiClient.js';

export const DEFAULT_CHAPTER_MEMORY_DIGEST_MAX_CHARS = 1800;

export function isReasoningHeavyModel(aiConfig: Pick<AIConfig, 'provider' | 'model'>): boolean {
  const provider = String(aiConfig.provider || '').toLowerCase();
  const model = String(aiConfig.model || '').toLowerCase();
  return (
    provider === 'custom' ||
    provider === 'zai' ||
    /gpt-oss|gpt-5|glm|qwen|deepseek|reasoner|r1|o1|o3|o4/.test(model)
  );
}

export function getSupportPassMaxTokens(
  aiConfig: Pick<AIConfig, 'provider' | 'model'>,
  defaultMaxTokens: number,
  reasoningMaxTokens: number
): number {
  if (!isReasoningHeavyModel(aiConfig)) {
    return defaultMaxTokens;
  }
  return Math.max(defaultMaxTokens, reasoningMaxTokens);
}
