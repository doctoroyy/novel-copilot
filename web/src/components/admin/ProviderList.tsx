import { useState } from 'react';
import { Search, Plus, ToggleLeft, ToggleRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toggleAdminProvider, type AdminProvider, type ProviderPreset } from '@/lib/api';

interface ProviderListProps {
  providers: AdminProvider[];
  presets: ProviderPreset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onToggle: () => void;
  setError: (msg: string | null) => void;
}

export function ProviderList({
  providers,
  presets,
  selectedId,
  onSelect,
  onAdd,
  onToggle,
  setError,
}: ProviderListProps) {
  const [search, setSearch] = useState('');

  const getPreset = (id: string) => presets.find((p) => p.id === id);

  const filtered = providers.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
  });

  const handleToggle = async (e: React.MouseEvent, provider: AdminProvider) => {
    e.stopPropagation();
    try {
      await toggleAdminProvider(provider.id);
      onToggle();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索 Provider..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Provider list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {filtered.map((provider) => {
            const preset = getPreset(provider.id);
            const color = preset?.color || '#6b7280';
            const isSelected = provider.id === selectedId;

            return (
              <div
                key={provider.id}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-muted/60 border border-transparent'
                }`}
                onClick={() => onSelect(provider.id)}
              >
                {/* Avatar */}
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: color }}
                >
                  {provider.name.charAt(0).toUpperCase()}
                </div>

                {/* Name + model count */}
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate ${!provider.enabled ? 'text-muted-foreground line-through' : ''}`}>
                    {provider.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {provider.model_count} 个模型
                  </p>
                </div>

                {/* Toggle */}
                <button
                  className="flex-shrink-0 p-0.5"
                  onClick={(e) => handleToggle(e, provider)}
                  title={provider.enabled ? '点击禁用' : '点击启用'}
                >
                  {provider.enabled ? (
                    <ToggleRight className="h-4 w-4 text-green-500" />
                  ) : (
                    <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              {search ? '无匹配结果' : '暂无 Provider'}
            </p>
          )}
        </div>
      </ScrollArea>

      {/* Add button */}
      <div className="p-3 border-t">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs h-8"
          onClick={onAdd}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          添加 Provider
        </Button>
      </div>
    </>
  );
}
