import { useEffect, useMemo, useState, useCallback } from 'react';
import { Check, Loader2, CheckCircle2, AlertCircle, ChevronDown, Eye, EyeOff, Sparkles, RefreshCw } from 'lucide-react';
import {
  useAIConfig,
  PROVIDER_MODELS,
  BUILTIN_PROVIDER_PRESETS,
  type AIProvider
} from '@/hooks/useAIConfig';
import { fetchPublicProviderPresets, fetchPublicRemoteModels, type ProviderPreset } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';

/**
 * Redesigned AI Provider configuration.
 * 
 * Flow: Pick provider → Paste API key → Auto-test → Done.
 * Model and Base URL are auto-filled with smart defaults.
 */
export function AIConfigSection() {
  const { config, saveConfig, switchProvider, testConnection } = useAIConfig();
  const { toast } = useToast();
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [providerPresets, setProviderPresets] = useState<ProviderPreset[]>(BUILTIN_PROVIDER_PRESETS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPublicProviderPresets()
      .then((providers) => {
        if (cancelled) return;
        if (providers.length > 0) setProviderPresets(providers);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const providerOptions = useMemo(() => {
    return providerPresets.filter(p => !p.isCustom);
  }, [providerPresets]);

  const currentPreset = providerOptions.find((item) => item.id === config.provider);
  const staticModels = PROVIDER_MODELS[config.provider] || [];
  const isConfigured = !!config.apiKey;

  // Dynamic model fetching
  const [remoteModels, setRemoteModels] = useState<{ id: string; name: string; displayName: string }[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsFetched, setModelsFetched] = useState<string | null>(null); // tracks provider+key combo

  const fetchModels = useCallback(async () => {
    if (!config.apiKey || !config.provider) return;
    setIsLoadingModels(true);
    try {
      const models = await fetchPublicRemoteModels(
        config.provider,
        config.apiKey,
        config.baseUrl || currentPreset?.defaultBaseUrl
      );
      setRemoteModels(models);
      setModelsFetched(`${config.provider}:${config.apiKey.slice(-6)}`);
    } catch {
      setRemoteModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  }, [config.provider, config.apiKey, config.baseUrl, currentPreset?.defaultBaseUrl]);

  // Auto-fetch models when API key is set and provider changes
  useEffect(() => {
    const key = `${config.provider}:${config.apiKey?.slice(-6) || ''}`;
    if (config.apiKey && key !== modelsFetched) {
      fetchModels();
    }
  }, [config.provider, config.apiKey, modelsFetched, fetchModels]);

  // Use remote models if available, fall back to static
  const currentModels = remoteModels.length > 0
    ? remoteModels.map(m => m.id)
    : staticModels;

  // Auto-test when apiKey changes and is non-empty
  const handleApiKeyChange = useCallback((value: string) => {
    saveConfig({ apiKey: value });
    setTestResult(null);
  }, [saveConfig]);

  const handleTest = async () => {
    if (!config.apiKey || !config.model) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection();
      setTestResult(result);
      if (result.success) {
        toast({ title: '✓ 连接成功', description: `${currentPreset?.label || config.provider} 已就绪` });
      }
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message });
    } finally {
      setIsTesting(false);
    }
  };

  const handleProviderSelect = (providerId: string) => {
    switchProvider(providerId as AIProvider);
    setTestResult(null);
    setShowAdvanced(false);
  };

  // Popular providers shown as cards (top tier)
  const popularProviders = ['openai', 'anthropic', 'gemini', 'deepseek'];
  const topProviders = providerOptions.filter(p => popularProviders.includes(p.id));
  const otherProviders = providerOptions.filter(p => !popularProviders.includes(p.id));

  return (
    <div className="space-y-4">
      {/* Step 1: Provider Selection */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            选择 AI 服务商
          </label>
          {isConfigured && testResult?.success && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              已连接
            </span>
          )}
        </div>

        {/* Top providers as visual cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {topProviders.map((provider) => {
            const isActive = provider.id === config.provider;
            const hasKey = !!(config.providerSettings?.[provider.id]?.apiKey);
            return (
              <button
                key={provider.id}
                onClick={() => handleProviderSelect(provider.id)}
                className={`
                  relative flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all duration-150
                  ${isActive
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30 shadow-sm'
                    : 'border-border/60 hover:border-border hover:bg-muted/40'
                  }
                `}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                  style={{ backgroundColor: provider.color || '#6b7280' }}
                >
                  {provider.label[0]}
                </div>
                <span className="text-[11px] font-medium truncate max-w-full">
                  {provider.label}
                </span>
                {hasKey && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500" />
                )}
              </button>
            );
          })}
        </div>

        {/* Other providers as compact list */}
        {otherProviders.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {otherProviders.map((provider) => {
              const isActive = provider.id === config.provider;
              const hasKey = !!(config.providerSettings?.[provider.id]?.apiKey);
              return (
                <button
                  key={provider.id}
                  onClick={() => handleProviderSelect(provider.id)}
                  className={`
                    inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all
                    ${isActive
                      ? 'bg-primary/10 text-primary border border-primary/30'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent'
                    }
                  `}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: provider.color || '#6b7280' }}
                  />
                  {provider.label}
                  {hasKey && <Check className="h-2.5 w-2.5 text-emerald-500" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Step 2: API Key (primary action) */}
      <div className="space-y-2 pt-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          API Key
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showKey ? 'text' : 'password'}
              className="h-9 text-sm pr-9 font-mono"
              placeholder={`输入 ${currentPreset?.label || 'API'} 密钥...`}
              value={config.apiKey || ''}
              onChange={(e) => handleApiKeyChange(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Button
            variant={testResult?.success ? 'default' : 'outline'}
            size="sm"
            className={`h-9 px-3 text-xs gap-1.5 shrink-0 ${testResult?.success ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}`}
            onClick={handleTest}
            disabled={isTesting || !config.apiKey || !config.model}
          >
            {isTesting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : testResult?.success ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {testResult?.success ? '已连接' : '验证'}
          </Button>
        </div>

        {testResult && !testResult.success && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/8 border border-destructive/20 text-[11px] text-destructive leading-relaxed">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>{testResult.message}</span>
          </div>
        )}
      </div>

      {/* Step 3: Model (auto-filled, editable) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              模型
            </label>
            {remoteModels.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {remoteModels.length} 个可用
              </span>
            )}
            {isLoadingModels && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex items-center gap-2">
            {config.apiKey && (
              <button
                onClick={fetchModels}
                disabled={isLoadingModels}
                className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
                title="从 API 刷新模型列表"
              >
                <RefreshCw className={`h-3 w-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                刷新
              </button>
            )}
            {!showAdvanced && config.baseUrl && config.baseUrl !== currentPreset?.defaultBaseUrl && (
              <button
                onClick={() => setShowAdvanced(true)}
                className="text-[10px] text-primary hover:underline"
              >
                自定义 URL 已配置
              </button>
            )}
          </div>
        </div>

        {currentModels.length > 0 ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="w-full h-9 px-3 flex items-center justify-between rounded-md border border-input bg-background text-sm hover:bg-muted/40 transition-colors"
            >
              <span className={config.model ? 'text-foreground font-mono text-xs' : 'text-muted-foreground'}>
                {config.model || '选择模型...'}
              </span>
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showModelPicker ? 'rotate-180' : ''}`} />
            </button>

            {showModelPicker && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-lg py-1 max-h-60 overflow-auto">
                {currentModels.map((model) => {
                  const remoteInfo = remoteModels.find(m => m.id === model);
                  return (
                    <button
                      key={model}
                      onClick={() => {
                        saveConfig({ model });
                        setShowModelPicker(false);
                        setTestResult(null);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        model === config.model
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'hover:bg-muted text-foreground'
                      }`}
                    >
                      <span className="font-mono">{remoteInfo?.displayName || model}</span>
                      {remoteInfo && remoteInfo.displayName !== model && (
                        <span className="ml-2 text-[10px] text-muted-foreground">{model}</span>
                      )}
                      {model === config.model && <Check className="inline h-3 w-3 ml-2" />}
                    </button>
                  );
                })}
                <div className="border-t mt-1 pt-1 px-3 py-1.5">
                  <Input
                    className="h-7 text-xs font-mono"
                    placeholder="或输入自定义模型名..."
                    value={config.model}
                    onChange={(e) => { saveConfig({ model: e.target.value }); setTestResult(null); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <Input
            className="h-9 text-xs font-mono"
            placeholder="输入模型名称 (如 gpt-4o)"
            value={config.model}
            onChange={(e) => { saveConfig({ model: e.target.value }); setTestResult(null); }}
          />
        )}
      </div>

      {/* Advanced: Base URL (hidden by default) */}
      <div>
        {!showAdvanced ? (
          <button
            onClick={() => setShowAdvanced(true)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ▸ 高级选项
          </button>
        ) : (
          <div className="space-y-2 p-3 rounded-md border border-dashed border-border/60 bg-muted/20">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                API Base URL
              </label>
              <button
                onClick={() => setShowAdvanced(false)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                收起
              </button>
            </div>
            <Input
              className="h-8 text-xs font-mono"
              placeholder={currentPreset?.defaultBaseUrl || 'https://api.example.com/v1'}
              value={config.baseUrl || ''}
              onChange={(e) => saveConfig({ baseUrl: e.target.value })}
            />
            {currentPreset?.defaultBaseUrl && config.baseUrl !== currentPreset.defaultBaseUrl && (
              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={() => saveConfig({ baseUrl: currentPreset.defaultBaseUrl || '' })}
              >
                恢复默认: {currentPreset.defaultBaseUrl}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
