import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  acceptStoryExtract,
  createStoryEntity,
  createStoryThread,
  deleteStoryEntity,
  deleteStoryThread,
  extractStoryVault,
  fetchStoryVault,
  updateStoryEntity,
  updateStoryThread,
  type StoryEntity,
  type StoryEntityType,
  type StoryExtractProposal,
  type StoryThread,
  type StoryVaultSnapshot,
} from '@/lib/api';
import {
  Archive,
  BookMarked,
  Library,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
  Swords,
  Trash2,
  UserRound,
  Workflow,
} from 'lucide-react';

const ENTITY_TYPES: { id: StoryEntityType | 'all' | 'thread'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'character', label: '人物' },
  { id: 'location', label: '地点' },
  { id: 'faction', label: '势力' },
  { id: 'item', label: '物品' },
  { id: 'rule', label: '规则' },
  { id: 'world', label: '世界' },
  { id: 'premise', label: '卖点' },
  { id: 'style', label: '文风' },
  { id: 'thread', label: '线索' },
];

const TYPE_LABEL: Record<string, string> = {
  premise: '卖点',
  style: '文风',
  world: '世界',
  character: '人物',
  location: '地点',
  item: '物品',
  faction: '势力',
  rule: '规则',
  thread: '线索实体',
  market: '题材',
  note: '笔记',
};

interface StoryVaultViewProps {
  projectId: string;
  projectName?: string;
}

export function StoryVaultView({ projectId }: StoryVaultViewProps) {
  const [vault, setVault] = useState<StoryVaultSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StoryEntityType | 'all' | 'thread'>('all');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // create form
  const [newType, setNewType] = useState<StoryEntityType>('character');
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');

  // extract
  const [extractText, setExtractText] = useState('');
  const [proposal, setProposal] = useState<StoryExtractProposal | null>(null);
  const [extracting, setExtracting] = useState(false);

  const load = useCallback(async (opts?: { preserveSelection?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStoryVault(projectId);
      setVault(data);
      if (!opts?.preserveSelection) {
        if (data.entities[0]) setSelectedEntityId(data.entities[0].id);
        if (data.threads[0]) setSelectedThreadId(data.threads[0].id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedEntity = useMemo(
    () => vault?.entities.find((e) => e.id === selectedEntityId) || null,
    [vault, selectedEntityId],
  );
  const selectedThread = useMemo(
    () => vault?.threads.find((t) => t.id === selectedThreadId) || null,
    [vault, selectedThreadId],
  );

  const filteredEntities = useMemo(() => {
    if (!vault) return [];
    if (filter === 'all') return vault.entities;
    if (filter === 'thread') return [];
    return vault.entities.filter((e) => e.type === filter);
  }, [vault, filter]);

  const handleCreateEntity = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const entity = await createStoryEntity(projectId, {
        type: newType,
        name: newName.trim(),
        content: newContent,
      });
      setNewName('');
      setNewContent('');
      await load({ preserveSelection: true });
      setSelectedEntityId(entity.id);
      setFilter(entity.type);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateThread = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const thread = await createStoryThread(projectId, {
        name: newName.trim(),
        kind: 'foreshadow',
        summary: newContent,
        status: 'open',
      });
      setNewName('');
      setNewContent('');
      await load({ preserveSelection: true });
      setSelectedThreadId(thread.id);
      setFilter('thread');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEntity = async (entity: StoryEntity) => {
    setSaving(true);
    try {
      await updateStoryEntity(projectId, entity.id, {
        name: entity.name,
        content: entity.content,
        type: entity.type,
        importance: entity.importance,
      });
      await load({ preserveSelection: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveThread = async (thread: StoryThread) => {
    setSaving(true);
    try {
      await updateStoryThread(projectId, thread.id, {
        name: thread.name,
        summary: thread.summary,
        status: thread.status,
        kind: thread.kind,
        stakes: thread.stakes,
      });
      await load({ preserveSelection: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntity = async (id: string) => {
    if (!confirm('删除该资料条目？')) return;
    await deleteStoryEntity(projectId, id);
    setSelectedEntityId(null);
    await load();
  };

  const handleDeleteThread = async (id: string) => {
    if (!confirm('删除该线索？')) return;
    await deleteStoryThread(projectId, id);
    setSelectedThreadId(null);
    await load();
  };

  const handleExtract = async () => {
    if (!extractText.trim()) return;
    setExtracting(true);
    setError(null);
    try {
      const p = await extractStoryVault(projectId, {
        text: extractText,
        sourceType: 'manual',
      });
      setProposal(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  const handleAcceptProposal = async () => {
    if (!proposal) return;
    setSaving(true);
    try {
      await acceptStoryExtract(projectId, proposal.id);
      setProposal(null);
      setExtractText('');
      await load({ preserveSelection: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !vault) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载故事资料库...
      </div>
    );
  }

  if (!vault) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        {error || '无法加载 Story Vault'}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4 lg:p-6">
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <Library className="h-4 w-4 text-primary" />
            Story Vault
          </div>
          <h2 className="text-2xl font-semibold tracking-normal">故事资料库</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            人物、地点、势力、规则与伏笔集中管理。生成前可引用，生成后可抽取更新。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <HealthCard label="资料条目" value={String(vault.health.entityCount)} icon={<BookMarked className="h-3.5 w-3.5" />} />
          <HealthCard label="开放线索" value={String(vault.health.openThreadCount)} icon={<Workflow className="h-3.5 w-3.5" />} />
          <HealthCard label="未闭环" value={String(vault.health.openLoopCount)} icon={<Swords className="h-3.5 w-3.5" />} />
          <HealthCard
            label="进度"
            value={`${vault.health.generatedChapters}/${vault.health.totalChapters || '?'}`}
            icon={<Archive className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      {vault.migrated && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          已从旧 Bible / 角色图谱 / 伏笔自动迁移到 Story Vault，原始 Bible 仍保留。
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)_340px]">
        {/* Left filters + list */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-lg border bg-background">
          <div className="flex flex-wrap gap-1 border-b p-2">
            {ENTITY_TYPES.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={filter === t.id ? 'default' : 'ghost'}
                className="h-7 px-2 text-xs"
                onClick={() => setFilter(t.id)}
              >
                {t.label}
                {t.id !== 'all' && t.id !== 'thread' && vault.counts[t.id] ? (
                  <span className="ml-1 opacity-70">{vault.counts[t.id]}</span>
                ) : null}
                {t.id === 'thread' ? (
                  <span className="ml-1 opacity-70">{vault.threads.length}</span>
                ) : null}
              </Button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
            {filter === 'thread'
              ? vault.threads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => {
                      setSelectedThreadId(thread.id);
                      setSelectedEntityId(null);
                    }}
                    className={`w-full rounded-md border px-2 py-2 text-left text-xs transition ${
                      selectedThreadId === thread.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{thread.name}</span>
                      <Badge variant="secondary" className="text-[10px]">{thread.status}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-muted-foreground">{thread.summary || thread.kind}</p>
                  </button>
                ))
              : filteredEntities.map((entity) => (
                  <button
                    key={entity.id}
                    onClick={() => {
                      setSelectedEntityId(entity.id);
                      setSelectedThreadId(null);
                    }}
                    className={`w-full rounded-md border px-2 py-2 text-left text-xs transition ${
                      selectedEntityId === entity.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{entity.name}</span>
                      <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[entity.type] || entity.type}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-muted-foreground">{entity.content || '暂无内容'}</p>
                  </button>
                ))}
            {filter === 'thread' && vault.threads.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">暂无线索，可手动新增或从正文提取。</p>
            )}
            {filter !== 'thread' && filteredEntities.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">暂无条目。</p>
            )}
          </div>
        </aside>

        {/* Center editor */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
          {selectedEntity ? (
            <EntityEditor
              entity={selectedEntity}
              saving={saving}
              onChange={(next) =>
                setVault((prev) =>
                  prev
                    ? { ...prev, entities: prev.entities.map((e) => (e.id === next.id ? next : e)) }
                    : prev,
                )
              }
              onSave={() => handleSaveEntity(selectedEntity)}
              onDelete={() => handleDeleteEntity(selectedEntity.id)}
            />
          ) : selectedThread ? (
            <ThreadEditor
              thread={selectedThread}
              saving={saving}
              onChange={(next) =>
                setVault((prev) =>
                  prev
                    ? { ...prev, threads: prev.threads.map((t) => (t.id === next.id ? next : t)) }
                    : prev,
                )
              }
              onSave={() => handleSaveThread(selectedThread)}
              onDelete={() => handleDeleteThread(selectedThread.id)}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
              <UserRound className="h-8 w-8 opacity-50" />
              <p className="text-sm">选择左侧条目进行编辑，或在右侧新增 / 提取。</p>
            </div>
          )}
        </section>

        {/* Right: create + extract */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-auto">
          <div className="rounded-lg border bg-background p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Plus className="h-4 w-4 text-primary" />
              新增资料
            </div>
            <div className="space-y-2">
              <div>
                <Label className="text-xs">类型</Label>
                <Select value={newType} onValueChange={(v) => setNewType(v as StoryEntityType)}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTITY_TYPES.filter((t) => t.id !== 'all' && t.id !== 'thread').map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">名称</Label>
                <Input className="h-8" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="如：林远 / 青云城" />
              </div>
              <div>
                <Label className="text-xs">内容</Label>
                <Textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={4} placeholder="设定摘要、状态、禁忌..." />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" disabled={saving || !newName.trim()} onClick={() => void handleCreateEntity()}>
                  新增实体
                </Button>
                <Button size="sm" variant="outline" className="flex-1" disabled={saving || !newName.trim()} onClick={() => void handleCreateThread()}>
                  新增线索
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-background p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              从文本提取
            </div>
            <Textarea
              value={extractText}
              onChange={(e) => setExtractText(e.target.value)}
              rows={7}
              placeholder="粘贴章节片段或聊天结果，提取人物/地点/伏笔..."
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={extracting || !extractText.trim()} onClick={() => void handleExtract()}>
                {extracting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                提取 Proposal
              </Button>
              {proposal && (
                <Button size="sm" variant="secondary" disabled={saving} onClick={() => void handleAcceptProposal()}>
                  接受并写入
                </Button>
              )}
            </div>
            {proposal && (
              <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-2 text-xs">
                <p className="font-medium">{proposal.summary}</p>
                {proposal.entities.map((e, i) => (
                  <div key={`e-${i}`} className="rounded border bg-background px-2 py-1">
                    <Badge variant="outline" className="mr-1 text-[10px]">{TYPE_LABEL[e.type] || e.type}</Badge>
                    {e.name}
                    <p className="mt-0.5 text-muted-foreground line-clamp-2">{e.content}</p>
                  </div>
                ))}
                {proposal.threads.map((t, i) => (
                  <div key={`t-${i}`} className="rounded border bg-background px-2 py-1">
                    <Badge variant="secondary" className="mr-1 text-[10px]">线索</Badge>
                    {t.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
              <MapPin className="h-3.5 w-3.5 text-primary" />
              使用提示
            </div>
            <ul className="list-disc space-y-1 pl-4">
              <li>旧项目首次打开会自动迁移 Bible 与角色图谱。</li>
              <li>生成章节时 Agent 可通过 read_story_vault 按需读取。</li>
              <li>提取结果以 proposal 形式确认，不会静默改设定。</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function HealthCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

function EntityEditor({
  entity,
  saving,
  onChange,
  onSave,
  onDelete,
}: {
  entity: StoryEntity;
  saving: boolean;
  onChange: (e: StoryEntity) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <div className="text-xs text-muted-foreground">{TYPE_LABEL[entity.type] || entity.type}</div>
          <Input
            className="mt-1 h-8 border-none px-0 text-base font-semibold shadow-none focus-visible:ring-0"
            value={entity.name}
            onChange={(e) => onChange({ ...entity, name: e.target.value })}
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={saving} onClick={onSave}>保存</Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        <div>
          <Label className="text-xs">重要性 (1-5)</Label>
          <Input
            type="number"
            min={1}
            max={5}
            className="h-8 w-24"
            value={entity.importance}
            onChange={(e) => onChange({ ...entity, importance: Number(e.target.value) || 3 })}
          />
        </div>
        <div>
          <Label className="text-xs">内容</Label>
          <Textarea
            className="min-h-[320px]"
            value={entity.content}
            onChange={(e) => onChange({ ...entity, content: e.target.value })}
          />
        </div>
        {entity.triggerTerms?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entity.triggerTerms.map((term) => (
              <Badge key={term} variant="secondary">{term}</Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadEditor({
  thread,
  saving,
  onChange,
  onSave,
  onDelete,
}: {
  thread: StoryThread;
  saving: boolean;
  onChange: (t: StoryThread) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <div className="text-xs text-muted-foreground">线索 / {thread.kind}</div>
          <Input
            className="mt-1 h-8 border-none px-0 text-base font-semibold shadow-none focus-visible:ring-0"
            value={thread.name}
            onChange={(e) => onChange({ ...thread, name: e.target.value })}
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={saving} onClick={onSave}>保存</Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">状态</Label>
            <Select value={thread.status} onValueChange={(v) => onChange({ ...thread, status: v as StoryThread['status'] })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['open', 'active', 'paused', 'resolved', 'abandoned'].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">类型</Label>
            <Select value={thread.kind} onValueChange={(v) => onChange({ ...thread, kind: v as StoryThread['kind'] })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['main', 'sub', 'foreshadow', 'romance', 'mystery', 'other'].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-xs">摘要</Label>
          <Textarea
            className="min-h-[200px]"
            value={thread.summary}
            onChange={(e) => onChange({ ...thread, summary: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs">赌注 / 备注</Label>
          <Textarea
            value={thread.stakes}
            onChange={(e) => onChange({ ...thread, stakes: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
