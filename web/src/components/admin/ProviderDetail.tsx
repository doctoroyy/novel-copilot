import { useState } from 'react';
import {
  Save,
  Trash2,
  Star,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Settings2,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  updateAdminProvider,
  deleteAdminProvider,
  updateModel,
  deleteModel,
  type AdminProvider,
  type AdminModel,
  type ProviderPreset,
} from '@/lib/api';
import { ManageModelsDialog } from './ManageModelsDialog';

interface ProviderDetailProps {
  provider: AdminProvider;
  models: AdminModel[];
  allModels: AdminModel[];
  preset: ProviderPreset | null;
  presets: ProviderPreset[];
  onRefresh: () => void;
  setError: (msg: string | null) => void;
}

export function ProviderDetail({
  provider,
  models,
  allModels,
  preset,
  presets,
  onRefresh,
  setError,
}: ProviderDetailProps) {
  const [editName, setEditName] = useState(provider.name);
  const [editApiKey, setEditApiKey] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState(provider.base_url || preset?.defaultBaseUrl || '');
  const [saving, setSaving] = useState(false);
  const [showManageModels, setShowManageModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Reset form when provider changes
  const [prevProviderId, setPrevProviderId] = useState(provider.id);
  if (provider.id !== prevProviderId) {
    setPrevProviderId(provider.id);
    setEditName(provider.name);
    setEditApiKey('');
    setEditBaseUrl(provider.base_url || preset?.defaultBaseUrl || '');
    setSaving(false);
    setTestResult(null);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, string> = {};
      if (editName !== provider.name) updates.name = editName;
      if (editApiKey) updates.apiKey = editApiKey;
      const currentBase = provider.base_url || preset?.defaultBaseUrl || '';
      if (editBaseUrl !== currentBase) updates.baseUrl = editBaseUrl;

      if (Object.keys(updates).length > 0) {
        await updateAdminProvider(provider.id, updates);
        onRefresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`确定删除 Provider "${provider.name}" 及其所有模型？此操作不可恢复。`)) return;
    try {
      await deleteAdminProvider(provider.id);
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: provider.id,
          provider: provider.protocol || 'openai',
          model: models[0]?.model_name || 'gpt-4o-mini',
          apiKey: editApiKey || undefined,
          baseUrl: editBaseUrl || preset?.defaultBaseUrl || '',
        }),
      });
      const data = await res.json();
      setTestResult({ success: data.success, message: data.message });
    } catch (e) {
      setTestResult({ success: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const handleToggleModel = async (model: AdminModel) => {
    try {
      await updateModel(model.id, { isActive: !model.is_active });
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSetDefault = async (model: AdminModel) => {
    try {
      await updateModel(model.id, { isDefault: true });
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDeleteModel = async (model: AdminModel) => {
    if (!confirm(`确定删除模型 "${model.display_name}"？`)) return;
    try {
      await deleteModel(model.id);
      onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const color = preset?.color || '#6b7280';

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-5 space-y-5">
          {/* Provider header */}
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-lg font-bold flex-shrink-0"
              style={{ backgroundColor: color }}
            >
              {provider.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <Input
                className="text-base font-semibold h-8 border-transparent hover:border-input focus:border-input bg-transparent px-1"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <div className="flex items-center gap-2 mt-0.5 px-1">
                <Badge variant="secondary" className="text-[10px] h-4">
                  {provider.protocol}
                </Badge>
                {!provider.enabled && (
                  <Badge variant="destructive" className="text-[10px] h-4">
                    已禁用
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Config form */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">API Key</label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  className="h-8 text-xs flex-1"
                  placeholder={provider.api_key_encrypted ? `当前: ${provider.api_key_encrypted}` : '未设置，请输入...'}
                  value={editApiKey}
                  onChange={(e) => setEditApiKey(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={testing || (!editApiKey && !provider.api_key_encrypted)}
                  onClick={handleTestConnection}
                >
                  {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
                  <span className="ml-1">测试</span>
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Base URL</label>
              <Input
                className="h-8 text-xs"
                placeholder={preset?.defaultBaseUrl || 'https://api.example.com/v1'}
                value={editBaseUrl}
                onChange={(e) => setEditBaseUrl(e.target.value)}
              />
              {preset?.defaultBaseUrl && editBaseUrl !== preset.defaultBaseUrl && (
                <button
                  className="text-[10px] text-primary underline underline-offset-2"
                  onClick={() => setEditBaseUrl(preset.defaultBaseUrl || '')}
                >
                  恢复默认地址
                </button>
              )}
            </div>

            {testResult && (
              <div className={`text-[11px] flex items-start gap-2 p-2 rounded border ${
                testResult.success
                  ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
                  : 'bg-destructive/10 border-destructive/20 text-destructive'
              }`}>
                <span className="leading-tight">{testResult.message}</span>
              </div>
            )}

            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
              保存配置
            </Button>
          </div>

          {/* Separator */}
          <div className="border-t" />

          {/* Models section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium flex items-center gap-2">
                模型 ({models.length})
              </h4>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowManageModels(true)}
                >
                  <Settings2 className="h-3 w-3 mr-1" />
                  管理
                </Button>
              </div>
            </div>

            {models.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <p>暂无模型</p>
                <Button
                  variant="link"
                  size="sm"
                  className="mt-1 text-xs"
                  onClick={() => setShowManageModels(true)}
                >
                  点击添加模型
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {models.map((model) => (
                  <div
                    key={model.id}
                    className="flex items-center justify-between p-2.5 rounded-md border bg-muted/30 hover:bg-muted/60 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {model.is_default ? (
                        <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 flex-shrink-0" />
                      ) : null}
                      <div className="min-w-0">
                        <p className={`text-xs font-medium truncate ${!model.is_active ? 'text-muted-foreground line-through' : ''}`}>
                          {model.display_name}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {model.model_name} · x{model.credit_multiplier}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {!model.is_default && (
                        <Button
                          variant="ghost" size="sm"
                          className="h-6 w-6 p-0"
                          title="设为默认"
                          onClick={() => handleSetDefault(model)}
                        >
                          <Star className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost" size="sm"
                        className="h-6 w-6 p-0"
                        title={model.is_active ? '禁用' : '启用'}
                        onClick={() => handleToggleModel(model)}
                      >
                        {model.is_active ? (
                          <ToggleRight className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        title="删除"
                        onClick={() => handleDeleteModel(model)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Delete provider */}
          <div className="border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
              onClick={handleDelete}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              删除 Provider
            </Button>
          </div>
        </div>
      </ScrollArea>

      <ManageModelsDialog
        open={showManageModels}
        onOpenChange={setShowManageModels}
        provider={provider}
        existingModels={models}
        allModels={allModels}
        preset={preset}
        presets={presets}
        onRefresh={onRefresh}
        setError={setError}
      />
    </div>
  );
}
