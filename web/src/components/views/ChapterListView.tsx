import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { ProjectDetail } from '@/lib/api';

interface ChapterListViewProps {
  project: ProjectDetail;
  onViewChapter: (index: number) => Promise<string>;
  onDeleteChapter?: (index: number) => Promise<void>;
}

export function ChapterListView({ project, onViewChapter, onDeleteChapter }: ChapterListViewProps) {
  const [viewingChapter, setViewingChapter] = useState<{ index: number; content: string; title?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyingChapter, setCopyingChapter] = useState<number | null>(null);
  const [copiedChapter, setCopiedChapter] = useState<number | null>(null);
  const [deletingChapter, setDeletingChapter] = useState<number | null>(null);
  const [chapterToDelete, setChapterToDelete] = useState<number | null>(null);

  const getChapterTitle = (chapterIndex: number) => {
    if (!project.outline) return null;
    for (const vol of project.outline.volumes) {
      const ch = vol.chapters.find(c => c.index === chapterIndex);
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
    await navigator.clipboard.writeText(viewingChapter.content);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleQuickCopy = async (index: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening the dialog
    setCopyingChapter(index);
    try {
      const content = await onViewChapter(index);
      await navigator.clipboard.writeText(content);
      setCopiedChapter(index);
      setTimeout(() => setCopiedChapter(null), 2000);
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
          <div className="flex items-center justify-between">
            <CardTitle className="text-base lg:text-lg">已生成章节</CardTitle>
            <Badge variant="secondary" className="text-xs">{project.chapters.length} 章</Badge>
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
                              onClick={() => handleView(chapterIndex)}
                              disabled={loading}
                              className="w-full p-2.5 lg:p-3 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors text-left flex items-center justify-between group"
                            >
                              <div className="flex-1 min-w-0">
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
                                  {copyingChapter === chapterIndex ? '复制中...' : copiedChapter === chapterIndex ? '✅ 已复制' : '📋 复制'}
                                </button>
                                {onDeleteChapter && (
                                  <button
                                    onClick={(e) => handleDelete(chapterIndex, e)}
                                    disabled={deletingChapter === chapterIndex}
                                    className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                                    title="删除章节"
                                  >
                                    {deletingChapter === chapterIndex ? '删除中...' : '🗑️ 删除'}
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
                      onClick={() => handleView(index)}
                      disabled={loading}
                      className="w-full p-3 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors text-left flex items-center justify-between group"
                    >
                      <span className="font-medium">第 {index} 章</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={(e) => handleQuickCopy(index, e)}
                          disabled={copyingChapter === index}
                          className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                          title="复制章节内容"
                        >
                          {copyingChapter === index ? '复制中...' : copiedChapter === index ? '✅ 已复制' : '📋 复制'}
                        </button>
                        {onDeleteChapter && (
                          <button
                            onClick={(e) => handleDelete(index, e)}
                            disabled={deletingChapter === index}
                            className="text-xs px-2 py-1 rounded bg-muted/50 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                            title="删除章节"
                          >
                            {deletingChapter === index ? '删除中...' : '🗑️ 删除'}
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
                <div className="text-4xl mb-3">📖</div>
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
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="gap-1 lg:gap-2 text-xs lg:text-sm shrink-0"
                aria-label={copySuccess ? '已复制' : '复制章节内容'}
              >
                {copySuccess ? '✅' : '📋'}
                <span className="hidden sm:inline">{copySuccess ? '已复制' : '复制'}</span>
              </Button>
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
    </div>
  );
}
