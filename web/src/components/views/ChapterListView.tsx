import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Trash2, Copy, Check, X, ChevronRight, Loader2, BookOpen, Edit } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { ProjectDetail } from '@/lib/api';
import { ChapterEditor } from '@/components/ChapterEditor';

// Cross-platform clipboard copy with fallback for mobile browsers
// The fallback is needed because clipboard API may fail when called after async operations
async function copyToClipboard(text: string): Promise<boolean> {
  // Try modern clipboard API first
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback:', err);
    }
  }

  // Fallback: create a temporary textarea and use execCommand
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;

    // Position off-screen and make invisible
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    textArea.style.opacity = '0';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    // For iOS Safari
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
}

export function ChapterListView({ project, onViewChapter, onDeleteChapter, onBatchDeleteChapters }: ChapterListViewProps) {
  const [viewingChapter, setViewingChapter] = useState<{ index: number; content: string; title?: string } | null>(null);
  const [editingChapter, setEditingChapter] = useState<{ index: number; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyingChapter, setCopyingChapter] = useState<number | null>(null);
  const [copiedChapter, setCopiedChapter] = useState<number | null>(null);
  const [copyError, setCopyError] = useState<number | null>(null);
  const [deletingChapter, setDeletingChapter] = useState<number | null>(null);
  const [chapterToDelete, setChapterToDelete] = useState<number | null>(null);

  // Selection mode for batch delete
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  const getChapterTitle = (chapterIndex: number) => {
    if (!project.outline) return null;
    for (const vol of project.outline.volumes) {
      const ch = vol.chapters?.find(c => c.index === chapterIndex);
      if (ch) return ch.title;
    }
    return null;
  };

  const handleView = async (index: number) => {
    setLoading(true);
    try {
      const content = await onViewChapter(index);
      setViewingChapter({
        index,
        content,
        title: getChapterTitle(index) || undefined
      });
    } finally {
      setLoading(false);
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

  const handleQuickCopy = async (index: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening the dialog
    setCopyingChapter(index);
    setCopyError(null);
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
    } finally {
      setCopyingChapter(null);
    }
  };

  const handleDelete = async (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setChapterToDelete(index);
  };

  const confirmDelete = async () => {
    if (!chapterToDelete || !onDeleteChapter) return;
    setDeletingChapter(chapterToDelete);
    try {
      await onDeleteChapter(chapterToDelete);
    } finally {
      setDeletingChapter(null);
      setChapterToDelete(null);
    }
  };

  // Selection handlers for batch delete
  const toggleSelection = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedChapters);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedChapters(newSelected);
  };

  const allChapterIndices = project.chapters.map(ch => parseInt(ch.replace('.md', ''), 10));

  const selectAll = () => {
    setSelectedChapters(new Set(allChapterIndices));
  };

  const clearSelection = () => {
    setSelectedChapters(new Set());
  };

  const confirmBatchDelete = async () => {
    if (!onBatchDeleteChapters || selectedChapters.size === 0) return;
    setBatchDeleting(true);
    try {
      await onBatchDeleteChapters(Array.from(selectedChapters));
      setSelectedChapters(new Set());
      setSelectionMode(false);
    } finally {
      setBatchDeleting(false);
      setShowBatchDeleteConfirm(false);
    }
  };

  // Group chapters by volume
  const volumeGroups = project.outline?.volumes.map(vol => ({
    ...vol,
    chapters: project.chapters
      .map(ch => parseInt(ch.replace('.md', ''), 10))
      .filter(idx => idx >= vol.startChapter && idx <= vol.endChapter)
  })) || [];

  return (
    <div className="p-4 lg:p-6">
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base lg:text-lg">已生成章节</CardTitle>
              <Badge variant="secondary" className="text-xs">{project.chapters.length} 章</Badge>
            </div>
            {onBatchDeleteChapters && project.chapters.length > 0 && (
              <div className="flex items-center gap-2">
                {selectionMode ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs h-7">
                      全选
                    </Button>
                    <Button variant="ghost" size="sm" onClick={clearSelection} className="text-xs h-7">
                      清除
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowBatchDeleteConfirm(true)}
                      disabled={selectedChapters.size === 0}
                      className="text-xs h-7"
                    >
                      删除选中 ({selectedChapters.size})
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setSelectionMode(false); clearSelection(); }} className="text-xs h-7">
                      取消
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setSelectionMode(true)} className="text-xs h-7 flex items-center gap-1">
                    <Trash2 className="h-3.5 w-3.5" />
                    批量删除
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-240px)] lg:h-[calc(100vh-280px)]">
            {project.outline ? (
              // Grouped by volume
              <div className="space-y-4 lg:space-y-6">
                {volumeGroups.map((vol, volIndex) => (
                  vol.chapters.length > 0 && (
                    <div key={volIndex}>
                      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                        <span className="text-xs lg:text-sm font-medium truncate">{vol.title}</span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {vol.chapters.length} 章
                        </Badge>
                      </div>
                      <div className="grid gap-2">
                        {vol.chapters.map((chapterIndex) => {
                          const title = getChapterTitle(chapterIndex);
                          return (
                            <button
                              key={chapterIndex}
                              onClick={selectionMode ? (e) => toggleSelection(chapterIndex, e) : () => handleView(chapterIndex)}
                              disabled={loading && !selectionMode}
                              className={`w-full p-2.5 lg:p-3 rounded-lg transition-colors text-left flex items-center justify-between group ${selectionMode && selectedChapters.has(chapterIndex) ? 'bg-primary/20 ring-2 ring-primary' : 'bg-muted/30 hover:bg-muted/60'}`}
                            >
                              <div className="flex-1 min-w-0 flex items-center gap-2">
                                {selectionMode && (
                                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${selectedChapters.has(chapterIndex) ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'}`}>
                                    {selectedChapters.has(chapterIndex) && <Check className="h-3 w-3" />}
                                  </div>
                                )}
                                <span className="font-medium text-xs lg:text-sm">第 {chapterIndex} 章</span>
                                {title && (
                                  <span className="ml-2 text-xs lg:text-sm text-muted-foreground truncate">
                                    {title}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={(e) => handleQuickCopy(chapterIndex, e)}
                                  disabled={copyingChapter === chapterIndex}
                                  className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                                  title="复制章节内容"
                                >
                                  {copyingChapter === chapterIndex ? <><Loader2 className="h-3 w-3 animate-spin inline mr-1" />复制中</> : copiedChapter === chapterIndex ? <><Check className="h-3 w-3 inline mr-1" />已复制</> : copyError === chapterIndex ? <><X className="h-3 w-3 inline mr-1" />失败</> : <><Copy className="h-3 w-3 inline mr-1" />复制</>}
                                </button>
                                {onDeleteChapter && (
                                  <button
                                    onClick={(e) => handleDelete(chapterIndex, e)}
                                    disabled={deletingChapter === chapterIndex}
                                    className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                                    title="删除章节"
                                  >
                                    {deletingChapter === chapterIndex ? <><Loader2 className="h-3 w-3 animate-spin inline mr-1" />删除中</> : <><Trash2 className="h-3 w-3 inline mr-1" />删除</>}
                                  </button>
                                )}
                                <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">
                                  查看 →
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )
                ))}
              </div>
            ) : (
              // Simple list
              <div className="grid gap-2">
                {project.chapters.map((ch) => {
                  const index = parseInt(ch.replace('.md', ''), 10);
                  return (
                    <button
                      key={ch}
                      onClick={selectionMode ? (e) => toggleSelection(index, e) : () => handleView(index)}
                      disabled={loading && !selectionMode}
                      className={`w-full p-3 rounded-lg transition-colors text-left flex items-center justify-between group ${selectionMode && selectedChapters.has(index) ? 'bg-primary/20 ring-2 ring-primary' : 'bg-muted/30 hover:bg-muted/60'}`}
                    >
                      <div className="flex items-center gap-2">
                        {selectionMode && (
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${selectedChapters.has(index) ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'}`}>
                            {selectedChapters.has(index) && <Check className="h-3 w-3" />}
                          </div>
                        )}
                        <span className="font-medium">第 {index} 章</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={(e) => handleQuickCopy(index, e)}
                          disabled={copyingChapter === index}
                          className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                          title="复制章节内容"
                        >
                          {copyingChapter === index ? <><Loader2 className="h-3 w-3 animate-spin inline mr-1" />复制中</> : copiedChapter === index ? <><Check className="h-3 w-3 inline mr-1" />已复制</> : copyError === index ? <><X className="h-3 w-3 inline mr-1" />失败</> : <><Copy className="h-3 w-3 inline mr-1" />复制</>}
                        </button>
                        {onDeleteChapter && (
                          <button
                            onClick={(e) => handleDelete(index, e)}
                            disabled={deletingChapter === index}
                            className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                            title="删除章节"
                          >
                            {deletingChapter === index ? <><Loader2 className="h-3 w-3 animate-spin inline mr-1" />删除中</> : <><Trash2 className="h-3 w-3 inline mr-1" />删除</>}
                          </button>
                        )}
                        <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">
                          查看 →
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {project.chapters.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>暂无生成的章节</p>
                <p className="text-sm">前往"生成"标签页开始创作</p>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Chapter Reader Dialog */}
      <Dialog open={!!viewingChapter} onOpenChange={() => setViewingChapter(null)}>
        <DialogContent className="max-w-4xl w-[95vw] sm:w-full max-h-[85vh] flex flex-col">
          <DialogHeader className="pb-3 lg:pb-4 border-b border-border">
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="flex items-center gap-2 text-sm lg:text-base min-w-0">
                <span className="shrink-0">第 {viewingChapter?.index} 章</span>
                {viewingChapter?.title && (
                  <span className="text-muted-foreground font-normal truncate text-xs lg:text-sm">
                    {viewingChapter.title}
                  </span>
                )}
              </DialogTitle>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (viewingChapter) {
                      setEditingChapter({ index: viewingChapter.index, content: viewingChapter.content });
                      setViewingChapter(null);
                    }
                  }}
                  className="gap-1 lg:gap-2 text-xs lg:text-sm"
                >
                  <Edit className="h-4 w-4" />
                  <span className="hidden sm:inline">编辑</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!viewingChapter) return;
                    const nextIndex = viewingChapter.index + 1;
                    const nextChapterExists = project.chapters.some(
                      ch => parseInt(ch.replace('.md', ''), 10) === nextIndex
                    );
                    if (nextChapterExists) {
                      setLoading(true);
                      try {
                        const content = await onViewChapter(nextIndex);
                        setViewingChapter({
                          index: nextIndex,
                          content,
                          title: getChapterTitle(nextIndex) || undefined
                        });
                      } finally {
                        setLoading(false);
                      }
                    }
                  }}
                  disabled={loading || !viewingChapter || !project.chapters.some(
                    ch => parseInt(ch.replace('.md', ''), 10) === (viewingChapter?.index ?? 0) + 1
                  )}
                  className="gap-1 lg:gap-2 text-xs lg:text-sm"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="hidden sm:inline">{loading ? '加载中' : '下一章'}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="gap-1 lg:gap-2 text-xs lg:text-sm"
                  aria-label={copySuccess ? '已复制' : '复制章节内容'}
                >
                  {copySuccess ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  <span className="hidden sm:inline">{copySuccess ? '已复制' : '复制'}</span>
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto mt-3 lg:mt-4 scrollbar-thin">
            <div className="prose prose-sm dark:prose-invert max-w-none pr-2">
              <pre className="whitespace-pre-wrap font-sans text-xs lg:text-sm leading-relaxed">
                {viewingChapter?.content}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={chapterToDelete !== null} onOpenChange={() => setChapterToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除第 {chapterToDelete} 章吗？此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setChapterToDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deletingChapter !== null}>
              {deletingChapter !== null ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Delete Confirmation Dialog */}
      <Dialog open={showBatchDeleteConfirm} onOpenChange={setShowBatchDeleteConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认批量删除</DialogTitle>
            <DialogDescription>
              确定要删除选中的 {selectedChapters.size} 个章节吗？此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowBatchDeleteConfirm(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmBatchDelete} disabled={batchDeleting}>
              {batchDeleting ? '删除中...' : `删除 ${selectedChapters.size} 章`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chapter Editor (Full-screen overlay) */}
      {editingChapter && (
        <ChapterEditor
          projectName={project.name}
          chapterIndex={editingChapter.index}
          initialContent={editingChapter.content}
          onClose={() => setEditingChapter(null)}
          onSaved={() => {
            // Optionally refresh chapter list after save
          }}
        />
      )}
    </div>
  );
}
