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
import { useAIConfig, PROVIDER_MODELS, type AIProvider } from '@/hooks/useAIConfig';
import { testAIConnection } from '@/lib/api';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { config, saveConfig, getProviderSettings, maskedApiKey, loaded } = useAIConfig();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  
  // Form state
  const [provider, setProvider] = useState<AIProvider>('gemini');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Load from config when dialog opens (only once when opened)
  useEffect(() => {
    if (open && loaded) {
      setProvider(config.provider);
      setModel(config.model);
      setBaseUrl(config.baseUrl || '');
      setApiKey(''); // Don't show actual key, user enters new one or leaves empty to keep existing
      setTestResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded]); // Removed config dependency - we only want to load on dialog open

  const handleSave = () => {
    // If user didn't enter a new API key, keep the existing one
    const keyToSave = apiKey.trim() || config.apiKey;
    
    if (!keyToSave) {
      setTestResult({ success: false, message: '请输入 API Key' });
      return;
    }
    
    const newConfig = {
      provider,
      model,
      apiKey: keyToSave,
      baseUrl: baseUrl || undefined,
    };
    saveConfig(newConfig);
    setTestResult({ success: true, message: '配置已保存到本地' });
    setApiKey(''); // Clear input field (key is saved in config)
    // Auto-close the dialog after successful save
    setTimeout(() => onOpenChange(false), 500);
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      
      const testApiKey = apiKey.trim() || config.apiKey;
      
      if (!testApiKey) {
        setTestResult({ success: false, message: '请先输入 API Key' });
        return;
      }
      
      const result = await testAIConnection({
        provider,
        model,
        apiKey: testApiKey,
        baseUrl: baseUrl || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  // Get available models for current provider
  const availableModels = PROVIDER_MODELS[provider] || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg glass-card w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span>⚙️</span>
            <span>AI 设置</span>
          </DialogTitle>
          <DialogDescription className="text-sm">
            配置 AI Provider 和 API Key（保存在本地浏览器）
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Provider Selection */}
          <div className="space-y-2">
            <Label className="text-sm">Provider</Label>
            <Select 
              value={provider} 
              onValueChange={(val) => {
                const newProvider = val as AIProvider;
                setProvider(newProvider);
                // Restore saved settings for this provider
                const savedSettings = getProviderSettings(newProvider);
                setModel(savedSettings.model || PROVIDER_MODELS[newProvider]?.[0] || '');
                setBaseUrl(savedSettings.baseUrl || '');
              }}
            >
              <SelectTrigger className="bg-muted/50 text-sm">
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
              <Label className="text-sm">Model</Label>
              <span className="text-xs text-muted-foreground">可选择或自定义输入</span>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="输入或选择模型名称"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="flex-1 bg-muted/50 text-sm"
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
              <Label className="text-sm">Base URL（可选）</Label>
              <Input
                placeholder={
                  provider === 'openai' ? 'https://api.openai.com/v1' :
                  provider === 'deepseek' ? 'https://api.deepseek.com/v1' :
                  'https://your-api.com/v1'
                }
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="bg-muted/50 text-sm"
              />
            </div>
          )}

          {/* API Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">API Key</Label>
              {maskedApiKey && (
                <span className="text-xs text-muted-foreground">
                  当前: {maskedApiKey}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                type={showApiKey ? 'text' : 'password'}
                placeholder={maskedApiKey ? `当前: ${maskedApiKey}` : '请输入 API Key'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="flex-1 bg-muted/50 text-sm"
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
            <div className={`p-3 rounded-lg text-xs sm:text-sm ${
              testResult.success 
                ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              {testResult.success ? '✅' : '❌'} {testResult.message}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing}
            className="w-full sm:w-auto text-sm"
          >
            {testing ? '⏳ 测试中...' : '🔌 测试连接'}
          </Button>
          <Button
            onClick={handleSave}
            className="gradient-bg hover:opacity-90 w-full sm:w-auto text-sm"
          >
            💾 保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
