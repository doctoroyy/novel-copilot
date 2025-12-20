import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type AIProvider = 'gemini' | 'openai' | 'deepseek' | 'custom';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

const STORAGE_KEY = 'novel-copilot-ai-config';

const DEFAULT_CONFIG: AIConfig = {
  provider: 'gemini',
  model: 'gemini-3-flash-preview',
  apiKey: '',
  baseUrl: '',
};

export const PROVIDER_MODELS: Record<AIProvider, string[]> = {
  gemini: [
    'gemini-3-flash-preview',
    'gemini-3-pro-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite-preview-06-17',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-thinking-exp',
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
  custom: [],
};

interface AIConfigContextValue {
  config: AIConfig;
  loaded: boolean;
  saveConfig: (newConfig: Partial<AIConfig>) => AIConfig;
  maskedApiKey: string;
  isConfigured: boolean;
}

const AIConfigContext = createContext<AIConfigContextValue | null>(null);

export function AIConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AIConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AIConfig;
        setConfig({ ...DEFAULT_CONFIG, ...parsed });
      }
    } catch (err) {
      console.error('Failed to load AI config from localStorage:', err);
    }
    setLoaded(true);
  }, []);

  // Save to localStorage
  const saveConfig = useCallback((newConfig: Partial<AIConfig>) => {
    setConfig(prevConfig => {
      const updated = { ...prevConfig, ...newConfig };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to save AI config to localStorage:', err);
      }
      return updated;
    });
    // Return the updated config (need to compute it here too)
    const updated = { ...config, ...newConfig };
    return updated;
  }, [config]);

  // Get masked API key for display
  const maskedApiKey = config.apiKey
    ? `${config.apiKey.slice(0, 8)}...${config.apiKey.slice(-4)}`
    : '';

  // Check if config is valid
  const isConfigured = !!(config.apiKey && config.model);

  return (
    <AIConfigContext.Provider value={{ config, loaded, saveConfig, maskedApiKey, isConfigured }}>
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

// Helper to get config headers for API requests
export function getAIConfigHeaders(config: AIConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  
  if (config.provider) headers['X-AI-Provider'] = config.provider;
  if (config.model) headers['X-AI-Model'] = config.model;
  if (config.apiKey) headers['X-AI-Key'] = config.apiKey;
  if (config.baseUrl) headers['X-AI-BaseUrl'] = config.baseUrl;
  
  return headers;
}
