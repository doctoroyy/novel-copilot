import fs from 'node:fs/promises';
import path from 'node:path';

export type AIProvider = 'gemini' | 'openai' | 'deepseek' | 'custom';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl?: string; // for custom/openai-compatible providers
}

// Default configuration
const DEFAULT_CONFIG: AIConfig = {
  provider: 'gemini',
  model: 'gemini-2.0-flash',
  apiKey: '',
};

// Available models per provider (常用模型,用户也可自定义输入)
export const PROVIDER_MODELS: Record<AIProvider, string[]> = {
  gemini: [
    // Gemini 2.5 系列
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite-preview-06-17',
    // Gemini 2.0 系列
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-thinking-exp',
    // Gemini 1.5 系列
    'gemini-1.5-pro',
    'gemini-1.5-pro-002',
    'gemini-1.5-flash',
    'gemini-1.5-flash-002',
    'gemini-1.5-flash-8b',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o1-preview',
  ],
  deepseek: [
    'deepseek-chat',
    'deepseek-reasoner',
  ],
  custom: [], // User can specify any model
};

// Provider base URLs
export const PROVIDER_BASE_URLS: Partial<Record<AIProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

let cachedConfig: AIConfig | null = null;

/**
 * Load configuration from config.json
 */
export async function loadConfig(): Promise<AIConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content) as AIConfig;
    
    // Merge with defaults to ensure all fields exist
    cachedConfig = { ...DEFAULT_CONFIG, ...config };
    return cachedConfig;
  } catch (error) {
    // If file doesn't exist, try to get from env
    const envConfig: AIConfig = {
      provider: (process.env.AI_PROVIDER as AIProvider) || 'gemini',
      model: process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-2.0-flash',
      apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '',
      baseUrl: process.env.AI_BASE_URL,
    };
    
    cachedConfig = { ...DEFAULT_CONFIG, ...envConfig };
    return cachedConfig;
  }
}

/**
 * Save configuration to config.json
 */
export async function saveConfig(config: AIConfig): Promise<void> {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  cachedConfig = config;
}

/**
 * Get config with API key masked for client
 */
export function maskApiKey(config: AIConfig): AIConfig & { apiKeyMasked: string } {
  const masked = config.apiKey 
    ? `${config.apiKey.slice(0, 8)}...${config.apiKey.slice(-4)}`
    : '';
  return {
    ...config,
    apiKey: '', // Don't send actual key to client
    apiKeyMasked: masked,
  };
}

/**
 * Clear cached config (useful when config is updated)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}
