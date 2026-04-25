import { useMemo, useState } from 'react';
import { CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Edit,
  FileText,
  Layers3,
  Loader2,
  PenLine,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { ProjectDetail } from '@/lib/api';
import { useGeneration } from '@/contexts/GenerationContext';
import { ChapterEditor } from '@/components/ChapterEditor';

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback:', err);
    }
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, text.length);
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback copy failed:', err);
    return false;
  }
}

interface ChapterListViewProps {
  project: ProjectDetail;
  onViewChapter: (index: number) => Promise<string>;
  onDeleteChapter?: (index: number) => Promise<void>;
  onBatchDeleteChapters?: (indices: number[]) => Promise<void>;
  onDeleteVolume?: (volumeIndex: number) => Promise<void>;
  onProjectRefresh?: () => Promise<void> | void;
  onGenerateNextChapter?: () => Promise<void>;
  onRegenerateChapter?: (index: number) => Promise<void>;
  isProjectGenerating?: boolean;
}

type ChapterRow = {
  index: number;
  title?: string | null;
};

type BoardGroup = {
  id: string;
  title: string;
  subtitle: string;
  volumeIndex?: number;
  startChapter?: number;
  endChapter?: number;
  goal?: string;
  chapters: ChapterRow[];
};

export function ChapterListView({
  project,
  onViewChapter,
  onDeleteChapter,
  onBatchDeleteChapters,
  onDeleteVolume,
  onProjectRefresh,
  onGenerateNextChapter,
  onRegenerateChapter,
  isProjectGenerating = false,
}: ChapterListViewProps) {
  const { activeTasks } = useGeneration();
  const [viewingChapter, setViewingChapter] = useState<{ index: number; content: string; title?: string } | null>(null);
  const [editingChapter, setEditingChapter] = useState<{ index?: number; content: string } | null>(null);
  const [loadingChapter, setLoadingChapter] = useState<number | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyingChapter, setCopyingChapter] = useState<number | null>(null);
  const [copiedChapter, setCopiedChapter] = useState<number | null>(null);
  const [copyError, setCopyError] = useState<number | null>(null);
  const [deletingChapter, setDeletingChapter] = useState<number | null>(null);
  const [chapterToDelete, setChapterToDelete] = useState<number | null>(null);
  const [generatingChapter, setGeneratingChapter] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [volumeToDelete, setVolumeToDelete] = useState<{ index: number; title: string; fromChapter: number } | null>(null);
  const [deletingVolume, setDeletingVolume] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const chapterIndices = useMemo(
    () =>
      project.chapters
        .map(ch => Number.parseInt(ch.replace('.md', ''), 10))
        .filter(Number.isFinite)
        .sort((a, b) => a - b),
    [project.chapters]
  );

  const titleByChapter = useMemo(() => {
    const map = new Map<number, string>();
    project.outline?.volumes.forEach((volume) => {
      volume.chapters?.forEach((chapter) => map.set(chapter.index, chapter.title));
    });
    return map;
  }, [project.outline]);

  const nextChapterIndex = project.state.nextChapterIndex;
  const generatedChapters = Math.max(0, nextChapterIndex - 1);
  const remainingChapters = Math.max(0, project.state.totalChapters - generatedChapters);
  const progress = project.state.totalChapters > 0
    ? Math.min(100, Math.max(0, (generatedChapters / project.state.totalChapters) * 100))
    : 0;

  const currentProjectTasks = activeTasks.filter(
    (t) => t.projectName === project.name || t.projectName === project.id
  );
  const isGeneratingTaskActive = currentProjectTasks.some(
    t => t.status === 'generating' || t.status === 'preparing' || t.status === 'saving'
  );

  const getIsChapterGenerating = (index: number) => {
    return generatingChapter === index || currentProjectTasks.some(t => {
      if (t.type !== 'chapters') return false;
      if (t.title.includes(`第 ${index} 章`)) return true;
      return t.current === index || (t.startChapter && index >= t.startChapter && index < (t.startChapter + (t.total || 0)));
    });
  };

  const canGenerateNext = Boolean(project.outline) && remainingChapters > 0 && !isProjectGenerating && !isGeneratingTaskActive;
  const isGeneratingNextChapter = isProjectGenerating || isGeneratingTaskActive || generatingChapter === nextChapterIndex;

  const groups = useMemo<BoardGroup[]>(() => {
    if (!project.outline) {
      return [{
        id: 'all',
        title: '全部章节',
        subtitle: `${chapterIndices.length} 章`,
        chapters: chapterIndices.map((index) => ({ index, title: titleByChapter.get(index) })),
      }];
    }

    const volumeGroups: BoardGroup[] = project.outline.volumes.map((volume, volumeIndex) => ({
      id: `volume-${volumeIndex}`,
      title: volume.title,
      subtitle: `第 ${volume.startChapter}-${volume.endChapter} 章`,
      volumeIndex,
      startChapter: volume.startChapter,
      endChapter: volume.endChapter,
      goal: volume.goal,
      chapters: chapterIndices
        .filter(idx => idx >= volume.startChapter && idx <= volume.endChapter)
        .map((index) => ({ index, title: titleByChapter.get(index) })),
    }));

    const covered = new Set(volumeGroups.flatMap((volume) => volume.chapters.map((chapter) => chapter.index)));
    const uncategorized = chapterIndices.filter((index) => !covered.has(index));
    if (uncategorized.length > 0) {
      volumeGroups.push({
        id: 'uncategorized',
        title: '未归档章节',
        subtitle: `${uncategorized.length} 章`,
        chapters: uncategorized.map((index) => ({ index, title: titleByChapter.get(index) })),
      });
    }

    return volumeGroups;
  }, [chapterIndices, project.outline, titleByChapter]);

  const [activeGroupId, setActiveGroupId] = useState<string>('all');
  const activeGroup = groups.find((group) => group.id === activeGroupId) || groups[0];
  const visibleGroups = activeGroup ? [activeGroup] : groups;

  const toggleSelection = (index: number) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectAll = () => setSelectedChapters(new Set(chapterIndices));
  const clearSelection = () => setSelectedChapters(new Set());

  const getChapterTitle = (chapterIndex: number) => titleByChapter.get(chapterIndex) || null;

  const handleView = async (index: number) => {
    setActionError(null);
    setLoadingChapter(index);
    try {
      const content = await onViewChapter(index);
      setViewingChapter({
        index,
        content,
        title: getChapterTitle(index) || undefined,
      });
    } catch (err) {
      setActionError(`加载章节失败：${(err as Error).message}`);
    } finally {
      setLoadingChapter(null);
    }
  };

  const handleCopy = async () => {
    if (!viewingChapter?.content) return;
    const success = await copyToClipboard(viewingChapter.content);
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleQuickCopy = async (index: number) => {
    setCopyingChapter(index);
    setCopyError(null);
    setActionError(null);
    try {
      const content = await onViewChapter(index);
      const success = await copyToClipboard(content);
      if (success) {
        setCopiedChapter(index);
        setTimeout(() => setCopiedChapter(null), 2000);
      } else {
        setCopyError(index);
        setTimeout(() => setCopyError(null), 2000);
      }
    } catch (err) {
      setActionError(`复制失败：${(err as Error).message}`);
    } finally {
      setCopyingChapter(null);
    }
  };

  const confirmDelete = async () => {
    if (chapterToDelete === null || !onDeleteChapter) return;
    setActionError(null);
    setDeletingChapter(chapterToDelete);
    try {
      await onDeleteChapter(chapterToDelete);
    } catch (err) {
      setActionError(`删除失败：${(err as Error).message}`);
    } finally {
      setDeletingChapter(null);
      setChapterToDelete(null);
    }
  };

  const confirmBatchDelete = async () => {
    if (!onBatchDeleteChapters || selectedChapters.size === 0) return;
    setActionError(null);
    setBatchDeleting(true);
    try {
      await onBatchDeleteChapters(Array.from(selectedChapters));
      setSelectedChapters(new Set());
      setSelectionMode(false);
    } catch (err) {
      setActionError(`批量删除失败：${(err as Error).message}`);
    } finally {
      setBatchDeleting(false);
      setShowBatchDeleteConfirm(false);
    }
  };

  const confirmDeleteVolume = async () => {
    if (!volumeToDelete || !onDeleteVolume) return;
    setActionError(null);
    setDeletingVolume(true);
    try {
      await onDeleteVolume(volumeToDelete.index);
    } catch (err) {
      setActionError(`删除卷失败：${(err as Error).message}`);
    } finally {
      setDeletingVolume(false);
      setVolumeToDelete(null);
    }
  };

  const handleGenerateNext = async () => {
    if (!project.outline) {
      setActionError('请先生成大纲后再生成章节');
      return;
    }
    if (remainingChapters <= 0) {
      setActionError('已达到目标章节数，无需继续生成');
      return;
    }

    const nextIndex = nextChapterIndex;
    setActionError(null);
    setGeneratingChapter(nextIndex);
    try {
      await onGenerateNextChapter?.();
    } catch (err) {
      setActionError(`生成提交失败：${(err as Error).message}`);
    } finally {
      setGeneratingChapter(null);
    }
  };

  const handleRegenerate = async (index: number) => {
    if (!confirm(`确定要重新生成第 ${index} 章吗？现有内容将被覆盖。`)) return;
    setActionError(null);
    setGeneratingChapter(index);
    try {
      await onRegenerateChapter?.(index);
    } catch (err) {
      setActionError(`重写提交失败：${(err as Error).message}`);
    } finally {
      setGeneratingChapter(null);
    }
  };

  const renderChapterRow = (chapter: ChapterRow) => {
    const isSelected = selectedChapters.has(chapter.index);
    const isBusy = getIsChapterGenerating(chapter.index);
    const isLoading = loadingChapter === chapter.index;

    return (
      <div
        key={chapter.index}
        className={`grid gap-3 rounded-lg border p-3 transition-colors lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center ${
          isSelected ? 'border-primary/60 bg-primary/10' : 'border-border/70 bg-card hover:bg-muted/25'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            if (selectionMode) toggleSelection(chapter.index);
            else void handleView(chapter.index);
          }}
          className="min-w-0 text-left"
        >
          <div className="flex items-center gap-3">
            {selectionMode && (
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'}`}>
                {isSelected && <Check className="h-3.5 w-3.5" />}
              </span>
            )}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold tabular-nums">
              {chapter.index}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">第 {chapter.index} 章{chapter.title ? `：${chapter.title}` : ''}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isLoading ? '正在加载内容...' : selectionMode ? (isSelected ? '已选中' : '点击选择') : '点击查看正文'}
              </p>
            </div>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button variant="outline" size="sm" onClick={() => void handleQuickCopy(chapter.index)} disabled={copyingChapter === chapter.index}>
            {copyingChapter === chapter.index ? <Loader2 className="h-4 w-4 animate-spin" /> : copiedChapter === chapter.index ? <Check className="h-4 w-4" /> : copyError === chapter.index ? <X className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span className="hidden sm:inline">{copiedChapter === chapter.index ? '已复制' : copyError === chapter.index ? '失败' : '复制'}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleRegenerate(chapter.index)} disabled={isBusy}>
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="hidden sm:inline">重写</span>
          </Button>
          {onDeleteChapter && (
            <Button variant="ghost" size="sm" onClick={() => setChapterToDelete(chapter.index)} disabled={deletingChapter === chapter.index} className="text-muted-foreground hover:text-destructive">
              {deletingChapter === chapter.index ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void handleView(chapter.index)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 lg:space-y-5 lg:p-6">
      <section className="rounded-lg border border-border/80 bg-card">
        <div className="border-b border-border/70 p-4 lg:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">章节生产板</h2>
                <Badge variant="secondary">{chapterIndices.length} 章</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                已生成 {generatedChapters} / {project.state.totalChapters} 章，下一章为第 {nextChapterIndex} 章。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectionMode ? (
                <>
                  <Button variant="outline" size="sm" onClick={selectAll}>全选</Button>
                  <Button variant="outline" size="sm" onClick={clearSelection}>清除</Button>
                  <Button variant="destructive" size="sm" onClick={() => setShowBatchDeleteConfirm(true)} disabled={selectedChapters.size === 0}>
                    删除选中 ({selectedChapters.size})
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setSelectionMode(false); clearSelection(); }}>退出选择</Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditingChapter({ content: '' })}>
                    <Edit className="h-4 w-4" />
                    新建章节
                  </Button>
                  <Button size="sm" onClick={handleGenerateNext} disabled={!canGenerateNext}>
                    {isGeneratingNextChapter ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    生成下一章
                  </Button>
                  {onBatchDeleteChapters && chapterIndices.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setSelectionMode(true)}>
                      <Trash2 className="h-4 w-4" />
                      批量删除
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full progress-gradient transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>

          {actionError && (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {actionError}
            </div>
          )}
        </div>

        <div className="grid min-h-[calc(100vh-250px)] lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="border-b border-border/70 bg-muted/10 p-4 lg:border-b-0 lg:border-r lg:p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Layers3 className="h-4 w-4 text-primary" />
              卷导航
            </div>
            <div className="space-y-2">
              {groups.map((group) => {
                const total = group.startChapter && group.endChapter ? Math.max(1, group.endChapter - group.startChapter + 1) : group.chapters.length || 1;
                const done = group.chapters.length;
                const groupProgress = Math.round((done / total) * 100);
                const isActive = activeGroup?.id === group.id;

                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setActiveGroupId(group.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      isActive ? 'border-primary/50 bg-primary/10' : 'border-border/70 bg-background hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{group.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{group.subtitle}</p>
                      </div>
                      <span className="rounded-md bg-muted px-2 py-1 text-xs tabular-nums">{done}</span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full progress-gradient" style={{ width: `${groupProgress}%` }} />
                    </div>
                    {group.goal && <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{group.goal}</p>}
                  </button>
                );
              })}
            </div>
          </aside>

          <CardContent className="p-4 lg:p-5">
            {chapterIndices.length === 0 ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-border text-center text-muted-foreground">
                <BookOpen className="mb-3 h-10 w-10 opacity-50" />
                <p className="font-medium">暂无生成的章节</p>
                <p className="mt-1 text-sm">生成大纲后，可从这里开始生产第一章。</p>
                <Button className="mt-4" onClick={handleGenerateNext} disabled={!canGenerateNext}>
                  <Sparkles className="h-4 w-4" />
                  生成下一章
                </Button>
              </div>
            ) : (
              <div className="space-y-5">
                {visibleGroups.map((group) => (
                  <div key={group.id} className="space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-primary" />
                          <h3 className="font-semibold">{group.title}</h3>
                          <Badge variant="outline">{group.chapters.length} 章</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{group.subtitle}</p>
                      </div>
                      {onDeleteVolume && group.volumeIndex !== undefined && group.chapters.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="self-start text-muted-foreground hover:text-destructive sm:self-auto"
                          onClick={() => setVolumeToDelete({
                            index: group.volumeIndex!,
                            title: group.title,
                            fromChapter: group.startChapter || group.chapters[0]?.index || 1,
                          })}
                        >
                          <Trash2 className="h-4 w-4" />
                          删除本卷及之后
                        </Button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {group.chapters.length > 0 ? (
                        group.chapters.map(renderChapterRow)
                      ) : (
                        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                          本卷还没有已生成章节。
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </div>
      </section>

      <Dialog open={!!viewingChapter} onOpenChange={() => setViewingChapter(null)}>
        <DialogContent className="max-h-[85vh] w-[95vw] max-w-4xl sm:w-full">
          <DialogHeader className="border-b border-border pb-4">
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="min-w-0 text-base">
                第 {viewingChapter?.index} 章
                {viewingChapter?.title && <span className="ml-2 text-sm font-normal text-muted-foreground">{viewingChapter.title}</span>}
              </DialogTitle>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (viewingChapter) {
                      setEditingChapter({ index: viewingChapter.index, content: viewingChapter.content });
                      setViewingChapter(null);
                    }
                  }}
                >
                  <PenLine className="h-4 w-4" />
                  <span className="hidden sm:inline">编辑</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!viewingChapter) return;
                    const nextIndex = chapterIndices.find(index => index > viewingChapter.index);
                    if (!nextIndex) return;
                    await handleView(nextIndex);
                  }}
                  disabled={!viewingChapter || !chapterIndices.some(index => index > (viewingChapter?.index ?? 0))}
                >
                  <ChevronRight className="h-4 w-4" />
                  <span className="hidden sm:inline">下一章</span>
                </Button>
                <Button variant="outline" size="sm" onClick={handleCopy} aria-label={copySuccess ? '已复制' : '复制章节内容'}>
                  {copySuccess ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  <span className="hidden sm:inline">{copySuccess ? '已复制' : '复制'}</span>
                </Button>
              </div>
            </div>
            <DialogDescription className="sr-only">
              阅读、复制、编辑或跳转到下一章。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 max-h-[62vh] overflow-y-auto scrollbar-thin">
            <pre className="whitespace-pre-wrap pr-2 font-sans text-sm leading-8">
              {viewingChapter?.content}
            </pre>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={chapterToDelete !== null} onOpenChange={() => setChapterToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除第 {chapterToDelete} 章吗？此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setChapterToDelete(null)}>取消</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deletingChapter !== null}>
              {deletingChapter !== null ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBatchDeleteConfirm} onOpenChange={setShowBatchDeleteConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认批量删除</DialogTitle>
            <DialogDescription>
              确定要删除选中的 {selectedChapters.size} 个章节吗？此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowBatchDeleteConfirm(false)}>取消</Button>
            <Button variant="destructive" onClick={confirmBatchDelete} disabled={batchDeleting}>
              {batchDeleting ? '删除中...' : `删除 ${selectedChapters.size} 章`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={volumeToDelete !== null} onOpenChange={() => setVolumeToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除整卷</DialogTitle>
            <DialogDescription>
              确定要删除「{volumeToDelete?.title}」及之后所有已生成章节吗？
              <br /><br />
              将删除第 {volumeToDelete?.fromChapter} 章起的所有内容。大纲不受影响，可重新生成。此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setVolumeToDelete(null)}>取消</Button>
            <Button variant="destructive" onClick={confirmDeleteVolume} disabled={deletingVolume}>
              {deletingVolume ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editingChapter && (
        <ChapterEditor
          projectName={project.id}
          chapterIndex={editingChapter.index}
          initialContent={editingChapter.content}
          onClose={() => {
            setEditingChapter(null);
            void onProjectRefresh?.();
          }}
          onSaved={(savedIndex) => {
            if (editingChapter.index === undefined) {
              setEditingChapter((current) => {
                if (!current || current.index !== undefined) return current;
                return { ...current, index: savedIndex };
              });
              void onProjectRefresh?.();
            }
          }}
        />
      )}
    </div>
  );
}
