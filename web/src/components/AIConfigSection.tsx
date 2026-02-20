
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

  const currentModels = PROVIDER_MODELS[config.provider] || [];
  const currentPreset = providerOptions.find((item) => item.id === config.provider);

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection();
      setTestResult(result);
      if (result.success) {
        toast({
          title: '连接成功',
          description: result.message,
        });
      } else {
        toast({
          variant: 'destructive',
          title: '连接失败',
          description: result.message,
        });
      }
    } catch (err) {
      const message = (err as Error).message;
      setTestResult({ success: false, message });
      toast({
        variant: 'destructive',
        title: '连接异常',
        description: message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const suggestedPlaceholder = currentModels[0] || 'e.g. gpt-4o';

  return (
    <div className="p-4 rounded-lg border bg-muted/30 space-y-4">
      <div className="flex items-center gap-3">
        <Bot className="h-5 w-5 text-primary" />
        <span className="font-medium text-sm">自定义模型配置</span>
      </div>

      <div className="space-y-3">
        {/* Provider Selector */}
        <div className="grid gap-1.5">
          <label className="text-xs font-medium">模型服务商 (Provider)</label>
          <Select
            value={config.provider}
            onValueChange={(value) => switchProvider(value as AIProvider)}
          >
            <SelectTrigger className="w-full text-xs h-9">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {providerOptions.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {isLoadingProviders ? '正在加载 provider 列表...' : '支持 OpenAI / Anthropic / Gemini / DeepSeek / GLM(zAI) / Qwen / Kimi 等主流供应商。'}
          </p>
        </div>

        {/* Model Input (with suggestions) */}
        <div className="grid gap-1.5">
          <label className="text-xs font-medium">模型 (Model)</label>
          <Input
            className="h-9 text-sm"
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
          <p className="text-[11px] text-muted-foreground">
            支持手动输入任意模型名{currentModels.length > 0 ? '，也可直接使用下拉建议。' : '。'}
          </p>
        </div>

        {/* Base URL */}
        <div className="grid gap-1.5">
          <label className="text-xs font-medium">API Base URL</label>
          <Input
            className="h-9 text-sm"
            placeholder={currentPreset?.defaultBaseUrl || 'https://api.example.com/v1'}
            value={config.baseUrl || ''}
            onChange={(e) => saveConfig({ baseUrl: e.target.value })}
          />
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              {currentPreset?.defaultBaseUrl
                ? `留空也可，系统会按 provider 默认地址处理（${currentPreset.defaultBaseUrl}）。`
                : '该 provider 没有默认地址，建议手动填写。'}
            </span>
            {currentPreset?.defaultBaseUrl && (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => saveConfig({ baseUrl: currentPreset.defaultBaseUrl || '' })}
              >
                填入默认地址
              </button>
            )}
          </div>
        </div>

        {/* API Key */}
        <div className="grid gap-1.5">
          <label className="text-xs font-medium">API Key</label>
          <Input
            type="password"
            className="h-9 text-sm"
            placeholder="sk-..."
            value={config.apiKey || ''}
            onChange={(e) => saveConfig({ apiKey: e.target.value })}
          />
        </div>

        {/* Test Connection Button */}
        <div className="pt-2 flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs h-9 gap-2"
            onClick={handleTest}
            disabled={isTesting || !config.apiKey || !config.model}
          >
            {isTesting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wifi className="h-3.5 w-3.5" />
            )}
            测试连接状态
          </Button>

          {testResult && (
            <div className={`text-[11px] flex items-start gap-2 p-2 rounded border ${testResult.success
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
