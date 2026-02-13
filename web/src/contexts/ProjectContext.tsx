import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useServerEventsContext } from '@/contexts/ServerEventsContext';
import { useGeneration } from '@/contexts/GenerationContext';
import { useAIConfig } from '@/hooks/useAIConfig';
import {
  fetchProjects,
  fetchProject,
  createProject,
  generateOutline,
  generateChaptersWithProgress,
  fetchChapter,
  deleteProject,
  resetProject,
  generateBible,
  deleteChapter,
  batchDeleteChapters,
  getAllActiveTasks,
  type ProjectSummary,
  type ProjectDetail,
} from '@/lib/api';
import { addTaskToHistory } from '@/components/FloatingProgressButton';

// Constants
const MOBILE_BREAKPOINT = 1024;

interface ProjectContextType {
  // Projects list
  projects: ProjectSummary[];
  loadProjects: () => Promise<void>;
  
  // Selected project
  selectedProject: ProjectDetail | null;
  loadProject: (name: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  
  // UI Config
  config: ReturnType<typeof useAIConfig>['config'];
  isConfigured: boolean;
  
  // Generation state
  generationState: ReturnType<typeof useGeneration>['generationState'];
  setGenerationState: ReturnType<typeof useGeneration>['setGenerationState'];
  generatingOutline: boolean;
  
  // SSE connection
  connected: boolean;
  logs: string[];
  clearLogs: () => void;
  eventsEnabled: boolean;
  toggleEvents: (val?: boolean) => void;
  
  // UI State
  isMobile: boolean;
  sidebarOpen: boolean;
  activityPanelOpen: boolean;
  toggleSidebar: () => void;
  toggleActivityPanel: () => void;
  
  // Navigation
  activeTab: string;
  handleSelectProject: (name: string) => void;
  handleTabChange: (tab: string) => void;
  
  // Dialogs
  showSettingsDialog: boolean;
  setShowSettingsDialog: (val: boolean) => void;
  showNewProjectDialog: boolean;
  setShowNewProjectDialog: (val: boolean) => void;
  
  // Project handlers
  handleCreateProject: (name: string, bible: string, chapters: string) => Promise<void>;
  handleDeleteProject: () => Promise<void>;
  handleRefresh: () => Promise<void>;
  
  // Generation handlers
  handleGenerateOutline: (chapters: string, wordCount: string, customPrompt: string) => Promise<void>;
  handleGenerateChapters: (count: string) => Promise<void>;
  handleResetProject: () => Promise<void>;
  
  // Chapter handlers
  handleViewChapter: (index: number) => Promise<string>;
  handleDeleteChapter: (index: number) => Promise<void>;
  handleBatchDeleteChapters: (indices: number[]) => Promise<void>;
  handleDownloadBook: () => Promise<void>;
  handleGenerateBible: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within ProjectProvider');
  }
  return context;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { projectName } = useParams<{ projectName?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Derive active tab from URL pathname
  const tab = useMemo(() => {
    const pathParts = location.pathname.split('/');
    // URL pattern: /project/:projectName/:tab
    // pathParts: ['', 'project', 'projectName', 'tab', ...]
    if (pathParts.length >= 4 && pathParts[1] === 'project') {
      return pathParts[3] || 'dashboard';
    }
    return 'dashboard';
  }, [location.pathname]);

  // Projects state
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI Config
  const { config, isConfigured } = useAIConfig();

  // Generation state
  const { generationState, setGenerationState, startGeneration, completeGeneration } = useGeneration();
  const [generatingOutline, setGeneratingOutline] = useState(false);

  // SSE events
  const { connected, logs, lastProgress: generationProgress, clearLogs, enabled: eventsEnabled, toggleEnabled: toggleEvents } = useServerEventsContext();

  // UI State
  const [isMobile, setIsMobile] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileActivityPanelOpen, setMobileActivityPanelOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [desktopActivityPanelOpen, setDesktopActivityPanelOpen] = useState(false);

  // Dialogs
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);

  // Computed values
  const sidebarOpen = isMobile ? mobileSidebarOpen : desktopSidebarOpen;
  const activityPanelOpen = isMobile ? mobileActivityPanelOpen : desktopActivityPanelOpen;

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

  // Initialize mobile state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);

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

  // Load projects
  const loadProjects = useCallback(async () => {
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Load single project
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

  // Initial load
  useEffect(() => {
    loadProjects();
    document.documentElement.classList.add('dark');
  }, [loadProjects]);

  // Check for running tasks on mount
  useEffect(() => {
    const checkActiveTasks = async () => {
      try {
        const tasks = await getAllActiveTasks();
        const runningTask = tasks.find(t => t.status === 'running');
        if (runningTask) {
          const threeMinutesMs = 3 * 60 * 1000;
          const isHealthy = runningTask.updatedAtMs && (Date.now() - runningTask.updatedAtMs < threeMinutesMs);
          
          if (isHealthy) {
            setGenerationState({
              isGenerating: true,
              current: runningTask.completedChapters.length,
              total: runningTask.targetCount,
              currentChapter: runningTask.currentProgress,
              status: 'generating',
              message: runningTask.currentMessage || `正在生成第 ${runningTask.currentProgress} 章...`,
              startTime: runningTask.updatedAtMs - (runningTask.completedChapters.length * 60 * 1000),
              projectName: runningTask.projectName,
            });
          }
        }
      } catch (err) {
        console.warn('Failed to check active tasks:', err);
      }
    };
    checkActiveTasks();
  }, [setGenerationState]);

  // Load project when URL changes
  useEffect(() => {
    if (projectName && projectName !== selectedProject?.name) {
      loadProject(projectName);
    } else if (!projectName) {
      setSelectedProject(null);
    }
  }, [projectName, selectedProject?.name, loadProject]);

  // Sync SSE progress to GenerationContext
  useEffect(() => {
    if (!generationProgress) return;
    
    if (generationProgress.status === 'done' || generationProgress.status === 'error') {
      setGenerationState(prev => ({
        ...prev,
        isGenerating: false,
        status: generationProgress.status === 'done' ? 'done' : 'error',
        message: generationProgress.message || (generationProgress.status === 'done' ? '生成完成' : '生成失败'),
      }));
      return;
    }
    
    setGenerationState(prev => ({
      ...prev,
      isGenerating: true,
      current: generationProgress.current,
      total: generationProgress.total,
      currentChapter: generationProgress.chapterIndex,
      currentChapterTitle: generationProgress.chapterTitle,
      status: generationProgress.status as 'generating' | 'saving' | 'done' | 'error' | 'preparing',
      message: generationProgress.message || `正在生成第 ${generationProgress.chapterIndex} 章...`,
      projectName: generationProgress.projectName,
      startTime: prev.startTime || Date.now(),
    }));
  }, [generationProgress, setGenerationState]);

  // Refresh on generation done
  useEffect(() => {
    if (generationProgress?.status === 'done' && selectedProject?.name === generationProgress.projectName) {
      loadProject(generationProgress.projectName);
    }
  }, [generationProgress?.status, generationProgress?.projectName, selectedProject?.name, loadProject]);

  // Navigation helpers
  const handleSelectProject = useCallback((name: string) => {
    navigate(`/project/${encodeURIComponent(name)}`);
  }, [navigate]);

  const handleTabChange = useCallback((newTab: string) => {
    if (projectName) {
      navigate(`/project/${encodeURIComponent(projectName)}/${newTab}`);
    }
  }, [navigate, projectName]);

  // Project handlers
  const handleCreateProject = useCallback(async (name: string, bible: string, chapters: string) => {
    if (!name.trim()) return;
    
    setLoading(true);
    try {
      await createProject(name, bible, parseInt(chapters));
      setShowNewProjectDialog(false);
      await loadProjects();
      navigate(`/project/${encodeURIComponent(name)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isConfigured, loadProjects, navigate]);

  const handleDeleteProject = useCallback(async () => {
    if (!selectedProject) return;
    if (!confirm(`确定要删除项目 "${selectedProject.name}" 吗？此操作不可恢复。`)) return;
    
    setLoading(true);
    try {
      await deleteProject(selectedProject.name);
      await loadProjects();
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, loadProjects, navigate]);

  const handleRefresh = useCallback(async () => {
    await loadProjects();
    if (selectedProject) {
      await loadProject(selectedProject.name);
    }
  }, [loadProjects, loadProject, selectedProject]);

  // Generation handlers
  const handleGenerateOutline = useCallback(async (chapters: string, wordCount: string, customPrompt: string) => {
    if (!selectedProject || !isConfigured) return;
    
    setGeneratingOutline(true);
    try {
      await generateOutline(selectedProject.name, parseInt(chapters), parseInt(wordCount), customPrompt);
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingOutline(false);
    }
  }, [selectedProject, isConfigured, loadProject]);

  const handleGenerateChapters = useCallback(async (count: string) => {
    if (!selectedProject || !isConfigured) return;
    
    const chapterCount = parseInt(count);
    const startChapter = selectedProject.state.nextChapterIndex;
    
    startGeneration(selectedProject.name, chapterCount);
    
    try {
      await generateChaptersWithProgress(
        selectedProject.name,
        chapterCount,
        {
          onStart: (total: number) => {
            setGenerationState(prev => ({ ...prev, total }));
          },
          onProgress: (event) => {
            setGenerationState(prev => ({
              ...prev,
              current: event.current || prev.current,
              total: event.total || prev.total,
              currentChapter: event.chapterIndex,
              currentChapterTitle: event.title,
              status: event.status as 'generating' | 'saving' | 'done' | 'error' | 'preparing',
              message: event.message,
            }));
          },
          onChapterComplete: (_chapterIndex: number, _title: string, _preview: string) => {
            loadProject(selectedProject.name);
          },
          onChapterError: (chapterIndex: number, error: string) => {
            console.error(`Chapter ${chapterIndex} error:`, error);
          },
          onDone: (results, failedChapters) => {
            completeGeneration();
            loadProject(selectedProject.name);
            addTaskToHistory({
              type: 'chapters',
              title: `${selectedProject.name}: 第${startChapter}-${startChapter + results.length - 1}章`,
              status: failedChapters?.length ? 'error' : 'success',
              startTime: generationState.startTime || Date.now(),
              endTime: Date.now(),
              details: `生成 ${results.length} 章${failedChapters?.length ? `，失败 ${failedChapters.length} 章` : ''}`,
            });
          },
          onError: (error: string) => {
            completeGeneration();
            setError(error);
          },
        },
      );
    } catch (err) {
      completeGeneration();
      setError((err as Error).message);
    }
  }, [selectedProject, isConfigured, startGeneration, completeGeneration, setGenerationState, loadProject, generationState.startTime]);

  const handleResetProject = useCallback(async () => {
    if (!selectedProject) return;
    
    setLoading(true);
    try {
      await resetProject(selectedProject.name);
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, loadProject]);

  // Chapter handlers
  const handleViewChapter = useCallback(async (index: number): Promise<string> => {
    if (!selectedProject) return '';
    return await fetchChapter(selectedProject.name, index);
  }, [selectedProject]);

  const handleDeleteChapter = useCallback(async (index: number): Promise<void> => {
    if (!selectedProject) return;
    await deleteChapter(selectedProject.name, index);
    await loadProject(selectedProject.name);
  }, [selectedProject, loadProject]);

  const handleBatchDeleteChapters = useCallback(async (indices: number[]): Promise<void> => {
    if (!selectedProject) return;
    await batchDeleteChapters(selectedProject.name, indices);
    await loadProject(selectedProject.name);
  }, [selectedProject, loadProject]);

  const handleDownloadBook = useCallback(async () => {
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
    } catch (err) {
      setError('下载失败：' + (err as Error).message);
    }
  }, [selectedProject]);

  const handleGenerateBible = useCallback(async () => {
    if (!selectedProject || !isConfigured) return;
    
    setLoading(true);
    try {
      // generateBible API: (genre?, theme?, keywords?, aiHeaders?)
      await generateBible(undefined, undefined, undefined);
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, isConfigured, loadProject]);

  const value: ProjectContextType = {
    projects,
    loadProjects,
    selectedProject,
    loadProject,
    loading,
    error,
    setError,
    config,
    isConfigured,
    generationState,
    setGenerationState,
    generatingOutline,
    connected,
    logs,
    clearLogs,
    eventsEnabled,
    toggleEvents,
    isMobile,
    sidebarOpen,
    activityPanelOpen,
    toggleSidebar,
    toggleActivityPanel,
    activeTab: tab,
    handleSelectProject,
    handleTabChange,
    showSettingsDialog,
    setShowSettingsDialog,
    showNewProjectDialog,
    setShowNewProjectDialog,
    handleCreateProject,
    handleDeleteProject,
    handleRefresh,
    handleGenerateOutline,
    handleGenerateChapters,
    handleResetProject,
    handleViewChapter,
    handleDeleteChapter,
    handleBatchDeleteChapters,
    handleDownloadBook,
    handleGenerateBible,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}
