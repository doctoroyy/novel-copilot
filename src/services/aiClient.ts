// AI Client for Cloudflare Workers (using native fetch)
import { TIMEOUTS } from '../config/timeouts.js';

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
  }
): Promise<string> {
  const { system, prompt, temperature = 0.8 } = args;

  if (!config.apiKey) {
    throw new Error('API Key not configured. Please set up in Settings.');
  }

  if (config.provider === 'gemini') {
    return generateWithGemini(config, system, prompt, temperature);
  } else {
    return generateWithOpenAI(config, system, prompt, temperature);
  }
}

/**
 * Generate with Gemini API using fetch
 */
async function generateWithGemini(
  config: AIConfig,
  system: string,
  prompt: string,
  temperature: number
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.AI_REQUEST);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature },
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const error = await response.json() as any;
      throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text?.trim()) {
      throw new Error('Empty model response');
    }

    return text.trim();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('AI 请求超时（超过5分钟），请重试或检查网络连接');
    }
    throw error;
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
  temperature: number
): Promise<string> {
  const baseUrl = config.baseUrl || 
    (config.provider === 'openai' ? 'https://api.openai.com/v1' : 
     config.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 
     config.baseUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.AI_REQUEST);

  try {
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
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json() as any;
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content;

    if (!text?.trim()) {
      throw new Error('Empty model response');
    }

    return text.trim();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('AI 请求超时（超过5分钟），请重试或检查网络连接');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate text with retry logic
 */
export async function generateTextWithRetry(
  config: AIConfig,
  args: Parameters<typeof generateText>[1],
  maxRetries = 3
): Promise<string> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await generateText(config, args);
    } catch (error) {
      lastError = error as Error;
      console.warn(`Generation attempt ${i + 1} failed:`, lastError.message);

      // Wait longer for quota errors
      if (lastError.message.includes('quota') || 
          lastError.message.includes('429') ||
          lastError.message.includes('rate')) {
        await sleep(5000 * (i + 1));
      } else {
        await sleep(1000 * (i + 1));
      }
    }
  }

  throw new Error(`Failed after ${maxRetries} retries: ${lastError?.message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
