import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type AIProvider = 'gemini' | 'openai' | 'deepseek' | 'custom';

interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  apiKeyMasked: string;
  baseUrl?: string;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [providers, setProviders] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [provider, setProvider] = useState<AIProvider>('gemini');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Load config when dialog opens
  useEffect(() => {
    if (open) {
      loadConfig();
    }
  }, [open]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/config');
      const data = await response.json();
      
      if (data.success) {
        setConfig(data.config);
        setProviders(data.providers || {});
        setProvider(data.config.provider);
        setModel(data.config.model);
        setBaseUrl(data.config.baseUrl || '');
        setApiKey(''); // Don't show actual key
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const payload: Record<string, string> = {
        provider,
        model,
      };
      
      // Only include apiKey if user entered a new one
      if (apiKey.trim()) {
        payload.apiKey = apiKey;
      }
      
      // Include baseUrl for custom provider
      if (provider === 'custom' || provider === 'openai' || provider === 'deepseek') {
        payload.baseUrl = baseUrl || '';
      }
      
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setConfig(data.config);
        setApiKey(''); // Clear input after save
        setTestResult({ success: true, message: '配置已保存' });
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      
      // Get the current API key - either new input or from saved config
      const testApiKey = apiKey.trim() || config?.apiKey;
      
      if (!testApiKey) {
        setTestResult({ success: false, message: '请先输入 API Key' });
        return;
      }
      
      const response = await fetch('/api/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          apiKey: testApiKey,
          baseUrl: baseUrl || undefined,
        }),
      });
      
      const data = await response.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  // Get available models for current provider
  const availableModels = providers[provider] || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg glass-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>⚙️</span>
            <span>AI 设置</span>
          </DialogTitle>
          <DialogDescription>
            配置 AI Provider 和 API Key
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Provider Selection */}
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select 
              value={provider} 
              onValueChange={(val) => {
                setProvider(val as AIProvider);
                // Reset model when provider changes
                const models = providers[val] || [];
                setModel(models[0] || '');
              }}
            >
              <SelectTrigger className="bg-muted/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini">🔷 Gemini (Google)</SelectItem>
                <SelectItem value="openai">🟢 OpenAI</SelectItem>
                <SelectItem value="deepseek">🔵 DeepSeek</SelectItem>
                <SelectItem value="custom">⚡ Custom (OpenAI 兼容)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Model</Label>
              <span className="text-xs text-muted-foreground">可选择或自定义输入</span>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="输入或选择模型名称"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="flex-1 bg-muted/50"
                list="model-options"
              />
              {availableModels.length > 0 && (
                <datalist id="model-options">
                  {availableModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
            </div>
            {availableModels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {availableModels.slice(0, 5).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModel(m)}
                    className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                      model === m 
                        ? 'bg-primary text-primary-foreground' 
                        : 'bg-muted/50 hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    {m}
                  </button>
                ))}
                {availableModels.length > 5 && (
                  <span className="text-xs text-muted-foreground px-2">+{availableModels.length - 5} more</span>
                )}
              </div>
            )}
          </div>

          {/* Base URL (for custom/openai-compatible) */}
          {(provider === 'custom' || provider === 'openai' || provider === 'deepseek') && (
            <div className="space-y-2">
              <Label>Base URL（可选）</Label>
              <Input
                placeholder={
                  provider === 'openai' ? 'https://api.openai.com/v1' :
                  provider === 'deepseek' ? 'https://api.deepseek.com/v1' :
                  'https://your-api.com/v1'
                }
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="bg-muted/50"
              />
            </div>
          )}

          {/* API Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>API Key</Label>
              {config?.apiKeyMasked && (
                <span className="text-xs text-muted-foreground">
                  当前: {config.apiKeyMasked}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                type={showApiKey ? 'text' : 'password'}
                placeholder="输入新的 API Key（留空保持不变）"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="flex-1 bg-muted/50"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowApiKey(!showApiKey)}
                className="shrink-0"
              >
                {showApiKey ? '🙈' : '👁️'}
              </Button>
            </div>
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={`p-3 rounded-lg text-sm ${
              testResult.success 
                ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              {testResult.success ? '✅' : '❌'} {testResult.message}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-sm">
              ❌ {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing || loading}
          >
            {testing ? '⏳ 测试中...' : '🔌 测试连接'}
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading}
            className="gradient-bg hover:opacity-90"
          >
            {loading ? '⏳ 保存中...' : '💾 保存配置'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
