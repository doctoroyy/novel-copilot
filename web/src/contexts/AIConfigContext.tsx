import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { testAIConnection as apiTestConnection, type ProviderPreset } from '@/lib/api';

export type AIProvider = string;

// Per-provider settings
export interface ProviderSettings {
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  // Store settings per-provider for quick switching
  providerSettings?: Record<string, ProviderSettings>;
}

const STORAGE_KEY = 'novel-copilot-ai-config';
const DEFAULT_PROVIDER = 'openai';
const PROVIDER_ALIASES: Record<string, string> = {
  zhipu: 'zai',
  glm: 'zai',
  bigmodel: 'zai',
  'z-ai': 'zai',
  kimi: 'moonshot',
  dashscope: 'qwen',
  aliyun: 'qwen',
  bailian: 'qwen',
  grok: 'xai',
};

export const BUILTIN_PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', protocol: 'openai', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', protocol: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com' },
  { id: 'gemini', label: 'Google Gemini', protocol: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com' },
  { id: 'deepseek', label: 'DeepSeek', protocol: 'openai', defaultBaseUrl: 'https://api.deepseek.com/v1' },
  { id: 'zai', label: 'Zhipu GLM (zAI)', protocol: 'openai', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'moonshot', label: 'Moonshot (Kimi)', protocol: 'openai', defaultBaseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'qwen', label: 'Qwen / DashScope', protocol: 'openai', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'openrouter', label: 'OpenRouter', protocol: 'openai', defaultBaseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', label: 'Groq', protocol: 'openai', defaultBaseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'xai', label: 'xAI', protocol: 'openai', defaultBaseUrl: 'https://api.x.ai/v1' },
  { id: 'together', label: 'Together AI', protocol: 'openai', defaultBaseUrl: 'https://api.together.xyz/v1' },
  { id: 'siliconflow', label: 'SiliconFlow', protocol: 'openai', defaultBaseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'mistral', label: 'Mistral', protocol: 'openai', defaultBaseUrl: 'https://api.mistral.ai/v1' },
  { id: 'fireworks', label: 'Fireworks AI', protocol: 'openai', defaultBaseUrl: 'https://api.fireworks.ai/inference/v1' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', protocol: 'openai', isCustom: true },
];

export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o1', 'o1-mini'],
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  zai: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  qwen: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
  openrouter: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet'],
  groq: ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b'],
  xai: ['grok-2-latest', 'grok-2-vision-latest'],
  together: ['meta-llama/Llama-3.1-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
  siliconflow: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
  mistral: ['mistral-large-latest', 'mistral-small-latest'],
  fireworks: ['accounts/fireworks/models/llama-v3p1-8b-instruct'],
  custom: [],
};

const DEFAULT_PROVIDER_SETTINGS: Record<string, ProviderSettings> = Object.fromEntries(
  BUILTIN_PROVIDER_PRESETS.map((preset) => [
    preset.id,
    {
      model: PROVIDER_MODELS[preset.id]?.[0] || '',
      baseUrl: preset.defaultBaseUrl || '',
    },
  ])
);

const DEFAULT_CONFIG: AIConfig = {
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_PROVIDER_SETTINGS[DEFAULT_PROVIDER]?.model || '',
  apiKey: '',
  baseUrl: DEFAULT_PROVIDER_SETTINGS[DEFAULT_PROVIDER]?.baseUrl || '',
  providerSettings: { ...DEFAULT_PROVIDER_SETTINGS },
};

interface AIConfigContextValue {
  config: AIConfig;
  loaded: boolean;
  saveConfig: (newConfig: Partial<AIConfig>) => AIConfig;
  switchProvider: (provider: AIProvider) => void;
  getProviderSettings: (provider: AIProvider) => ProviderSettings;
  testConnection: (configOverride?: Partial<AIConfig>) => Promise<{ success: boolean; message: string }>;
  maskedApiKey: string;
  isConfigured: boolean;
}

const AIConfigContext = createContext<AIConfigContextValue | null>(null);

function normalizeProvider(provider?: string): string {
  const normalized = String(provider || '').trim().toLowerCase();
  if (!normalized) return DEFAULT_PROVIDER;
  return PROVIDER_ALIASES[normalized] || normalized;
}

function getFallbackProviderSettings(provider: string): ProviderSettings {
  return DEFAULT_PROVIDER_SETTINGS[provider] || { model: '', baseUrl: '' };
}

function normalizeStoredProviderSettings(raw: unknown): Record<string, ProviderSettings> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const result: Record<string, ProviderSettings> = {};
  for (const [providerKey, settings] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedProvider = normalizeProvider(providerKey);
    const fallback = getFallbackProviderSettings(normalizedProvider);
    const current = settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>)
      : {};

    result[normalizedProvider] = {
      model: String(current.model || fallback.model || ''),
      baseUrl: String(current.baseUrl || fallback.baseUrl || ''),
      apiKey: String(current.apiKey || ''),
    };
  }
  return result;
}

export function AIConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AIConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AIConfig>;
        const provider = normalizeProvider(parsed.provider);
        const mergedProviderSettings = {
          ...DEFAULT_PROVIDER_SETTINGS,
          ...normalizeStoredProviderSettings(parsed.providerSettings),
        };
        const activeSettings = mergedProviderSettings[provider] || getFallbackProviderSettings(provider);

        setConfig({
          ...DEFAULT_CONFIG,
          ...parsed,
          provider,
          model: String(parsed.model || activeSettings.model || ''),
          apiKey: String(parsed.apiKey || activeSettings.apiKey || ''),
          baseUrl: String(parsed.baseUrl || activeSettings.baseUrl || ''),
          providerSettings: mergedProviderSettings,
        });
      }
    } catch (err) {
      console.error('Failed to load AI config from localStorage:', err);
    }
    setLoaded(true);
  }, []);

  // Get settings for a specific provider
  const getProviderSettings = useCallback((provider: AIProvider): ProviderSettings => {
    const normalizedProvider = normalizeProvider(provider);
    return config.providerSettings?.[normalizedProvider] || getFallbackProviderSettings(normalizedProvider);
  }, [config.providerSettings]);

  // Switch to a different provider, restoring its saved settings
  const switchProvider = useCallback((provider: AIProvider) => {
    const normalizedProvider = normalizeProvider(provider);

    setConfig((prevConfig) => {
      const providerSettings = prevConfig.providerSettings?.[normalizedProvider]
        || getFallbackProviderSettings(normalizedProvider);

      const updated: AIConfig = {
        ...prevConfig,
        provider: normalizedProvider,
        model: providerSettings.model,
        baseUrl: providerSettings.baseUrl || '',
        apiKey: providerSettings.apiKey || '',
      };

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to save AI config to localStorage:', err);
      }
      return updated;
    });
  }, []);

  // Save to localStorage and update per-provider settings
  const saveConfig = useCallback((newConfig: Partial<AIConfig>) => {
    let finalConfig: AIConfig = config;

    setConfig((prevConfig) => {
      const hasProviderOverride = Object.prototype.hasOwnProperty.call(newConfig, 'provider');
      const nextProvider = normalizeProvider(hasProviderOverride ? newConfig.provider : prevConfig.provider);
      const providerChanged = nextProvider !== prevConfig.provider;
      const fallbackForProvider = prevConfig.providerSettings?.[nextProvider] || getFallbackProviderSettings(nextProvider);

      const updated: AIConfig = {
        ...prevConfig,
        ...newConfig,
        provider: nextProvider,
      };

      const model = Object.prototype.hasOwnProperty.call(newConfig, 'model')
        ? String(newConfig.model || '')
        : providerChanged
          ? String(fallbackForProvider.model || '')
          : String(updated.model || '');

      const baseUrl = Object.prototype.hasOwnProperty.call(newConfig, 'baseUrl')
        ? String(newConfig.baseUrl || '')
        : providerChanged
          ? String(fallbackForProvider.baseUrl || '')
          : String(updated.baseUrl || '');

      const apiKey = Object.prototype.hasOwnProperty.call(newConfig, 'apiKey')
        ? String(newConfig.apiKey || '')
        : providerChanged
          ? String(fallbackForProvider.apiKey || '')
          : String(updated.apiKey || '');

      updated.model = model;
      updated.baseUrl = baseUrl;
      updated.apiKey = apiKey;

      const currentProviderSettings = prevConfig.providerSettings?.[nextProvider] || fallbackForProvider;

      const updatedProviderSettings = {
        ...prevConfig.providerSettings,
        [nextProvider]: {
          ...currentProviderSettings,
          model,
          baseUrl,
          apiKey,
        },
      };

      updated.providerSettings = updatedProviderSettings;

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to save AI config to localStorage:', err);
      }

      finalConfig = updated;
      return updated;
    });

    return finalConfig;
  }, [config]);

  // Get masked API key for display
  const maskedApiKey = config.apiKey
    ? `${config.apiKey.slice(0, 8)}...${config.apiKey.slice(-4)}`
    : '';

  // AI config is now server-managed via Model Registry — always considered configured
  const isConfigured = true;

  // Test current or modified connection
  const testConnection = useCallback(async (configOverride?: Partial<AIConfig>) => {
    const testConfig = {
      provider: configOverride?.provider || config.provider,
      model: configOverride?.model || config.model,
      apiKey: configOverride?.apiKey || config.apiKey,
      baseUrl: configOverride?.baseUrl || config.baseUrl,
    };
    return await apiTestConnection(testConfig);
  }, [config]);

  return (
    <AIConfigContext.Provider value={{
      config,
      loaded,
      saveConfig,
      switchProvider,
      getProviderSettings,
      testConnection,
      maskedApiKey,
      isConfigured
    }}>
      {children}
    </AIConfigContext.Provider>
  );
}

export function useAIConfig() {
  const context = useContext(AIConfigContext);
  if (!context) {
    throw new Error('useAIConfig must be used within an AIConfigProvider');
  }
  return context;
}

// AI config is now managed server-side via Model Registry.
// This function returns empty headers to maintain backward compatibility
// with existing call sites across the frontend.
export function getAIConfigHeaders(_config?: AIConfig): Record<string, string> {
  return {};
}
