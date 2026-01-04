import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
// import { useServerEvents, type ProgressEvent } from '@/hooks/useServerEvents'; // Removed
import { ServerEventsProvider, useServerEventsContext } from '@/contexts/ServerEventsContext';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  fetchProjects,
  fetchProject,
  createProject,
  generateOutline,
  generateChapters,
  fetchChapter,
  deleteProject,
  resetProject,
  generateBible,
  deleteChapter,
  batchDeleteChapters,
  type ProjectSummary,
  type ProjectDetail,
} from '@/lib/api';

// Layout components
import { Sidebar, Header, ActivityPanel } from '@/components/layout';

// View components
import { 
  DashboardView, 
  ChapterListView, 
  GenerateView, 
  OutlineView, 
  BibleView,
  CharacterGraphView,
  AnimeView,
  AnimeEpisodeDetail
} from '@/components/views';
import { SettingsDialog } from '@/components/SettingsDialog';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';

// Constants
const MOBILE_BREAKPOINT = 1024;

function App() {
  // URL routing
  const { projectName, tab = 'dashboard', episodeId } = useParams<{ projectName?: string; tab?: string; episodeId?: string }>();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Logs and progress are managed by ServerEventsContext


  // AI Config from localStorage
  const { config: aiConfig, isConfigured } = useAIConfig();

  // New project dialog
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectBible, setNewProjectBible] = useState('');
  const [newProjectChapters, setNewProjectChapters] = useState('400');
  const [aiGenre, setAiGenre] = useState('');
  const [aiTheme, setAiTheme] = useState('');
  const [aiKeywords, setAiKeywords] = useState('');
  const [generatingBible, setGeneratingBible] = useState(false);

  // Mobile state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileActivityPanelOpen, setMobileActivityPanelOpen] = useState(false);
  
  // Desktop state (default open)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [desktopActivityPanelOpen, setDesktopActivityPanelOpen] = useState(true);

  // Track if we're on mobile
  const [isMobile, setIsMobile] = useState(false);

  // Toggle helpers
  const toggleSidebar = useCallback(() => {
    if (window.innerWidth >= MOBILE_BREAKPOINT) {
      setDesktopSidebarOpen(prev => !prev);
    } else {
      setMobileSidebarOpen(prev => !prev);
    }
  }, []);

  const toggleActivityPanel = useCallback(() => {
    if (window.innerWidth >= MOBILE_BREAKPOINT) {
      setDesktopActivityPanelOpen(prev => !prev);
    } else {
      setMobileActivityPanelOpen(prev => !prev);
    }
  }, []);

  // Initialize and update isMobile on window resize
  useEffect(() => {
    // Initialize on mount
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);

    // Debounced resize handler
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
      }, 150);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);


  // Outline form
  const [outlineChapters, setOutlineChapters] = useState('400');
  const [outlineWordCount, setOutlineWordCount] = useState('100');
  const [outlineCustomPrompt, setOutlineCustomPrompt] = useState('');

  // Generate form
  const [generateCount, setGenerateCount] = useState('1');

  // Log helper (now pushes to context logs? No, context manages logs from server. 
  // For local logs, we can't easily push to context without exposing setLogs.
  // For now, let's just console log local actions or maybe ignore them since they are redundant with UI state.)
  const log = useCallback((msg: string) => {
    console.log(msg); // Fallback for local logs
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadProject = useCallback(async (name: string) => {
    try {
      setLoading(true);
      const data = await fetchProject(name);
      setSelectedProject(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // SSE for real-time logs - now provided via Context
  const { connected, logs, lastProgress: generationProgress, clearLogs, enabled: eventsEnabled, toggleEnabled: toggleEvents } = useServerEventsContext();

  // Handle project refresh on 'done' progress
  useEffect(() => {
    if (generationProgress?.status === 'done' && selectedProject?.name === generationProgress.projectName) {
      loadProject(generationProgress.projectName);
    }
  }, [generationProgress?.status, generationProgress?.projectName, selectedProject?.name, loadProject]);


  useEffect(() => {
    loadProjects();
    // Set dark mode by default
    document.documentElement.classList.add('dark');
  }, [loadProjects]);

  // Load project when URL changes
  useEffect(() => {
    if (projectName && projectName !== selectedProject?.name) {
      loadProject(projectName);
    } else if (!projectName) {
      setSelectedProject(null);
    }
  }, [projectName, selectedProject?.name, loadProject]);

  // Navigation helpers
  const handleSelectProject = useCallback((name: string) => {
    navigate(`/project/${encodeURIComponent(name)}`);
  }, [navigate]);

  const handleTabChange = useCallback((newTab: string) => {
    if (projectName) {
      navigate(`/project/${encodeURIComponent(projectName)}/${newTab}`);
    }
  }, [navigate, projectName]);

  const handleCreateProject = async () => {
    if (!newProjectName || !newProjectBible) {
      setError('请填写项目名称和 Story Bible');
      return;
    }
    try {
      setLoading(true);
      log(`创建项目: ${newProjectName}`);
      await createProject(newProjectName, newProjectBible, parseInt(newProjectChapters, 10));
      log('✅ 项目创建成功');
      setNewProjectName('');
      setNewProjectBible('');
      setShowNewProjectDialog(false);
      await loadProjects();
    } catch (err) {
      setError((err as Error).message);
      log(`❌ 创建失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateOutline = async () => {
    if (!selectedProject) return;
    if (!isConfigured) {
      setError('请先在设置中配置 AI API Key');
      setShowSettingsDialog(true);
      return;
    }
    try {
      setLoading(true);
      log(`生成大纲: ${selectedProject.name}`);
      const outline = await generateOutline(
        selectedProject.name,
        parseInt(outlineChapters, 10),
        parseInt(outlineWordCount, 10),
        outlineCustomPrompt || undefined,
        getAIConfigHeaders(aiConfig)
      );
      log(`✅ 大纲生成完成: ${outline.volumes.length} 卷, ${outline.totalChapters} 章`);
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
      log(`❌ 生成失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateChapters = async () => {
    if (!selectedProject) return;
    if (!isConfigured) {
      setError('请先在设置中配置 AI API Key');
      setShowSettingsDialog(true);
      return;
    }
    try {
      setLoading(true);
      const count = parseInt(generateCount, 10);
      log(`生成章节: ${selectedProject.name}, ${count} 章`);
      // SSE will push real-time progress logs, no need to add logs here after completion
      await generateChapters(selectedProject.name, count, getAIConfigHeaders(aiConfig));
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
      log(`❌ 生成失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleViewChapter = async (index: number): Promise<string> => {
    if (!selectedProject) return '';
    const content = await fetchChapter(selectedProject.name, index);
    return content;
  };

  const handleDeleteChapter = async (index: number): Promise<void> => {
    if (!selectedProject) return;
    try {
      await deleteChapter(selectedProject.name, index);
      log(`🗑️ 已删除第 ${index} 章`);
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleBatchDeleteChapters = async (indices: number[]): Promise<void> => {
    if (!selectedProject) return;
    try {
      await batchDeleteChapters(selectedProject.name, indices);
      log(`🗑️ 已批量删除 ${indices.length} 个章节`);
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProject) return;
    if (!confirm(`确定要删除项目 "${selectedProject.name}" 吗？此操作不可恢复。`)) return;
    try {
      await deleteProject(selectedProject.name);
      log(`🗑️ 已删除项目: ${selectedProject.name}`);
      setSelectedProject(null);
      await loadProjects();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleResetProject = async () => {
    if (!selectedProject) return;
    try {
      await resetProject(selectedProject.name);
      log(`🔄 已重置项目状态: ${selectedProject.name}`);
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDownloadBook = async () => {
    if (!selectedProject) return;
    try {
      const url = `/api/projects/${encodeURIComponent(selectedProject.name)}/download`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('下载失败');
      }

      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `${selectedProject.name}.zip`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
        const filenameStarMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (filenameMatch && !/^%[0-9A-F]{2}/i.test(filenameMatch[1])) {
          filename = filenameMatch[1];
        } else if (filenameStarMatch) {
          filename = decodeURIComponent(filenameStarMatch[1]);
        } else if (filenameMatch) {
          try {
            filename = decodeURIComponent(filenameMatch[1]);
          } catch {
            filename = filenameMatch[1];
          }
        }
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      log(`📥 下载完成: ${filename}`);
    } catch (err) {
      setError('下载失败：' + (err as Error).message);
    }
  };

  const handleGenerateBible = async () => {
    if (!isConfigured) {
      setError('请先在设置中配置 AI API Key');
      setShowSettingsDialog(true);
      return;
    }
    setGeneratingBible(true);
    try {
      log('🤖 AI 正在想象 Story Bible...');
      const bible = await generateBible(aiGenre, aiTheme, aiKeywords, getAIConfigHeaders(aiConfig));
      setNewProjectBible(bible);
      log('✅ Story Bible 生成完成');
    } catch (err) {
      setError((err as Error).message);
      log(`❌ 生成失败: ${(err as Error).message}`);
    } finally {
      setGeneratingBible(false);
    }
  };

  // Render current view based on active tab
  const renderContent = () => {
    // If we have an episodeId, we are in the detail view
    if (episodeId && selectedProject) {
        return (
            <AnimeEpisodeDetail 
                project={selectedProject} 
                episodeId={episodeId}
                onBack={() => navigate(`/project/${encodeURIComponent(selectedProject.name)}/anime`)}
            />
        );
    }

    if (!selectedProject) {
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <div className="text-6xl mb-4">📚</div>
            <p className="text-xl font-medium mb-2">选择一个项目开始</p>
            <p className="text-sm">从左侧选择项目，或创建新项目</p>
          </div>
        </div>
      );
    }

    switch (tab) {
      case 'dashboard':
        return (
          <DashboardView 
            project={selectedProject} 
            onGenerateOutline={handleGenerateOutline}
            onGenerateChapters={handleGenerateChapters}
            loading={loading}
          />
        );
      case 'outline':
        return <OutlineView project={selectedProject} onRefresh={() => loadProject(selectedProject.name)} />;
      case 'generate':
        return (
          <GenerateView
            project={selectedProject}
            loading={loading}
            outlineChapters={outlineChapters}
            outlineWordCount={outlineWordCount}
            outlineCustomPrompt={outlineCustomPrompt}
            onOutlineChaptersChange={setOutlineChapters}
            onOutlineWordCountChange={setOutlineWordCount}
            onOutlineCustomPromptChange={setOutlineCustomPrompt}
            onGenerateOutline={handleGenerateOutline}
            generateCount={generateCount}
            onGenerateCountChange={setGenerateCount}
            onGenerateChapters={handleGenerateChapters}
            onResetState={handleResetProject}
          />
        );
      case 'chapters':
        return (
          <ChapterListView 
            project={selectedProject} 
            onViewChapter={handleViewChapter}
            onDeleteChapter={handleDeleteChapter}
            onBatchDeleteChapters={handleBatchDeleteChapters}
          />
        );
      case 'bible':
        return <BibleView project={selectedProject} />;
      case 'characters':
        return <CharacterGraphView project={selectedProject} />;
      case 'anime':
        return (
            <AnimeView 
                project={selectedProject} 
                onEpisodeSelect={(epId) => navigate(`/project/${encodeURIComponent(selectedProject.name)}/anime/episode/${epId}`)}
            />
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      {/* Mobile Overlay */}
      {(mobileSidebarOpen || mobileActivityPanelOpen) && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => {
            setMobileSidebarOpen(false);
            setMobileActivityPanelOpen(false);
          }}
        />
      )}

      {/* Left Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 transition-all duration-300
        ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto
        ${desktopSidebarOpen ? 'lg:w-[280px]' : 'lg:w-0'} 
        lg:overflow-hidden
      `}>
        <div className="w-[280px] h-full">
          <Sidebar
            projects={projects}
            selectedProject={selectedProject?.name || null}
            onSelectProject={(name) => {
              handleSelectProject(name);
              setMobileSidebarOpen(false);
            }}
            onNewProject={() => {
              setShowNewProjectDialog(true);
              setMobileSidebarOpen(false);
            }}
            onToggle={toggleSidebar}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <Header
          project={selectedProject}
          activeTab={tab}
          onTabChange={handleTabChange}
          onRefresh={async () => {
            if (selectedProject) {
              await Promise.all([loadProject(selectedProject.name), loadProjects()]);
            }
          }}
          onDownload={handleDownloadBook}
          onDelete={handleDeleteProject}
          onSettings={() => setShowSettingsDialog(true)}
          onToggleSidebar={toggleSidebar}
          onToggleActivityPanel={toggleActivityPanel}
          sidebarOpen={isMobile ? mobileSidebarOpen : desktopSidebarOpen}
          activityPanelOpen={isMobile ? mobileActivityPanelOpen : desktopActivityPanelOpen}
        />

        {/* Error banner */}
        {error && (
          <div className="bg-destructive/10 text-destructive px-6 py-3 flex items-center justify-between">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              ✕
            </Button>
          </div>
        )}

        {/* Main content area */}
        <main className="flex-1 overflow-auto bg-background/50 grid-pattern">
          {renderContent()}
        </main>
      </div>

      {/* Right Activity Panel */}
      <div className={`
        fixed inset-y-0 right-0 z-50 transition-all duration-300
        ${mobileActivityPanelOpen ? 'translate-x-0' : 'translate-x-full'}
        lg:translate-x-0 lg:static lg:z-auto
        ${desktopActivityPanelOpen ? 'lg:w-[320px]' : 'lg:w-0'}
        lg:overflow-hidden
      `}>
        <div className="w-[320px] h-full">
          <ActivityPanel 
            logs={logs} 
            onClear={clearLogs} 
            progress={generationProgress}
            connected={connected}
            onToggle={toggleActivityPanel}
            enabled={eventsEnabled}
            onToggleEnabled={toggleEvents}
          />
        </div>
      </div>

      {/* New Project Dialog */}
      <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto glass-card w-[95vw] sm:w-full">
          <DialogHeader>
            <DialogTitle className="gradient-text text-lg lg:text-xl">✨ 新建项目</DialogTitle>
            <DialogDescription className="text-sm">创建一个新的小说项目</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-sm">项目名称</Label>
              <Input
                placeholder="my-novel"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="bg-muted/50 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">计划章数</Label>
              <Input
                type="number"
                value={newProjectChapters}
                onChange={(e) => setNewProjectChapters(e.target.value)}
                className="bg-muted/50 text-sm"
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Story Bible</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateBible}
                  disabled={generatingBible}
                  className="gap-2 text-xs"
                >
                  {generatingBible ? '⏳ 生成中...' : '🤖 AI 自动想象'}
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                <Input
                  placeholder="题材: 玄幻/都市/科幻"
                  value={aiGenre}
                  onChange={(e) => setAiGenre(e.target.value)}
                  className="bg-muted/50 text-sm"
                />
                <Input
                  placeholder="风格: 热血/悬疑/爽文"
                  value={aiTheme}
                  onChange={(e) => setAiTheme(e.target.value)}
                  className="bg-muted/50 text-sm"
                />
                <Input
                  placeholder="关键词: 逆袭、复仇"
                  value={aiKeywords}
                  onChange={(e) => setAiKeywords(e.target.value)}
                  className="bg-muted/50 text-sm"
                />
              </div>
              <Textarea
                placeholder="世界观、人物设定、主线目标..."
                className="h-[200px] sm:h-[250px] max-h-[300px] font-mono text-xs sm:text-sm resize-none bg-muted/50"
                value={newProjectBible}
                onChange={(e) => setNewProjectBible(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="w-full sm:w-auto">取消</Button>
            </DialogClose>
            <Button 
              onClick={handleCreateProject} 
              disabled={loading}
              className="gradient-bg hover:opacity-90 w-full sm:w-auto"
            >
              创建项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <SettingsDialog 
        open={showSettingsDialog} 
        onOpenChange={setShowSettingsDialog} 
      />
    </div>
  );
}

function AppWithProvider() {
  return (
    <ServerEventsProvider>
      <App />
    </ServerEventsProvider>
  );
}

export default AppWithProvider;

