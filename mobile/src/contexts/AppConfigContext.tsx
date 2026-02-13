import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppConfig } from '../types/domain';
import { loadAppConfig, sanitizeAppConfig, saveAppConfig } from '../lib/storage';
import { DEFAULT_API_BASE_URL } from '../lib/constants';

type AppConfigContextValue = {
  config: AppConfig;
  loading: boolean;
  saving: boolean;
  updateConfig: (next: AppConfig) => Promise<void>;
  reloadConfig: () => Promise<void>;
};

const AppConfigContext = createContext<AppConfigContextValue | null>(null);

const DEFAULT_CONFIG: AppConfig = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
};

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reloadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadAppConfig();
      setConfig(sanitizeAppConfig(loaded));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadConfig();
  }, [reloadConfig]);

  const updateConfig = useCallback(async (next: AppConfig) => {
    const sanitized = sanitizeAppConfig(next);
    setSaving(true);
    try {
      await saveAppConfig(sanitized);
      setConfig(sanitized);
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo<AppConfigContextValue>(() => ({
    config,
    loading,
    saving,
    updateConfig,
    reloadConfig,
  }), [config, loading, saving, updateConfig, reloadConfig]);

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfigContextValue {
  const context = useContext(AppConfigContext);
  if (!context) {
    throw new Error('useAppConfig must be used within AppConfigProvider');
  }
  return context;
}
