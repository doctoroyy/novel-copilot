import { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, CheckCircle2, AlertCircle, Wifi } from 'lucide-react';
import {
  useAIConfig,
  PROVIDER_MODELS,
  BUILTIN_PROVIDER_PRESETS,
  type AIProvider
} from '@/hooks/useAIConfig';
import { fetchPublicProviderPresets, type ProviderPreset } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

export function AIConfigSection() {
  const { config, saveConfig, switchProvider, testConnection } = useAIConfig();
  const { toast } = useToast();
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [providerPresets, setProviderPresets] = useState<ProviderPreset[]>(BUILTIN_PROVIDER_PRESETS);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingProviders(true);

    fetchPublicProviderPresets()
      .then((providers) => {
        if (cancelled) return;
        if (providers.length > 0) {
          setProviderPresets(providers);
          return;
        }
        setProviderPresets(BUILTIN_PROVIDER_PRESETS);
      })
      .catch((err) => {
        console.warn('Failed to load provider presets:', err);
        if (!cancelled) {
          setProviderPresets(BUILTIN_PROVIDER_PRESETS);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingProviders(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Build provider list from presets + any user-configured provider not in presets
  const providerOptions = useMemo(() => {
    const list = [...providerPresets];
    if (!list.find((p) => p.id === config.provider) && config.provider) {
      list.push({
        id: config.provider,
        label: `${config.provider} (当前配置)`,
        protocol: 'openai',
        defaultBaseUrl: '',
      });
    }
    return list;
  }, [providerPresets, config.provider]);

  // Providers the user has configured (has apiKey set)
  const configuredProviders = useMemo(() => {
    const all = config.providerSettings || {};
    return providerOptions.filter((p) => {
      const settings = all[p.id];
      return settings?.apiKey;
    });
  }, [providerOptions, config.providerSettings]);

  const currentModels = PROVIDER_MODELS[config.provider] || [];
  const currentPreset = providerOptions.find((item) => item.id === config.provider);

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection();
      setTestResult(result);
      if (result.success) {
        toast({ title: '连接成功', description: result.message });
      } else {
        toast({ variant: 'destructive', title: '连接失败', description: result.message });
      }
    } catch (err) {
      const message = (err as Error).message;
      setTestResult({ success: false, message });
      toast({ variant: 'destructive', title: '连接异常', description: message });
    } finally {
      setIsTesting(false);
    }
  };

  const suggestedPlaceholder = currentModels[0] || 'e.g. gpt-4o';

  return (
    <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
      <div className="flex items-center gap-3">
        <Bot className="h-5 w-5 text-primary" />
        <span className="font-medium text-sm">自定义模型配置</span>
      </div>

      <div className="flex gap-3 min-h-[280px]">
        {/* Left: Provider mini-list */}
        <div className="w-[140px] flex-shrink-0 rounded-md border bg-background">
          <div className="p-2 border-b">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Provider</p>
          </div>
          <ScrollArea className="h-[250px]">
            <div className="p-1.5 space-y-0.5">
              {providerOptions.filter(p => !p.isCustom).map((provider) => {
                const isActive = provider.id === config.provider;
                const isConfigured = configuredProviders.some((c) => c.id === provider.id);
                return (
                  <button
                    key={provider.id}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center gap-1.5 ${
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted/60 text-foreground'
                    }`}
                    onClick={() => switchProvider(provider.id as AIProvider)}
                  >
                    {provider.color && (
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: provider.color }}
                      />
                    )}
                    <span className="truncate flex-1">{provider.label}</span>
                    {isConfigured && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
              {isLoadingProviders && (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right: Config form */}
        <div className="flex-1 min-w-0 space-y-2.5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold">{currentPreset?.label || config.provider}</span>
            {currentPreset?.protocol && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {currentPreset.protocol}
              </span>
            )}
          </div>

          {/* Model */}
          <div className="grid gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">模型 (Model)</label>
            <Input
              className="h-8 text-xs"
              placeholder={suggestedPlaceholder}
              value={config.model}
              onChange={(e) => saveConfig({ model: e.target.value })}
              list={`provider-models-${config.provider}`}
            />
            {currentModels.length > 0 && (
              <datalist id={`provider-models-${config.provider}`}>
                {currentModels.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            )}
          </div>

          {/* Base URL */}
          <div className="grid gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">API Base URL</label>
            <Input
              className="h-8 text-xs"
              placeholder={currentPreset?.defaultBaseUrl || 'https://api.example.com/v1'}
              value={config.baseUrl || ''}
              onChange={(e) => saveConfig({ baseUrl: e.target.value })}
            />
            {currentPreset?.defaultBaseUrl && config.baseUrl !== currentPreset.defaultBaseUrl && (
              <button
                type="button"
                className="text-[10px] text-primary underline underline-offset-2 text-left"
                onClick={() => saveConfig({ baseUrl: currentPreset.defaultBaseUrl || '' })}
              >
                填入默认地址
              </button>
            )}
          </div>

          {/* API Key */}
          <div className="grid gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">API Key</label>
            <Input
              type="password"
              className="h-8 text-xs"
              placeholder="sk-..."
              value={config.apiKey || ''}
              onChange={(e) => saveConfig({ apiKey: e.target.value })}
            />
          </div>

          {/* Test */}
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs h-8 gap-1.5"
            onClick={handleTest}
            disabled={isTesting || !config.apiKey || !config.model}
          >
            {isTesting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Wifi className="h-3 w-3" />
            )}
            测试连接
          </Button>

          {testResult && (
            <div className={`text-[10px] flex items-start gap-1.5 p-1.5 rounded border ${testResult.success
                ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
                : 'bg-destructive/10 border-destructive/20 text-destructive'
              }`}>
              {testResult.success ? (
                <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
              )}
              <span className="leading-tight">{testResult.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
