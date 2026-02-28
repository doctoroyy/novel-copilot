import { completeSimple, Model as PiAiModel, streamSimple, SimpleStreamOptions } from '@mariozechner/pi-ai';
import { detectProviderByBaseUrl, getProviderPreset, normalizeGeminiBaseUrl, normalizeProviderId } from './providerCatalog.js';

export type AIProvider = string;

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const GEMINI_DEFAULT_MAX_OUTPUT_TOKENS = 16384;
const MAX_AUTO_EXPAND_OUTPUT_TOKENS = 24000;

/**
 * Convert internal AIConfig to pi-ai Model
 */
function toPiAiModel(config: AIConfig): PiAiModel<any> {
  let api: any = 'openai-completions';
  const normalizedProvider = normalizeProviderId(config.provider);
  const providerByUrl = detectProviderByBaseUrl(config.baseUrl);
  const effectiveProvider = providerByUrl || normalizedProvider;
  const preset = getProviderPreset(effectiveProvider) || getProviderPreset(normalizedProvider);

  let provider: any = effectiveProvider || 'openai';
  let baseUrl = config.baseUrl || preset?.defaultBaseUrl;
  let maxTokens = DEFAULT_MAX_OUTPUT_TOKENS;

  if (preset?.protocol === 'gemini' || effectiveProvider === 'gemini') {
    api = 'google-generative-ai';
    provider = 'google';
    baseUrl = normalizeGeminiBaseUrl(baseUrl);
    maxTokens = GEMINI_DEFAULT_MAX_OUTPUT_TOKENS;
  } else if (preset?.protocol === 'anthropic' || effectiveProvider === 'anthropic') {
    api = 'anthropic';
    provider = 'anthropic';
  } else {
    api = 'openai-completions';
    provider = effectiveProvider || 'openai';
  }

  if (!baseUrl && provider === 'custom') {
    throw new Error('Custom provider requires baseUrl');
  }
  if (!baseUrl && !preset && effectiveProvider !== 'openai') {
    throw new Error(`Provider "${config.provider}" requires baseUrl`);
  }

  return {
    id: config.model,
    name: config.model,
    api,
    provider,
    baseUrl: baseUrl || '',
    reasoning: true, // Enable reasoning field support
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens,
  };
}

/**
 * Generate text using the configured AI provider
 */
export async function generateText(
  config: AIConfig,
  args: {
    system: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('API Key not configured. Please set up in Settings.');
  }

  const model = toPiAiModel(config);
  const options: SimpleStreamOptions = {
    apiKey: config.apiKey,
    temperature: args.temperature || 0.8,
    maxTokens: args.maxTokens,
  };

  const response = await completeSimple(model, {
    systemPrompt: args.system,
    messages: [{ role: 'user', content: args.prompt, timestamp: Date.now() }],
  }, options);

  if (response.stopReason === 'error') {
    throw new Error(response.errorMessage || 'An error occurred during generation');
  }
  if (isTruncatedStopReason(response.stopReason)) {
    throw new Error(`AI 输出被截断（stopReason=${response.stopReason}）`);
  }
  if (response.stopReason === 'aborted') {
    throw new Error(response.errorMessage || 'Generation aborted');
  }

  // pi-ai automatically collects content from reasoning fields and content fields
  return response.content.map(c => c.type === 'text' ? c.text : '').join('').trim();
}

/**
 * Classify error types for retry/fallback decisions
 */
type ErrorType = 'rate_limit' | 'server_error' | 'timeout' | 'auth_error' | 'invalid_request' | 'truncated' | 'unknown';

function isTruncatedStopReason(stopReason?: string): boolean {
  if (!stopReason) return false;
  const normalized = stopReason.trim().toLowerCase();
  return normalized === 'length' || normalized === 'max_tokens' || normalized === 'maxtokens';
}

function classifyError(error: Error): ErrorType {
  const message = error.message.toLowerCase();

  if (message.includes('输出被截断') || message.includes('truncated') || message.includes('stopreason=length')) {
    return 'truncated';
  }
  if (message.includes('quota') || message.includes('429') || message.includes('rate')) {
    return 'rate_limit';
  }
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('server')) {
    return 'server_error';
  }
  if (message.includes('timeout') || message.includes('timed out') || message.includes('aborted') || error.name === 'AbortError' || error.name === 'TimeoutError') {
    return 'timeout';
  }
  if (message.includes('401') || message.includes('403') || message.includes('unauthorized') || message.includes('invalid api key')) {
    return 'auth_error';
  }
  if (message.includes('404') || message.includes('not found')) {
    return 'invalid_request';
  }
  if (message.includes('400') || message.includes('invalid')) {
    return 'invalid_request';
  }
  return 'unknown';
}

/**
 * Check if error is retryable
 */
function isRetryableError(errorType: ErrorType): boolean {
  return ['rate_limit', 'server_error', 'timeout', 'truncated', 'unknown'].includes(errorType);
}

/**
 * Get delay for retry based on error type and attempt number
 */
function getRetryDelay(errorType: ErrorType, attempt: number): number {
  if (errorType === 'truncated') {
    return 0;
  }
  if (errorType === 'rate_limit') {
    return 10000 * Math.pow(2, attempt);
  }
  if (errorType === 'server_error') {
    return 3000 * (attempt + 1);
  }
  return 2000 * (attempt + 1);
}

function isGeminiConfig(config: AIConfig): boolean {
  const preset = getProviderPreset(normalizeProviderId(config.provider));
  if (preset?.protocol === 'gemini') return true;
  return /generativelanguage\.googleapis\.com/i.test(String(config.baseUrl || ''));
}

function getAutoExpandTokenCap(config: AIConfig): number {
  if (isGeminiConfig(config)) {
    return MAX_AUTO_EXPAND_OUTPUT_TOKENS;
  }
  return 12000;
}

function getNextExpandedMaxTokens(current: number | undefined, cap: number): number | null {
  if (current === undefined || !Number.isFinite(current) || current <= 0) {
    return Math.min(8192, cap);
  }
  if (current >= cap) {
    return null;
  }
  const next = Math.ceil(current * 1.5);
  return Math.min(Math.max(current + 512, next), cap);
}

/**
 * Generate text with retry logic
 */
export async function generateTextWithRetry(
  config: AIConfig,
  args: Parameters<typeof generateText>[1],
  maxRetries = 5
): Promise<string> {
  let lastError: Error | undefined;
  const requestArgs: Parameters<typeof generateText>[1] = { ...args };

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await generateText(config, requestArgs);
    } catch (error) {
      lastError = error as Error;
      const errorType = classifyError(lastError);
      console.warn(`Generation attempt ${i + 1} failed (${errorType}):`, lastError.message);

      if (errorType === 'truncated') {
        const cap = getAutoExpandTokenCap(config);
        const nextMaxTokens = getNextExpandedMaxTokens(requestArgs.maxTokens, cap);
        if (nextMaxTokens !== null) {
          requestArgs.maxTokens = nextMaxTokens;
          console.warn(
            `Detected truncated output, retrying with higher maxTokens=${nextMaxTokens} (cap=${cap})`
          );
          continue;
        }
      }

      if (!isRetryableError(errorType)) {
        throw lastError;
      }

      await sleep(getRetryDelay(errorType, i));
    }
  }

  throw new Error(`Failed after ${maxRetries} retries: ${lastError?.message}`);
}

/**
 * Fallback configuration for multi-provider redundancy
 */
export interface FallbackConfig {
  primary: AIConfig;
  fallback?: AIConfig[];
  switchConditions?: ErrorType[];
}

/**
 * Generate text with fallback to alternative providers
 */
export async function generateTextWithFallback(
  configs: FallbackConfig,
  args: Parameters<typeof generateText>[1],
  maxRetriesPerProvider = 2
): Promise<string> {
  const allConfigs = [configs.primary, ...(configs.fallback || [])];
  const switchOn = configs.switchConditions || ['rate_limit', 'server_error', 'timeout'];

  let lastError: Error | undefined;

  for (let providerIndex = 0; providerIndex < allConfigs.length; providerIndex++) {
    const config = allConfigs[providerIndex];
    const isLastProvider = providerIndex === allConfigs.length - 1;

    for (let attempt = 0; attempt < maxRetriesPerProvider; attempt++) {
      try {
        return await generateText(config, args);
      } catch (error) {
        lastError = error as Error;
        const errorType = classifyError(lastError);

        console.warn(
          `Provider ${config.provider}/${config.model} attempt ${attempt + 1} failed (${errorType}):`,
          lastError.message
        );

        if (!isRetryableError(errorType)) {
          if (!isLastProvider) {
            console.log(`Switching to fallback provider...`);
            break;
          }
          throw lastError;
        }

        if (attempt === maxRetriesPerProvider - 1 && switchOn.includes(errorType) && !isLastProvider) {
          console.log(`Switching to fallback provider after ${errorType}...`);
          break;
        }

        await sleep(getRetryDelay(errorType, attempt));
      }
    }
  }

  throw new Error(`All providers failed. Last error: ${lastError?.message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Streaming text generation arguments
 */
export interface StreamGenerateArgs {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Generate text with streaming output using the configured AI provider
 */
export async function* generateTextStream(
  config: AIConfig,
  args: StreamGenerateArgs
): AsyncGenerator<string, void, unknown> {
  if (!config.apiKey) {
    throw new Error('API Key not configured. Please set up in Settings.');
  }

  const model = toPiAiModel(config);
  const options: SimpleStreamOptions = {
    apiKey: config.apiKey,
    temperature: args.temperature || 0.8,
    maxTokens: args.maxTokens,
  };

  const stream = streamSimple(model, {
    systemPrompt: args.system,
    messages: [{ role: 'user', content: args.prompt, timestamp: Date.now() }],
  }, options);

  for await (const event of stream) {
    if (event.type === 'text_delta') {
      yield event.delta;
    } else if (event.type === 'thinking_delta') {
      // In this project, we might want to skip thinking delta or wrap it.
      // For now, let's yield it if it's text-like, or just focus on text_delta for the chapter content.
      // DeepSeek/GLM reasoning is often followed by content.
      // If the user wants to see reasoning, we could yield it with a prefix.
      // But for chapter generation, we usually only want the final content.
      // However, some models put content in reasoning. pi-ai's text_delta should be correct.
    } else if (event.type === 'error') {
      throw new Error(event.error.errorMessage || 'Streaming error');
    }
  }
}

/**
 * Generate text with streaming and collect the full result
 */
export async function generateTextStreamCollect(
  config: AIConfig,
  args: StreamGenerateArgs,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of generateTextStream(config, args)) {
    chunks.push(chunk);
    if (onChunk) {
      onChunk(chunk);
    }
  }

  const result = chunks.join('');
  if (!result.trim()) {
    throw new Error('Empty model response');
  }

  return result.trim();
}

/**
 * Extract AI config from request headers
 */
export function getAIConfigFromHeaders(headers: Record<string, string | string[] | undefined> | any): AIConfig | null {
  const getHeader = (key: string): string | undefined => {
    if (typeof headers.get === 'function') return headers.get(key);
    if (typeof headers.header === 'function') return headers.header(key);
    return headers[key] as string;
  };

  const provider = getHeader('x-ai-provider') || getHeader('X-AI-Provider');
  const model = getHeader('x-ai-model') || getHeader('X-AI-Model');
  const apiKey = getHeader('x-ai-key') || getHeader('X-AI-Key');
  const baseUrl = getHeader('x-ai-baseurl') || getHeader('X-AI-BaseUrl');

  if (!provider || !model || !apiKey) {
    return null;
  }

  return {
    provider: normalizeProviderId(provider) as AIProvider,
    model: model as string,
    apiKey: apiKey as string,
    baseUrl: baseUrl as string,
  };
}

/**
 * Get AI config from Model Registry (server-side, admin-configured)
 */
export async function getAIConfigFromRegistry(db: D1Database, featureKey?: string): Promise<AIConfig | null> {
  try {
    let model: any = null;

    if (featureKey) {
      const mapping = await db.prepare(
        `SELECT m.*, p.api_key_encrypted as provider_api_key, p.base_url as provider_base_url, p.id as provider_id, fmm.temperature as override_temperature 
       FROM feature_model_mappings fmm
       JOIN model_registry m ON fmm.model_id = m.id
       JOIN provider_registry p ON m.provider_id = p.id
       WHERE fmm.feature_key = ? AND m.is_active = 1`
      ).bind(featureKey).first();

      if (mapping) {
        model = mapping;
      }
    }

    if (!model) {
      model = await db.prepare(
        `SELECT m.*, p.api_key_encrypted as provider_api_key, p.base_url as provider_base_url, p.id as provider_id
         FROM model_registry m
         JOIN provider_registry p ON m.provider_id = p.id
         WHERE m.is_default = 1 AND m.is_active = 1 LIMIT 1`
      ).first();
    }

    if (!model) {
      model = await db.prepare(
        `SELECT m.*, p.api_key_encrypted as provider_api_key, p.base_url as provider_base_url, p.id as provider_id
         FROM model_registry m
         JOIN provider_registry p ON m.provider_id = p.id
         WHERE m.is_active = 1 LIMIT 1`
      ).first();

      if (!model) return null;
    }

    return {
      provider: normalizeProviderId(model.provider_id) as AIProvider,
      model: model.model_name,
      apiKey: model.provider_api_key || '',
      baseUrl: model.provider_base_url || undefined,
    };
  } catch (error) {
    console.error('Failed to get AI config from registry:', error);
    return null;
  }
}
