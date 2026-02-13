import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type AIProvider = 'gemini' | 'openai' | 'deepseek' | 'custom';

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
  providerSettings?: Partial<Record<AIProvider, ProviderSettings>>;
}

const STORAGE_KEY = 'novel-copilot-ai-config';

const DEFAULT_PROVIDER_SETTINGS: Record<AIProvider, ProviderSettings> = {
  gemini: { model: 'gemini-3-flash-preview', baseUrl: '' },
  openai: { model: 'gpt-4o', baseUrl: '' },
  deepseek: { model: 'deepseek-chat', baseUrl: '' },
  custom: { model: '', baseUrl: '' },
};

const DEFAULT_CONFIG: AIConfig = {
  provider: 'gemini',
  model: 'gemini-3-flash-preview',
  apiKey: '',
  baseUrl: '',
  providerSettings: { ...DEFAULT_PROVIDER_SETTINGS },
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
  switchProvider: (provider: AIProvider) => void;
  getProviderSettings: (provider: AIProvider) => ProviderSettings;
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
        // Merge with defaults to ensure all fields exist
        const mergedProviderSettings = {
          ...DEFAULT_PROVIDER_SETTINGS,
          ...parsed.providerSettings,
        };
        setConfig({ ...DEFAULT_CONFIG, ...parsed, providerSettings: mergedProviderSettings });
      }
    } catch (err) {
      console.error('Failed to load AI config from localStorage:', err);
    }
    setLoaded(true);
  }, []);

  // Get settings for a specific provider
  const getProviderSettings = useCallback((provider: AIProvider): ProviderSettings => {
    return config.providerSettings?.[provider] || DEFAULT_PROVIDER_SETTINGS[provider];
  }, [config.providerSettings]);

  // Switch to a different provider, restoring its saved settings
  const switchProvider = useCallback((provider: AIProvider) => {
    setConfig(prevConfig => {
      const providerSettings = prevConfig.providerSettings?.[provider] || DEFAULT_PROVIDER_SETTINGS[provider];
      const updated: AIConfig = {
        ...prevConfig,
        provider,
        model: providerSettings.model,
        baseUrl: providerSettings.baseUrl || '',
        apiKey: providerSettings.apiKey || '', // Restore API key for this provider
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
    
    setConfig(prevConfig => {
      // Start with current config merged with new values
      const updated = { ...prevConfig, ...newConfig };
      
      // If model, baseUrl, OR apiKey changed, save to per-provider settings
      const currentProvider = updated.provider; // Use updated provider
      const currentProviderSettings = prevConfig.providerSettings?.[currentProvider] || DEFAULT_PROVIDER_SETTINGS[currentProvider];
      
      const updatedProviderSettings = {
        ...prevConfig.providerSettings,
        [currentProvider]: {
          ...currentProviderSettings,
          model: updated.model,
          baseUrl: updated.baseUrl,
          apiKey: updated.apiKey, // Persist API key per provider
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

  return (
    <AIConfigContext.Provider value={{ 
      config, 
      loaded, 
      saveConfig, 
      switchProvider,
      getProviderSettings,
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

