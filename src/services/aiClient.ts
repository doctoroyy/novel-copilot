// AI Client for Cloudflare Workers (using native fetch)

export type AIProvider = 'gemini' | 'openai' | 'deepseek' | 'custom';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
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
  const { system, prompt, temperature = 0.8, maxTokens } = args;

  if (!config.apiKey) {
    throw new Error('API Key not configured. Please set up in Settings.');
  }

  if (config.provider === 'gemini') {
    return generateWithGemini(config, system, prompt, temperature, maxTokens);
  } else {
    return generateWithOpenAI(config, system, prompt, temperature, maxTokens);
  }
}

/**
 * Generate with Gemini API using fetch
 */
async function generateWithGemini(
  config: AIConfig,
  system: string,
  prompt: string,
  temperature: number,
  maxTokens?: number
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minutes timeout

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens
          },
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      let errorMessage = `Gemini API error: ${response.status}`;
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        try {
          const error = await response.json() as any;
          errorMessage = error.error?.message || errorMessage;
        } catch {
          // Skip
        }
      } else {
        try {
          const text = await response.text();
          errorMessage = `${errorMessage}. Response: ${text.slice(0, 200)}`;
        } catch {
          // Skip
        }
      }
      throw new Error(errorMessage);
    }

    const data = await response.json() as any;
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text?.trim()) {
      console.log('Gemini empty response. Full body:', JSON.stringify(data));
      throw new Error('Empty model response');
    }

    return text.trim();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate with OpenAI-compatible API using fetch
 */
async function generateWithOpenAI(
  config: AIConfig,
  system: string,
  prompt: string,
  temperature: number,
  maxTokens?: number
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minutes timeout

  try {
    const baseUrl = config.baseUrl ||
      (config.provider === 'openai' ? 'https://api.openai.com/v1' :
        config.provider === 'deepseek' ? 'https://api.deepseek.com/v1' :
          config.baseUrl);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorMessage = `API error: ${response.status} ${response.statusText}`;
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        try {
          const error = await response.json() as any;
          errorMessage = error.error?.message || error.message || errorMessage;
        } catch {
          // Fallback to default message
        }
      } else {
        try {
          const text = await response.text();
          errorMessage = `${errorMessage}. Response: ${text.slice(0, 200)}`;
        } catch {
          // Fallback to default message
        }
      }
      throw new Error(errorMessage);
    }

    const data = await response.json() as any;
    // Compatibility: check content, then reasoning/thinking fields (often used by models like GLM or DeepSeek)
    const message = data.choices?.[0]?.message;
    const text = message?.content || message?.reasoning_content || message?.reasoning || message?.thought;

    if (!text?.trim()) {
      console.log('Empty response from model. Full body:', JSON.stringify(data));
      throw new Error('Empty model response');
    }

    return text.trim();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Classify error types for retry/fallback decisions
 */
type ErrorType = 'rate_limit' | 'server_error' | 'timeout' | 'auth_error' | 'invalid_request' | 'unknown';

function classifyError(error: Error): ErrorType {
  const message = error.message.toLowerCase();

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
  return ['rate_limit', 'server_error', 'timeout', 'unknown'].includes(errorType);
}

/**
 * Get delay for retry based on error type and attempt number
 */
function getRetryDelay(errorType: ErrorType, attempt: number): number {
  if (errorType === 'rate_limit') {
    return 10000 * Math.pow(2, attempt);
  }
  if (errorType === 'server_error') {
    return 3000 * (attempt + 1);
  }
  return 2000 * (attempt + 1);
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

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await generateText(config, args);
    } catch (error) {
      lastError = error as Error;
      const errorType = classifyError(lastError);
      console.warn(`Generation attempt ${i + 1} failed (${errorType}):`, lastError.message);

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
  const { system, prompt, temperature = 0.8, maxTokens } = args;

  if (!config.apiKey) {
    throw new Error('API Key not configured. Please set up in Settings.');
  }

  if (config.provider === 'gemini') {
    yield* streamWithGemini(config, system, prompt, temperature, maxTokens);
  } else {
    yield* streamWithOpenAI(config, system, prompt, temperature, maxTokens);
  }
}

/**
 * Stream with Gemini API using SSE
 */
async function* streamWithGemini(
  config: AIConfig,
  system: string,
  prompt: string,
  temperature: number,
  maxTokens?: number
): AsyncGenerator<string, void, unknown> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:streamGenerateContent?key=${config.apiKey}&alt=sse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json() as any;
    throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
  }

  if (!response.body) {
    const fallbackText = await generateWithGemini(config, system, prompt, temperature, maxTokens);
    if (fallbackText) {
      yield fallbackText;
      return;
    }
    throw new Error('No response body for streaming');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr && jsonStr !== '[DONE]') {
            try {
              const data = JSON.parse(jsonStr);
              const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                yield text;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream with OpenAI-compatible API using SSE
 */
async function* streamWithOpenAI(
  config: AIConfig,
  system: string,
  prompt: string,
  temperature: number,
  maxTokens?: number
): AsyncGenerator<string, void, unknown> {
  const baseUrl = config.baseUrl ||
    (config.provider === 'openai' ? 'https://api.openai.com/v1' :
      config.provider === 'deepseek' ? 'https://api.deepseek.com/v1' :
        config.baseUrl);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!response.ok) {
    let errorMessage = `API error: ${response.status} ${response.statusText}`;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      try {
        const error = await response.json() as any;
        errorMessage = error.error?.message || error.message || errorMessage;
      } catch {
        // Fallback
      }
    } else {
      try {
        const text = await response.text();
        errorMessage = `${errorMessage}. Response: ${text.slice(0, 200)}`;
      } catch {
        // Fallback
      }
    }
    throw new Error(errorMessage);
  }

  if (!response.body) {
    const fallbackText = await generateWithOpenAI(config, system, prompt, temperature, maxTokens);
    if (fallbackText) {
      yield fallbackText;
      return;
    }
    throw new Error('No response body for streaming');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr && jsonStr !== '[DONE]') {
            try {
              const data = JSON.parse(jsonStr);
              const delta = data.choices?.[0]?.delta;
              const content = delta?.content || delta?.reasoning_content || delta?.reasoning || delta?.thought;
              if (content) {
                yield content;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
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
    provider: provider as AIProvider,
    model,
    apiKey,
    baseUrl,
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
        `SELECT m.*, fmm.temperature as override_temperature 
       FROM feature_model_mappings fmm
       JOIN model_registry m ON fmm.model_id = m.id
       WHERE fmm.feature_key = ? AND m.is_active = 1`
      ).bind(featureKey).first();

      if (mapping) {
        model = mapping;
      }
    }

    if (!model) {
      model = await db.prepare(
        'SELECT * FROM model_registry WHERE is_default = 1 AND is_active = 1 LIMIT 1'
      ).first();
    }

    if (!model) {
      model = await db.prepare(
        'SELECT * FROM model_registry WHERE is_active = 1 LIMIT 1'
      ).first();

      if (!model) return null;
    }

    return {
      provider: model.provider as AIProvider,
      model: model.model_name,
      apiKey: model.api_key_encrypted || '',
      baseUrl: model.base_url || undefined,
    };
  } catch (error) {
    console.error('Failed to get AI config from registry:', error);
    return null;
  }
}
