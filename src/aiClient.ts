import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

export type AIProvider = 'gemini' | 'openai' | 'deepseek' | 'custom';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

// Provider base URLs
const PROVIDER_BASE_URLS: Partial<Record<AIProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

/**
 * Generate text using the provided AI config
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
 * Generate with Gemini API
 */
async function generateWithGemini(
  config: AIConfig,
  system: string,
  prompt: string,
  temperature: number
): Promise<string> {
  const client = new GoogleGenAI({ apiKey: config.apiKey });
  
  const response = await client.models.generateContent({
    model: config.model,
    config: {
      systemInstruction: system,
      temperature,
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  // Extract text from response
  let text = '';
  if (response.text) {
    text = response.text;
  } else {
    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      text = candidate.content.parts
        .map((part) => ('text' in part ? part.text : ''))
        .join('');
    }
  }

  if (!text.trim()) {
    throw new Error('Empty model response');
  }

  return text.trim();
}

/**
 * Generate with OpenAI-compatible API (OpenAI, DeepSeek, custom)
 */
async function generateWithOpenAI(
  config: AIConfig,
  system: string,
  prompt: string,
  temperature: number
): Promise<string> {
  const baseUrl = config.baseUrl || PROVIDER_BASE_URLS[config.provider];
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: baseUrl });

  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature,
  });

  const text = response.choices[0]?.message?.content;
  
  if (!text?.trim()) {
    throw new Error('Empty model response');
  }

  return text.trim();
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

/**
 * Test API connection with provided config
 */
export async function testConnectionWithConfig(config: AIConfig): Promise<{ success: boolean; message: string; model?: string }> {
  try {
    if (!config.apiKey) {
      return { success: false, message: 'API Key not configured' };
    }

    const response = await generateText(config, {
      system: 'You are a helpful assistant.',
      prompt: 'Say "Hello" in one word.',
      temperature: 0,
    });

    return { 
      success: true, 
      message: `连接成功! 回复: "${response.trim()}"`,
      model: config.model,
    };
  } catch (error) {
    return { 
      success: false, 
      message: `连接失败: ${(error as Error).message}`,
    };
  }
}

/**
 * Extract AI config from request headers
 */
export function getAIConfigFromHeaders(headers: Record<string, string | string[] | undefined>): AIConfig | null {
  const provider = headers['x-ai-provider'] as string;
  const model = headers['x-ai-model'] as string;
  const apiKey = headers['x-ai-key'] as string;
  const baseUrl = headers['x-ai-baseurl'] as string | undefined;
  
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
