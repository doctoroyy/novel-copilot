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
import {
  Search,
  Loader2,
  Plus,
  Download,
  CheckSquare,
  Square,
  Save,
} from 'lucide-react';
import {
  fetchRemoteModels,
  createModel,
  type AdminProvider,
  type AdminModel,
  type ProviderPreset,
} from '@/lib/api';

interface ManageModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: AdminProvider;
  existingModels: AdminModel[];
  allModels?: AdminModel[];
  preset: ProviderPreset | null;
  presets?: ProviderPreset[];
  onRefresh: () => void;
  setError: (msg: string | null) => void;
}

export function ManageModelsDialog({
  open,
  onOpenChange,
  provider,
  existingModels,
  preset,
  onRefresh,
  setError,
}: ManageModelsDialogProps) {
  const [mode, setMode] = useState<'fetch' | 'manual'>('fetch');

  // Fetch models state
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(provider.base_url || preset?.defaultBaseUrl || '');
  const [remoteModels, setRemoteModels] = useState<{ id: string; name: string; displayName: string }[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [batchRegistering, setBatchRegistering] = useState(false);

  // Manual add state
  const [manualModelName, setManualModelName] = useState('');
  const [manualDisplayName, setManualDisplayName] = useState('');
  const [manualMultiplier, setManualMultiplier] = useState('1.0');
  const [manualSaving, setManualSaving] = useState(false);

  const handleFetch = async () => {
    if (!apiKey) {
      setFetchError('请输入 API Key');
      return;
    }
    setFetching(true);
    setFetchError(null);
    try {
      const effectiveBaseUrl = baseUrl || preset?.defaultBaseUrl;
      const result = await fetchRemoteModels(provider.id, apiKey, effectiveBaseUrl);
      setRemoteModels(result);
      setSelectedModels(new Set());
    } catch (e) {
      setFetchError((e as Error).message);
      setRemoteModels([]);
    } finally {
      setFetching(false);
    }
  };

  const handleBatchRegister = async () => {
    if (selectedModels.size === 0) return;
    setBatchRegistering(true);
    try {
      const toRegister = remoteModels.filter((m) => selectedModels.has(m.id));
      for (const m of toRegister) {
        await createModel({
          providerId: provider.id,
          modelName: m.name,
          displayName: m.displayName || m.name,
          creditMultiplier: 1.0,
        });
      }
      setSelectedModels(new Set());
      onRefresh();
      // Update remote models list to reflect registered status
      setRemoteModels((prev) => [...prev]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBatchRegistering(false);
    }
  };

  const handleManualAdd = async () => {
    const name = manualModelName.trim();
    if (!name) {
      setError('模型名称不能为空');
      return;
    }
    setManualSaving(true);
    try {
      await createModel({
        providerId: provider.id,
        modelName: name,
        displayName: (manualDisplayName.trim() || name),
        creditMultiplier: parseFloat(manualMultiplier) || 1.0,
      });
      setManualModelName('');
      setManualDisplayName('');
      setManualMultiplier('1.0');
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setManualSaving(false);
    }
  };

  const isModelRegistered = (modelName: string) =>
    existingModels.some((m) => m.model_name === modelName);

  const filteredRemote = remoteModels.filter((m) => {
    if (!searchQuery.trim()) return true;
    return m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.displayName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleToggleAll = () => {
    const filteredIds = filteredRemote
      .filter((m) => !isModelRegistered(m.name))
      .map((m) => m.id);
    const allSelected = filteredIds.every((id) => selectedModels.has(id));
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        filteredIds.forEach((id) => next.delete(id));
      } else {
        filteredIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const resetState = () => {
    setApiKey('');
    setRemoteModels([]);
    setSelectedModels(new Set());
    setFetchError(null);
    setSearchQuery('');
    setManualModelName('');
    setManualDisplayName('');
    setManualMultiplier('1.0');
    setMode('fetch');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetState(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>管理模型 — {provider.name}</DialogTitle>
          <DialogDescription>从 API 获取可用模型或手动添加</DialogDescription>
        </DialogHeader>

        {/* Mode tabs */}
        <div className="flex gap-1 p-1 rounded-lg bg-muted">
          <button
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${mode === 'fetch' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}
            onClick={() => setMode('fetch')}
          >
            <Download className="h-3 w-3 inline mr-1" />
            从 API 获取
          </button>
          <button
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${mode === 'manual' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground'}`}
            onClick={() => setMode('manual')}
          >
            <Plus className="h-3 w-3 inline mr-1" />
            手动添加
          </button>
        </div>

        {mode === 'fetch' ? (
          <div className="space-y-3">
            {/* API Key + Base URL */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">API Key</label>
                <Input
                  type="password"
                  className="h-8 text-xs"
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Base URL</label>
                <Input
                  className="h-8 text-xs"
                  placeholder={preset?.defaultBaseUrl || 'https://...'}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
            </div>

            <Button
              className="w-full h-8 text-xs"
              disabled={fetching || !apiKey}
              onClick={handleFetch}
            >
              {fetching ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> 获取中...</>
              ) : (
                <><Search className="h-3.5 w-3.5 mr-1" /> 获取模型列表</>
              )}
            </Button>

            {fetchError && (
              <div className="p-2 rounded border border-destructive/30 bg-destructive/5 text-xs text-destructive">
                {fetchError}
              </div>
            )}

            {remoteModels.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    找到 {remoteModels.length} 个模型，已选 {selectedModels.size} 个
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={handleToggleAll}>
                    <CheckSquare className="h-3 w-3 mr-1" /> 全选/取消
                  </Button>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="搜索模型..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-7 text-xs"
                  />
                </div>

                <ScrollArea className="h-[220px]">
                  <div className="space-y-0.5 pr-2">
                    {filteredRemote.map((m) => {
                      const isSelected = selectedModels.has(m.id);
                      const isRegistered = isModelRegistered(m.name);
                      return (
                        <div
                          key={m.id}
                          className={`flex items-center gap-2.5 p-2 rounded cursor-pointer transition-colors ${
                            isRegistered
                              ? 'opacity-50 bg-muted/30'
                              : isSelected
                                ? 'bg-primary/10 border border-primary/30'
                                : 'hover:bg-muted/50 border border-transparent'
                          }`}
                          onClick={() => {
                            if (isRegistered) return;
                            setSelectedModels((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.id)) next.delete(m.id);
                              else next.add(m.id);
                              return next;
                            });
                          }}
                        >
                          {isRegistered ? (
                            <CheckSquare className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                          ) : isSelected ? (
                            <CheckSquare className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                          ) : (
                            <Square className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium truncate">{m.displayName}</p>
                            {m.name !== m.displayName && (
                              <p className="text-[10px] text-muted-foreground truncate">{m.name}</p>
                            )}
                          </div>
                          {isRegistered && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-green-500/20 text-green-600 flex-shrink-0">已注册</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>

                <Button
                  className="w-full h-8 text-xs"
                  disabled={selectedModels.size === 0 || batchRegistering}
                  onClick={handleBatchRegister}
                >
                  {batchRegistering ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> 注册中...</>
                  ) : (
                    <><Plus className="h-3.5 w-3.5 mr-1" /> 注册选中的 {selectedModels.size} 个模型</>
                  )}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">模型名称</label>
              <Input
                className="h-8 text-xs"
                placeholder="如: gpt-4o"
                value={manualModelName}
                onChange={(e) => setManualModelName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">显示名称 (可选)</label>
              <Input
                className="h-8 text-xs"
                placeholder="留空则使用模型名称"
                value={manualDisplayName}
                onChange={(e) => setManualDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">能量倍率</label>
              <Input
                type="number"
                step="0.1"
                className="h-8 text-xs"
                value={manualMultiplier}
                onChange={(e) => setManualMultiplier(e.target.value)}
              />
            </div>
            <Button
              className="w-full h-8 text-xs"
              disabled={manualSaving || !manualModelName.trim()}
              onClick={handleManualAdd}
            >
              {manualSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1" />
              )}
              添加模型
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
