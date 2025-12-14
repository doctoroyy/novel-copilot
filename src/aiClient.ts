import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { loadConfig, type AIConfig, PROVIDER_BASE_URLS } from './config.js';

// Cached clients
let geminiClient: GoogleGenAI | null = null;
let openaiClient: OpenAI | null = null;
let currentConfig: AIConfig | null = null;

/**
 * Initialize or get AI client based on current config
 */
async function getConfig(): Promise<AIConfig> {
  const config = await loadConfig();
  
  // Check if config changed
  if (currentConfig?.apiKey !== config.apiKey || 
      currentConfig?.provider !== config.provider ||
      currentConfig?.baseUrl !== config.baseUrl) {
    // Reset clients if config changed
    geminiClient = null;
    openaiClient = null;
    currentConfig = config;
  }
  
  return config;
}

function getGeminiClient(apiKey: string): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

function getOpenAIClient(apiKey: string, baseUrl?: string): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ 
      apiKey,
      baseURL: baseUrl,
    });
  }
  return openaiClient;
}

/**
 * Generate text using the configured AI provider
 */
export async function generateText(args: {
  system: string;
  prompt: string;
  temperature?: number;
}): Promise<string> {
  const { system, prompt, temperature = 0.8 } = args;
  const config = await getConfig();
  
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
  const client = getGeminiClient(config.apiKey);
  
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
  const client = getOpenAIClient(config.apiKey, baseUrl);

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
  args: Parameters<typeof generateText>[0],
  maxRetries = 3
): Promise<string> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await generateText(args);
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
 * Test API connection with current config
 */
export async function testConnection(): Promise<{ success: boolean; message: string; model?: string }> {
  const config = await getConfig();
  return testConnectionWithConfig(config);
}

/**
 * Test API connection with provided config (for testing before saving)
 */
export async function testConnectionWithConfig(config: AIConfig): Promise<{ success: boolean; message: string; model?: string }> {
  try {
    if (!config.apiKey) {
      return { success: false, message: 'API Key not configured' };
    }

    // Create temp client for testing
    let response: string;
    
    if (config.provider === 'gemini') {
      const tempClient = new GoogleGenAI({ apiKey: config.apiKey });
      const result = await tempClient.models.generateContent({
        model: config.model,
        config: {
          systemInstruction: 'You are a helpful assistant.',
          temperature: 0,
        },
        contents: [{ role: 'user', parts: [{ text: 'Say "Hello" in one word.' }] }],
      });
      response = result.text || '';
    } else {
      const baseUrl = config.baseUrl || PROVIDER_BASE_URLS[config.provider];
      const tempClient = new OpenAI({ apiKey: config.apiKey, baseURL: baseUrl });
      const result = await tempClient.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Say "Hello" in one word.' },
        ],
        temperature: 0,
      });
      response = result.choices[0]?.message?.content || '';
    }

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
 * Reset cached clients (call after config change)
 */
export function resetClients(): void {
  geminiClient = null;
  openaiClient = null;
  currentConfig = null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
