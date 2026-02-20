

import { useState } from 'react';
import { Bot, Loader2, CheckCircle2, AlertCircle, Wifi } from 'lucide-react';
import { useAIConfig, PROVIDER_MODELS, type AIProvider } from '@/hooks/useAIConfig';
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

const PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'custom', label: 'Custom Protocol' },
];

export function AIConfigSection() {
  const { config, saveConfig, switchProvider, testConnection } = useAIConfig();
  const { toast } = useToast();
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const currentModels = PROVIDER_MODELS[config.provider] || [];

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
              {PROVIDERS.map((provider) => (
                <SelectItem key={provider.value} value={provider.value}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Model Selector / Input */}
        <div className="grid gap-1.5">
          <label className="text-xs font-medium">模型 (Model)</label>
          {currentModels.length > 0 ? (
            <Select
              value={config.model}
              onValueChange={(value) => saveConfig({ model: value })}
            >
              <SelectTrigger className="w-full text-xs h-9">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {currentModels.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="h-9 text-sm"
              placeholder="e.g. gpt-4-turbo"
              value={config.model}
              onChange={(e) => saveConfig({ model: e.target.value })}
            />
          )}
        </div>

        {/* Base URL (Conditional) */}
        {(config.provider === 'openai' || config.provider === 'custom') && (
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">API Base URL</label>
            <Input
              className="h-9 text-sm"
              placeholder={config.provider === 'openai' ? "Optional (default: https://api.openai.com/v1)" : "Required"}
              value={config.baseUrl || ''}
              onChange={(e) => saveConfig({ baseUrl: e.target.value })}
            />
          </div>
        )}

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
            disabled={isTesting || !config.apiKey}
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
