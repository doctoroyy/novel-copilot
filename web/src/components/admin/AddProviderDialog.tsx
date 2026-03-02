import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Loader2 } from 'lucide-react';
import { createAdminProvider, type ProviderPreset } from '@/lib/api';

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: ProviderPreset[];
  existingProviderIds: string[];
  onCreated: (id: string) => void;
  setError: (msg: string | null) => void;
}

export function AddProviderDialog({
  open,
  onOpenChange,
  presets,
  existingProviderIds,
  onCreated,
  setError,
}: AddProviderDialogProps) {
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  // Custom form state
  const [customName, setCustomName] = useState('');
  const [customProtocol, setCustomProtocol] = useState<string>('openai');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');

  const availablePresets = presets.filter((p) => {
    if (p.isCustom) return false;
    if (existingProviderIds.includes(p.id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
  });

  const handleSelectPreset = async (preset: ProviderPreset) => {
    setCreating(true);
    try {
      await createAdminProvider({
        id: preset.id,
        name: preset.label,
        protocol: preset.protocol,
        baseUrl: preset.defaultBaseUrl,
      });
      onCreated(preset.id);
      onOpenChange(false);
      resetForm();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateCustom = async () => {
    if (!customName.trim()) {
      setError('请输入 Provider 名称');
      return;
    }
    setCreating(true);
    try {
      const id = `custom-${Date.now()}`;
      await createAdminProvider({
        id,
        name: customName.trim(),
        protocol: customProtocol,
        baseUrl: customBaseUrl || undefined,
        apiKey: customApiKey || undefined,
      });
      onCreated(id);
      onOpenChange(false);
      resetForm();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setSearch('');
    setCustomName('');
    setCustomProtocol('openai');
    setCustomBaseUrl('');
    setCustomApiKey('');
    setMode('preset');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>添加 Provider</DialogTitle>
          <DialogDescription>从预设列表选择或创建自定义 Provider</DialogDescription>
        </DialogHeader>

        {/* Mode tabs */}
        <div className="flex gap-1 p-1 rounded-lg bg-muted">
          <button
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${mode === 'preset' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}
            onClick={() => setMode('preset')}
          >
            从预设选择
          </button>
          <button
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${mode === 'custom' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}
            onClick={() => setMode('custom')}
          >
            自定义
          </button>
        </div>

        {mode === 'preset' ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="搜索 Provider..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <ScrollArea className="h-[280px]">
              <div className="space-y-1 pr-2">
                {availablePresets.map((preset) => (
                  <button
                    key={preset.id}
                    className="w-full flex items-center gap-3 p-2.5 rounded-md hover:bg-muted/60 transition-colors text-left"
                    disabled={creating}
                    onClick={() => handleSelectPreset(preset)}
                  >
                    <div
                      className="w-8 h-8 rounded-md flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: preset.color || '#6b7280' }}
                    >
                      {preset.label.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{preset.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {preset.defaultBaseUrl || 'No default URL'}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] h-4 flex-shrink-0">
                      {preset.protocol}
                    </Badge>
                  </button>
                ))}
                {availablePresets.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    {search ? '无匹配结果' : '所有预设 Provider 已添加'}
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">名称</label>
              <Input
                className="h-8 text-xs"
                placeholder="如: 我的自定义大模型"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">协议</label>
              <Select value={customProtocol} onValueChange={setCustomProtocol}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI Compatible</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="gemini">Gemini</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Base URL</label>
              <Input
                className="h-8 text-xs"
                placeholder="https://api.example.com/v1"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">API Key (可选)</label>
              <Input
                type="password"
                className="h-8 text-xs"
                placeholder="sk-..."
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
              />
            </div>
            <Button
              className="w-full h-8 text-xs"
              disabled={creating || !customName.trim()}
              onClick={handleCreateCustom}
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Plus className="h-3.5 w-3.5 mr-1" />
              )}
              创建 Provider
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
