

import { Bot } from 'lucide-react';
import { useAIConfig, PROVIDER_MODELS, type AIProvider } from '@/hooks/useAIConfig';
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
  const { config, saveConfig, switchProvider } = useAIConfig();
  
  const currentModels = PROVIDER_MODELS[config.provider] || [];

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
      </div>
    </div>
  );
}
