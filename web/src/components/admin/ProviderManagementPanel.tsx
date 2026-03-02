import { useState, useEffect, useCallback } from 'react';
import {
  fetchAdminProviders,
  fetchModelRegistry,
  fetchProviderPresets,
  type AdminProvider,
  type AdminModel,
  type ProviderPreset,
} from '@/lib/api';
import { ProviderList } from './ProviderList';
import { ProviderDetail } from './ProviderDetail';
import { AddProviderDialog } from './AddProviderDialog';
import { Loader2 } from 'lucide-react';

export function ProviderManagementPanel() {
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [providerList, modelList, presetList] = await Promise.all([
        fetchAdminProviders(),
        fetchModelRegistry(),
        fetchProviderPresets(),
      ]);
      setProviders(providerList);
      setModels(modelList);
      setPresets(presetList);
      // Auto-select first provider if none selected
      setSelectedProviderId((prev) => {
        if (prev && providerList.some((p) => p.id === prev)) return prev;
        return providerList[0]?.id || null;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) || null;
  const selectedProviderModels = models.filter((m) => m.provider_id === selectedProviderId);
  const getPreset = (id: string) => presets.find((p) => p.id === id) || null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      <div className="flex rounded-lg border bg-card min-h-[520px]">
        {/* Left panel: Provider list */}
        <div className="w-[260px] flex-shrink-0 border-r flex flex-col">
          <ProviderList
            providers={providers}
            presets={presets}
            selectedId={selectedProviderId}
            onSelect={setSelectedProviderId}
            onAdd={() => setShowAddDialog(true)}
            onToggle={loadData}
            setError={setError}
          />
        </div>

        {/* Right panel: Provider detail */}
        <div className="flex-1 min-w-0">
          {selectedProvider ? (
            <ProviderDetail
              provider={selectedProvider}
              models={selectedProviderModels}
              allModels={models}
              preset={getPreset(selectedProvider.id)}
              presets={presets}
              onRefresh={loadData}
              setError={setError}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {providers.length === 0 ? '暂无 Provider，请点击左下角添加' : '请选择一个 Provider'}
            </div>
          )}
        </div>
      </div>

      <AddProviderDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        presets={presets}
        existingProviderIds={providers.map((p) => p.id)}
        onCreated={(newId) => {
          setSelectedProviderId(newId);
          loadData();
        }}
        setError={setError}
      />
    </div>
  );
}
