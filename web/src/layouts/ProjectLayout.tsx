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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useState } from 'react';
import { generateBible as apiBible } from '@/lib/api';

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
  const [aiGenre, setAiGenre] = useState('');
  const [aiTheme, setAiTheme] = useState('');
  const [aiKeywords, setAiKeywords] = useState('');
  const [generatingBible, setGeneratingBible] = useState(false);

  // AI Bible generation for new project
  const handleGenerateBibleForNew = async () => {
    if (!aiGenre.trim()) return;
    setGeneratingBible(true);
    try {
      const result = await apiBible(aiGenre, aiTheme, aiKeywords);
      if (result) {
        setNewProjectBible(result);
      }
    } catch (err) {
      console.error('Failed to generate bible:', err);
    } finally {
      setGeneratingBible(false);
    }
  };

  const submitNewProject = () => {
    handleCreateProject(newProjectName, newProjectBible, newProjectChapters);
    setNewProjectName('');
    setNewProjectBible('');
    setNewProjectChapters('400');
    setAiGenre('');
    setAiTheme('');
    setAiKeywords('');
  };

  // Clear error after 5 seconds
  if (error) {
    setTimeout(() => setError(null), 5000);
  }

  return (
    <div className="h-screen flex overflow-hidden bg-background text-foreground">
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
          selectedProject={selectedProject?.name || null}
          onSelectProject={(name) => {
            handleSelectProject(name);
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
              <Label>AI 辅助生成设定 (可选)</Label>
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
                disabled={generatingBible || !aiGenre.trim()}
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
              onClick={submitNewProject}
              disabled={!newProjectName.trim() || loading}
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
