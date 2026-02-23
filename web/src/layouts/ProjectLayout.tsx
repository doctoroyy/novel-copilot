import { Outlet } from 'react-router-dom';
import { ProjectProvider, useProject } from '@/contexts/ProjectContext';
import { Sidebar, Header, ActivityPanel } from '@/components/layout';
import { SettingsDialog } from '@/components/SettingsDialog';
import { FloatingProgressButton } from '@/components/FloatingProgressButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Sparkles } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useEffect, useState } from 'react';
import {
  fetchBibleTemplates,
  refreshBibleTemplates,
  generateBible as apiBible,
  type BibleImagineTemplate,
} from '@/lib/api';

function ProjectLayoutInner() {
  const {
    projects,
    selectedProject,
    loading,
    error,
    setError,
    isMobile,
    sidebarOpen,
    activityPanelOpen,
    toggleSidebar,
    toggleActivityPanel,
    activeTab,
    handleSelectProject,
    handleTabChange,
    connected,
    logs,
    clearLogs,
    eventsEnabled,
    toggleEvents,
    generationState,
    showSettingsDialog,
    setShowSettingsDialog,
    showNewProjectDialog,
    setShowNewProjectDialog,
    handleCreateProject,
    handleDeleteProject,
    handleRefresh,
    handleDownloadBook,
  } = useProject();

  // New project form state (local to layout)
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectBible, setNewProjectBible] = useState('');
  const [newProjectChapters, setNewProjectChapters] = useState('400');
  const [newProjectMinChapterWords, setNewProjectMinChapterWords] = useState('2500');
  const [aiGenre, setAiGenre] = useState('');
  const [aiTheme, setAiTheme] = useState('');
  const [aiKeywords, setAiKeywords] = useState('');
  const [generatingBible, setGeneratingBible] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateSnapshotDate, setTemplateSnapshotDate] = useState('latest');
  const [templateDates, setTemplateDates] = useState<string[]>([]);
  const [templateOptions, setTemplateOptions] = useState<BibleImagineTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateRefreshing, setTemplateRefreshing] = useState(false);
  const [templateHint, setTemplateHint] = useState<string | null>(null);

  const loadTemplates = async (snapshotDate?: string) => {
    setTemplateLoading(true);
    try {
      const data = await fetchBibleTemplates(snapshotDate);
      setTemplateOptions(data.templates || []);
      const snapshots = (data.availableSnapshots || [])
        .filter((entry) => entry.status === 'ready')
        .map((entry) => entry.snapshotDate);
      setTemplateDates(snapshots);

      if (snapshotDate) {
        setTemplateSnapshotDate(snapshotDate);
      } else if (templateSnapshotDate !== 'latest' && data.snapshotDate) {
        setTemplateSnapshotDate(data.snapshotDate);
      }

      if (data.templates.length === 0) {
        setSelectedTemplateId('');
      } else if (!data.templates.some((item) => item.id === selectedTemplateId)) {
        setSelectedTemplateId('');
      }
    } catch (err) {
      setError(`加载模板失败：${(err as Error).message}`);
    } finally {
      setTemplateLoading(false);
    }
  };

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const selected = templateOptions.find((item) => item.id === templateId);
    if (!selected) return;

    if (!aiGenre.trim()) setAiGenre(selected.genre);
    if (!aiTheme.trim()) setAiTheme(selected.coreTheme);
    if (!aiKeywords.trim()) setAiKeywords((selected.keywords || []).join('、'));
  };

  const handleRefreshTemplates = async () => {
    setTemplateRefreshing(true);
    try {
      const enqueue = await refreshBibleTemplates(undefined, true);
      setTemplateHint(
        enqueue.created
          ? '模板刷新任务已加入任务中心，请在右下角「任务管理」查看进度。'
          : '已有模板刷新任务在执行，请在右下角「任务管理」查看进度。'
      );
      await loadTemplates(templateSnapshotDate === 'latest' ? undefined : templateSnapshotDate);
    } catch (err) {
      setTemplateHint(null);
      setError(`刷新模板失败：${(err as Error).message}`);
    } finally {
      setTemplateRefreshing(false);
    }
  };

  // AI Bible generation for new project
  const handleGenerateBibleForNew = async () => {
    setGeneratingBible(true);
    try {
      const selectedTemplate = templateOptions.find((item) => item.id === selectedTemplateId);
      const result = await apiBible({
        genre: aiGenre,
        theme: aiTheme,
        keywords: aiKeywords,
        templateId: selectedTemplateId || undefined,
        templateSnapshotDate:
          templateSnapshotDate && templateSnapshotDate !== 'latest'
            ? templateSnapshotDate
            : undefined,
        template: selectedTemplate,
      });
      if (result) {
        setNewProjectBible(result);
      }
    } catch (err) {
      console.error('Failed to generate bible:', err);
      setError(`生成设定失败：${(err as Error).message}`);
    } finally {
      setGeneratingBible(false);
    }
  };

  const submitNewProject = async () => {
    const trimmedName = newProjectName.trim();
    const trimmedBible = newProjectBible.trim();
    const parsedChapters = Number.parseInt(newProjectChapters, 10);
    const parsedMinChapterWords = Number.parseInt(newProjectMinChapterWords, 10);

    if (!trimmedName) {
      setError('请输入项目名称');
      return;
    }
    if (!trimmedBible) {
      setError('请输入小说设定（Bible）或先使用 AI 生成');
      return;
    }
    if (!Number.isInteger(parsedChapters) || parsedChapters <= 0) {
      setError('目标章节数必须是大于 0 的整数');
      return;
    }
    if (!Number.isInteger(parsedMinChapterWords) || parsedMinChapterWords < 500 || parsedMinChapterWords > 20000) {
      setError('每章最少字数必须是 500~20000 的整数');
      return;
    }

    try {
      await handleCreateProject(trimmedName, trimmedBible, String(parsedChapters), String(parsedMinChapterWords));
      setNewProjectName('');
      setNewProjectBible('');
      setNewProjectChapters('400');
      setNewProjectMinChapterWords('2500');
      setAiGenre('');
      setAiTheme('');
      setAiKeywords('');
      setSelectedTemplateId('');
      setTemplateSnapshotDate('latest');
    } catch {
      // Error is already surfaced by ProjectContext.
    }
  };

  // Clear error toast after 5 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error, setError]);

  useEffect(() => {
    if (!showNewProjectDialog) return;
    setTemplateHint(null);
    void loadTemplates();
  }, [showNewProjectDialog]);

  return (
    <div className="h-dvh flex overflow-hidden bg-background text-foreground">
      {/* Mobile Sidebar Overlay */}
      {isMobile && sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar */}
      <div className={`
        ${isMobile 
          ? `fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
          : sidebarOpen ? 'relative' : 'hidden'
        }
      `}>
        <Sidebar
          projects={projects}
          selectedProjectId={selectedProject?.id || null}
          onSelectProject={(projectId) => {
            handleSelectProject(projectId);
            if (isMobile) toggleSidebar();
          }}
          onNewProject={() => setShowNewProjectDialog(true)}
          onToggle={toggleSidebar}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          project={selectedProject}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onToggleSidebar={toggleSidebar}
          onToggleActivityPanel={toggleActivityPanel}
          onSettings={() => setShowSettingsDialog(true)}
          onRefresh={handleRefresh}
          onDelete={handleDeleteProject}
          onDownload={handleDownloadBook}
          sidebarOpen={sidebarOpen}
          activityPanelOpen={activityPanelOpen}
        />

        <main className="flex-1 overflow-auto">
          {/* Page content via nested routes */}
          <Outlet />
        </main>
      </div>

      {/* Activity Panel */}
      {activityPanelOpen && (
        <>
          {isMobile && (
            <div 
              className="fixed inset-0 bg-black/50 z-40"
              onClick={toggleActivityPanel}
            />
          )}
          <div className={`
            ${isMobile 
              ? 'fixed inset-y-0 right-0 z-50'
              : 'relative'
            }
          `}>
            <ActivityPanel
              logs={logs}
              onClear={clearLogs}
              onToggle={toggleActivityPanel}
              progress={generationState.isGenerating ? {
                type: 'progress' as const,
                projectName: generationState.projectName || '',
                status: (generationState.status === 'preparing' ? 'starting' : generationState.status) as 'starting' | 'analyzing' | 'planning' | 'generating' | 'reviewing' | 'repairing' | 'saving' | 'updating_summary' | 'done' | 'error',
                current: generationState.current,
                total: generationState.total,
                chapterIndex: generationState.currentChapter || 0,
                message: generationState.message,
              } : null}
              connected={connected}
              enabled={eventsEnabled}
              onToggleEnabled={toggleEvents}
            />
          </div>
        </>
      )}

      {/* Floating Progress Button */}
      <FloatingProgressButton />

      {/* Settings Dialog */}
      <SettingsDialog
        open={showSettingsDialog}
        onOpenChange={setShowSettingsDialog}
      />

      {/* New Project Dialog */}
      <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>创建新项目</DialogTitle>
            <DialogDescription>
              输入项目信息开始创作
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="projectName">项目名称</Label>
              <Input
                id="projectName"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="我的小说"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="chapters">目标章节数</Label>
              <Input
                id="chapters"
                type="number"
                value={newProjectChapters}
                onChange={(e) => setNewProjectChapters(e.target.value)}
                placeholder="400"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="minChapterWords">每章最少字数</Label>
              <Input
                id="minChapterWords"
                type="number"
                min={500}
                max={20000}
                step={100}
                value={newProjectMinChapterWords}
                onChange={(e) => setNewProjectMinChapterWords(e.target.value)}
                placeholder="2500"
              />
            </div>

            <div className="space-y-2">
              <Label>AI 辅助生成设定 (可选)</Label>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={templateSnapshotDate}
                  onValueChange={(value) => {
                    setTemplateSnapshotDate(value);
                    setSelectedTemplateId('');
                    void loadTemplates(value === 'latest' ? undefined : value);
                  }}
                  disabled={templateLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="模板日期" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="latest">最新模板</SelectItem>
                    {templateDates.map((date) => (
                      <SelectItem key={date} value={date}>
                        {date}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshTemplates}
                  disabled={templateRefreshing}
                >
                  {templateRefreshing ? '生成中...' : '拉取/刷新模板'}
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Select
                  value={selectedTemplateId || 'none'}
                  onValueChange={(value) => applyTemplate(value === 'none' ? '' : value)}
                  disabled={templateLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={templateLoading ? '模板加载中...' : '选择可复用模板'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不使用模板</SelectItem>
                    {templateOptions.map((template) => (
                      <SelectItem key={template.id} value={template.id} textValue={template.name}>
                        <div className="flex flex-col gap-0.5">
                          <span className="truncate">{template.name}</span>
                          <span className="text-[11px] text-muted-foreground truncate">{template.genre}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {templateHint && (
                <div className="rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
                  {templateHint}
                </div>
              )}
              {!templateLoading && templateOptions.length === 0 && (
                <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-800">
                  当前还没有可用模板。点击“拉取/刷新模板”后，可在右下角任务中心查看生成进度。
                </div>
              )}
              {selectedTemplateId && (
                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                  {(() => {
                    const selected = templateOptions.find((item) => item.id === selectedTemplateId);
                    if (!selected) return '模板未命中，请重新选择。';
                    return `已选模板：${selected.name} ｜ 类型：${selected.genre} ｜ 卖点：${selected.oneLineSellingPoint}`;
                  })()}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={aiGenre}
                  onChange={(e) => setAiGenre(e.target.value)}
                  placeholder="类型 (玄幻/都市...)"
                />
                <Input
                  value={aiTheme}
                  onChange={(e) => setAiTheme(e.target.value)}
                  placeholder="主题"
                />
              </div>
              <Input
                value={aiKeywords}
                onChange={(e) => setAiKeywords(e.target.value)}
                placeholder="关键词 (逗号分隔)"
              />
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleGenerateBibleForNew}
                disabled={generatingBible}
                className="flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {generatingBible ? '生成中...' : 'AI 生成设定'}
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bible">小说设定 (Bible)</Label>
              <Textarea
                id="bible"
                value={newProjectBible}
                onChange={(e) => setNewProjectBible(e.target.value)}
                placeholder="描述你的小说世界观、主角、主线剧情..."
                rows={6}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button 
              onClick={() => { void submitNewProject(); }}
              disabled={
                !newProjectName.trim() ||
                !newProjectBible.trim() ||
                !Number.isInteger(Number.parseInt(newProjectChapters, 10)) ||
                Number.parseInt(newProjectChapters, 10) <= 0 ||
                !Number.isInteger(Number.parseInt(newProjectMinChapterWords, 10)) ||
                Number.parseInt(newProjectMinChapterWords, 10) < 500 ||
                Number.parseInt(newProjectMinChapterWords, 10) > 20000 ||
                loading
              }
            >
              创建项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Error Toast */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-destructive text-destructive-foreground p-4 rounded-lg shadow-lg max-w-md z-50">
          <p className="text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}

export default function ProjectLayout() {
  return (
    <ProjectProvider>
      <ProjectLayoutInner />
    </ProjectProvider>
  );
}
