import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
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
  cancelAllActiveTasks,
  cancelTaskById,
  getActiveTask,
  type ProjectSummary,
  type ProjectDetail,
  type GenerationTask,
} from '@/lib/api';
import { addTaskToHistory } from '@/lib/taskHistory';

// Constants
const MOBILE_BREAKPOINT = 1024;

interface ProjectContextType {
  // Projects list
  projects: ProjectSummary[];
  loadProjects: () => Promise<void>;
  
  // Selected project
  selectedProject: ProjectDetail | null;
  loadProject: (projectRef: string) => Promise<void>;
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
  handleSelectProject: (projectId: string) => void;
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
  handleCancelGeneration: (projectNameOverride?: string) => Promise<void>;
  cancelingGeneration: boolean;
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
  const { projectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Derive active tab from URL pathname
  const tab = useMemo(() => {
    const pathParts = location.pathname.split('/');
    // URL pattern: /project/:projectId/:tab
    // pathParts: ['', 'project', 'projectId', 'tab', ...]
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
  const loadProjectRequestIdRef = useRef(0);

  // AI Config
  const { config, isConfigured } = useAIConfig();

  // Generation state
  const { generationState, setGenerationState, startGeneration, completeGeneration } = useGeneration();
  const [generatingOutline, setGeneratingOutline] = useState(false);
  const [cancelingGeneration, setCancelingGeneration] = useState(false);
  const streamMonitorAbortRef = useRef<AbortController | null>(null);
  const streamMonitorTaskIdRef = useRef<number | null>(null);

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
  const loadProject = useCallback(async (projectRef: string) => {
    const requestId = ++loadProjectRequestIdRef.current;
    try {
      setLoading(true);
      setError(null);
      const data = await fetchProject(projectRef);
      if (requestId !== loadProjectRequestIdRef.current) return;
      setSelectedProject(data);
    } catch (err) {
      if (requestId !== loadProjectRequestIdRef.current) return;
      setSelectedProject(null);
      setError((err as Error).message);
    } finally {
      if (requestId === loadProjectRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const stopStreamMonitor = useCallback(() => {
    if (streamMonitorAbortRef.current) {
      streamMonitorAbortRef.current.abort();
      streamMonitorAbortRef.current = null;
    }
    streamMonitorTaskIdRef.current = null;
  }, []);

  const startStreamMonitor = useCallback((project: ProjectDetail, task: GenerationTask) => {
    if (task.status !== 'running') return;
    if (streamMonitorTaskIdRef.current === task.id) return;

    stopStreamMonitor();
    const abortController = new AbortController();
    streamMonitorAbortRef.current = abortController;
    streamMonitorTaskIdRef.current = task.id;

    void generateChaptersWithProgress(
      project.id,
      task.targetCount,
      {
        onTaskCreated: (event) => {
          if (streamMonitorTaskIdRef.current !== task.id) return;
          if (typeof event.taskId !== 'number') return;
          streamMonitorTaskIdRef.current = event.taskId;
          setGenerationState((prev) => ({ ...prev, taskId: event.taskId }));
        },
        onTaskResumed: (event) => {
          if (streamMonitorTaskIdRef.current !== task.id) return;
          const completed = event.completedChapters?.length || task.completedChapters.length;
          const currentChapter = event.currentProgress || task.currentProgress || task.startChapter;
          setGenerationState((prev) => ({
            ...prev,
            isGenerating: true,
            taskId: typeof event.taskId === 'number' ? event.taskId : task.id,
            current: completed,
            total: event.targetCount || task.targetCount,
            currentChapter,
            status: 'generating',
            message: event.currentMessage || prev.message || `正在生成第 ${currentChapter} 章...`,
            projectName: project.name,
            startTime: prev.startTime || task.updatedAtMs || Date.now(),
          }));
        },
        onProgress: (event) => {
          if (streamMonitorTaskIdRef.current !== task.id) return;
          setGenerationState((prev) => ({
            ...prev,
            isGenerating: true,
            taskId: task.id,
            current: Math.max(prev.current, event.current ?? prev.current),
            total: event.total ?? prev.total,
            currentChapter: event.chapterIndex ?? prev.currentChapter,
            status: event.status as 'generating' | 'saving' | 'done' | 'error' | 'preparing',
            message: event.message || prev.message,
            projectName: project.name,
            startTime: prev.startTime || task.updatedAtMs || Date.now(),
          }));
        },
        onChapterComplete: (chapterIndex, title) => {
          if (streamMonitorTaskIdRef.current !== task.id) return;
          setSelectedProject((prev) => {
            if (!prev || prev.id !== project.id) return prev;
            const chapterFile = `${chapterIndex.toString().padStart(3, '0')}.md`;
            const chapterExists = prev.chapters.includes(chapterFile);
            const nextChapterIndex = Math.max(prev.state.nextChapterIndex, chapterIndex + 1);
            return {
              ...prev,
              state: {
                ...prev.state,
                nextChapterIndex,
              },
              chapters: chapterExists
                ? prev.chapters
                : [...prev.chapters, chapterFile].sort((a, b) => Number(a.replace('.md', '')) - Number(b.replace('.md', ''))),
            };
          });
          setGenerationState((prev) => ({
            ...prev,
            currentChapterTitle: title,
            current: Math.max(prev.current, Math.min(prev.total || task.targetCount, prev.current + 1)),
          }));
        },
        onDone: (results, failedChapters) => {
          if (streamMonitorTaskIdRef.current === task.id) {
            streamMonitorAbortRef.current = null;
            streamMonitorTaskIdRef.current = null;
          }
          completeGeneration();
          addTaskToHistory({
            type: 'chapters',
            title: `${project.name}: 后台任务完成`,
            status: failedChapters?.length ? 'error' : 'success',
            startTime: Date.now(),
            endTime: Date.now(),
            details: `生成 ${results.length} 章${failedChapters?.length ? `，失败 ${failedChapters.length} 章` : ''}`,
          });
          void loadProject(project.id);
        },
        onError: (error) => {
          if (streamMonitorTaskIdRef.current === task.id) {
            streamMonitorAbortRef.current = null;
            streamMonitorTaskIdRef.current = null;
          }
          const cancelled = error.includes('取消');
          if (cancelled) {
            setGenerationState((prev) => ({
              ...prev,
              isGenerating: false,
              status: 'done',
              message: '任务已取消',
            }));
            addTaskToHistory({
              type: 'chapters',
              title: `${project.name}: 任务已取消`,
              status: 'cancelled',
              startTime: Date.now(),
              endTime: Date.now(),
              details: error,
            });
            return;
          }
          setGenerationState((prev) => ({
            ...prev,
            isGenerating: false,
            status: 'error',
            message: error,
          }));
          setError(error);
        },
        onReconnecting: (attempt, maxAttempts) => {
          if (streamMonitorTaskIdRef.current !== task.id) return;
          setGenerationState((prev) => ({
            ...prev,
            isGenerating: true,
            status: 'preparing',
            message: `网络重连中（${attempt}/${maxAttempts}）...`,
          }));
        },
      },
      undefined,
      abortController.signal,
      { maxRetries: 8, retryDelayMs: 1500 },
    ).catch((err) => {
      if (abortController.signal.aborted) return;
      if (streamMonitorTaskIdRef.current === task.id) {
        streamMonitorAbortRef.current = null;
        streamMonitorTaskIdRef.current = null;
      }
      setGenerationState((prev) => ({
        ...prev,
        isGenerating: false,
        status: 'error',
        message: (err as Error).message,
      }));
      setError((err as Error).message);
    });
  }, [completeGeneration, loadProject, setGenerationState, stopStreamMonitor]);

  // Initial load
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Bootstrap generation state once per selected project.
  // After bootstrap, attach generate-stream monitor for durable progress sync.
  useEffect(() => {
    if (!selectedProject?.id || !selectedProject?.name) return;
    let disposed = false;

    const bootstrapActiveTask = async () => {
      try {
        const task = await getActiveTask(selectedProject.id);
        if (disposed) return;

        if (!task || task.cancelRequested || task.status !== 'running') {
          stopStreamMonitor();
          setGenerationState((prev) => {
            if (!prev.isGenerating || prev.projectName !== selectedProject.name) return prev;
            return {
              ...prev,
              isGenerating: false,
              taskId: undefined,
              status: prev.status === 'error' ? 'error' : 'done',
              message: prev.message || '任务已结束',
            };
          });
          return;
        }

        const completedCount = task.completedChapters.length;
        const currentChapter = task.currentProgress || task.startChapter;

        setGenerationState({
          isGenerating: true,
          taskId: task.id,
          current: completedCount,
          total: task.targetCount,
          currentChapter,
          status: 'generating',
          message: task.currentMessage || `正在生成第 ${currentChapter} 章...`,
          projectName: task.projectName,
          startTime: task.createdAt ? new Date(`${task.createdAt}Z`).getTime() : (task.updatedAtMs || Date.now()),
        });
        startStreamMonitor(selectedProject, task);
      } catch (err) {
        console.warn('Failed to bootstrap active task:', err);
      }
    };

    void bootstrapActiveTask();

    return () => {
      disposed = true;
      stopStreamMonitor();
    };
  }, [setGenerationState, selectedProject?.id, selectedProject?.name, startStreamMonitor, stopStreamMonitor]);

  // Load project when URL changes
  useEffect(() => {
    if (projectId) {
      setSelectedProject(null);
      void loadProject(projectId);
    } else {
      loadProjectRequestIdRef.current += 1;
      setSelectedProject(null);
      setLoading(false);
    }
  }, [projectId, loadProject]);

  // Normalize URL to canonical project id route.
  useEffect(() => {
    if (!projectId || !selectedProject?.id) return;
    if (projectId === selectedProject.id) return;
    navigate(`/project/${encodeURIComponent(selectedProject.id)}/${tab}`, { replace: true });
  }, [projectId, selectedProject?.id, tab, navigate]);

  // Sync SSE progress to GenerationContext
  useEffect(() => {
    if (!generationProgress) return;
    
    if (generationProgress.status === 'done' || generationProgress.status === 'error') {
      setGenerationState(prev => {
        if (prev.projectName && prev.projectName !== generationProgress.projectName) {
          return prev;
        }
        return {
          ...prev,
          isGenerating: false,
          taskId: generationProgress.status === 'done' ? undefined : prev.taskId,
          status: generationProgress.status === 'done' ? 'done' : 'error',
          message: generationProgress.message || (generationProgress.status === 'done' ? '生成完成' : '生成失败'),
        };
      });
      return;
    }
    
    setGenerationState(prev => ({
      ...prev,
      isGenerating: true,
      taskId: prev.taskId,
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
      loadProject(selectedProject.id);
    }
  }, [generationProgress?.status, generationProgress?.projectName, selectedProject?.id, selectedProject?.name, loadProject]);

  // Navigation helpers
  const handleSelectProject = useCallback((targetProjectId: string) => {
    navigate(`/project/${encodeURIComponent(targetProjectId)}/dashboard`);
  }, [navigate]);

  const handleTabChange = useCallback((newTab: string) => {
    const targetProjectId = projectId || selectedProject?.id;
    if (targetProjectId) {
      navigate(`/project/${encodeURIComponent(targetProjectId)}/${newTab}`);
    }
  }, [navigate, projectId, selectedProject?.id]);

  // Project handlers
  const handleCreateProject = useCallback(async (name: string, bible: string, chapters: string) => {
    const trimmedName = name.trim();
    const trimmedBible = bible.trim();
    const totalChapters = Number.parseInt(chapters, 10);

    if (!trimmedName) {
      setError('请输入项目名称');
      throw new Error('invalid_project_name');
    }
    if (!trimmedBible) {
      setError('请输入小说设定（Bible）');
      throw new Error('invalid_project_bible');
    }
    if (!Number.isInteger(totalChapters) || totalChapters <= 0) {
      setError('目标章节数必须是大于 0 的整数');
      throw new Error('invalid_project_chapters');
    }
    
    setLoading(true);
    try {
      const created = await createProject(trimmedName, trimmedBible, totalChapters);
      setShowNewProjectDialog(false);
      await loadProjects();
      navigate(`/project/${encodeURIComponent(created.id)}/dashboard`);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [loadProjects, navigate]);

  const handleDeleteProject = useCallback(async () => {
    if (!selectedProject) return;
    if (!confirm(`确定要删除项目 "${selectedProject.name}" 吗？此操作不可恢复。`)) return;
    
    setLoading(true);
    try {
      await deleteProject(selectedProject.id);
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
      await loadProject(selectedProject.id);
    }
  }, [loadProjects, loadProject, selectedProject]);

  // Generation handlers
  const handleGenerateOutline = useCallback(async (chapters: string, wordCount: string, customPrompt: string) => {
    if (!selectedProject || !isConfigured) return;
    const targetChapters = Number.parseInt(chapters, 10);
    const targetWordCount = Number.parseInt(wordCount, 10);
    if (!Number.isInteger(targetChapters) || targetChapters <= 0) {
      setError('目标章节数必须是大于 0 的整数');
      return;
    }
    if (!Number.isInteger(targetWordCount) || targetWordCount <= 0) {
      setError('目标字数必须是大于 0 的整数');
      return;
    }
    
    setGeneratingOutline(true);
    try {
      await generateOutline(selectedProject.id, targetChapters, targetWordCount, customPrompt);
      await loadProject(selectedProject.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingOutline(false);
    }
  }, [selectedProject, isConfigured, loadProject]);

  const handleGenerateChapters = useCallback(async (count: string) => {
    if (!selectedProject || !isConfigured) return;
    
    const requestedCount = Number.parseInt(count, 10);
    if (!Number.isInteger(requestedCount) || requestedCount <= 0) {
      setError('生成章数必须是大于 0 的整数');
      return;
    }
    if (generationState.isGenerating && generationState.projectName === selectedProject.name) {
      setError('该项目已有章节生成任务在进行中');
      return;
    }
    const generated = Math.max(0, selectedProject.state.nextChapterIndex - 1);
    const remaining = Math.max(0, selectedProject.state.totalChapters - generated);
    if (remaining <= 0) {
      setError('已达到目标章节数，无需继续生成');
      return;
    }
    const chapterCount = Math.min(requestedCount, remaining);
    if (chapterCount < requestedCount) {
      setError(`仅剩 ${remaining} 章可生成，已自动按 ${remaining} 章执行`);
    }

    const startChapter = selectedProject.state.nextChapterIndex;
    
    setLoading(true);
    stopStreamMonitor();
    startGeneration(selectedProject.name, chapterCount);
    
    try {
      await generateChaptersWithProgress(
        selectedProject.id,
        chapterCount,
        {
          onStart: (total: number) => {
            setGenerationState(prev => ({ ...prev, total }));
          },
          onTaskCreated: (event) => {
            if (typeof event.taskId !== 'number') return;
            setGenerationState(prev => ({ ...prev, taskId: event.taskId }));
          },
          onTaskResumed: (event) => {
            const completed = event.completedChapters?.length || 0;
            setGenerationState(prev => ({
              ...prev,
              taskId: typeof event.taskId === 'number' ? event.taskId : prev.taskId,
              current: completed,
              total: event.targetCount || prev.total,
              currentChapter: event.currentProgress ?? prev.currentChapter,
              status: 'generating',
              message: event.currentMessage || prev.message,
            }));
          },
          onProgress: (event) => {
            setGenerationState(prev => ({
              ...prev,
              taskId: typeof event.taskId === 'number' ? event.taskId : prev.taskId,
              current: event.current ?? prev.current,
              total: event.total ?? prev.total,
              currentChapter: event.chapterIndex,
              currentChapterTitle: event.title,
              status: event.status as 'generating' | 'saving' | 'done' | 'error' | 'preparing',
              message: event.message,
            }));
          },
          onChapterComplete: (chapterIndex: number, title: string) => {
            setSelectedProject(prev => {
              if (!prev || prev.id !== selectedProject.id) return prev;
              const chapterFile = `${chapterIndex.toString().padStart(3, '0')}.md`;
              const chapterExists = prev.chapters.includes(chapterFile);
              const nextChapterIndex = Math.max(prev.state.nextChapterIndex, chapterIndex + 1);
              return {
                ...prev,
                state: {
                  ...prev.state,
                  nextChapterIndex,
                },
                chapters: chapterExists
                  ? prev.chapters
                  : [...prev.chapters, chapterFile].sort((a, b) => Number(a.replace('.md', '')) - Number(b.replace('.md', ''))),
              };
            });
            setGenerationState(prev => ({
              ...prev,
              currentChapterTitle: title,
            }));
          },
          onChapterError: (chapterIndex: number, error: string) => {
            console.error(`Chapter ${chapterIndex} error:`, error);
          },
          onDone: (results, failedChapters) => {
            completeGeneration();
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
            const cancelled = error.includes('取消');
            if (cancelled) {
              setGenerationState(prev => ({
                ...prev,
                isGenerating: false,
                taskId: undefined,
                status: 'done',
                message: '任务已取消',
              }));
              addTaskToHistory({
                type: 'chapters',
                title: `${selectedProject.name}: 任务已取消`,
                status: 'cancelled',
                startTime: generationState.startTime || Date.now(),
                endTime: Date.now(),
                details: error,
              });
              return;
            }
            setGenerationState(prev => ({
              ...prev,
              isGenerating: false,
              taskId: undefined,
              status: 'error',
              message: error,
            }));
            setError(error);
            addTaskToHistory({
              type: 'chapters',
              title: `${selectedProject.name}: 任务失败`,
              status: 'error',
              startTime: generationState.startTime || Date.now(),
              endTime: Date.now(),
              details: error,
            });
          },
        },
      );
      await loadProject(selectedProject.id);
    } catch (err) {
      setGenerationState(prev => ({
        ...prev,
        isGenerating: false,
        taskId: undefined,
        status: 'error',
        message: (err as Error).message,
      }));
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, isConfigured, startGeneration, completeGeneration, setGenerationState, loadProject, generationState.startTime, generationState.isGenerating, generationState.projectName, stopStreamMonitor]);

  const handleCancelGeneration = useCallback(async (projectNameOverride?: string) => {
    const targetProjectName = projectNameOverride || selectedProject?.name || generationState.projectName;
    if (!targetProjectName) return;

    setCancelingGeneration(true);
    try {
      const targetProjectRef = selectedProject?.id || targetProjectName;
      let cancelled = false;

      if (typeof generationState.taskId === 'number') {
        await cancelTaskById(generationState.taskId);
        cancelled = true;
      } else {
        const activeTask = await getActiveTask(targetProjectRef);
        if (activeTask?.id) {
          await cancelTaskById(activeTask.id);
          cancelled = true;
        }
      }

      if (!cancelled) {
        await cancelAllActiveTasks(targetProjectRef);
      }

      setGenerationState(prev => (
        prev.projectName === targetProjectName
          ? {
            ...prev,
            isGenerating: true,
            taskId: prev.taskId,
            status: 'preparing',
            message: '正在取消任务...',
          }
          : prev
      ));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancelingGeneration(false);
    }
  }, [selectedProject, generationState.projectName, generationState.taskId, setGenerationState]);

  const handleResetProject = useCallback(async () => {
    if (!selectedProject) return;
    
    setLoading(true);
    try {
      await resetProject(selectedProject.id);
      await loadProject(selectedProject.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedProject, loadProject]);

  // Chapter handlers
  const handleViewChapter = useCallback(async (index: number): Promise<string> => {
    if (!selectedProject) return '';
    return await fetchChapter(selectedProject.id, index);
  }, [selectedProject]);

  const handleDeleteChapter = useCallback(async (index: number): Promise<void> => {
    if (!selectedProject) return;
    try {
      await deleteChapter(selectedProject.id, index);
      await loadProject(selectedProject.id);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }, [selectedProject, loadProject]);

  const handleBatchDeleteChapters = useCallback(async (indices: number[]): Promise<void> => {
    if (!selectedProject) return;
    try {
      await batchDeleteChapters(selectedProject.id, indices);
      await loadProject(selectedProject.id);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }, [selectedProject, loadProject]);

  const handleDownloadBook = useCallback(async () => {
    if (!selectedProject) return;
    
    try {
      const url = `/api/projects/${encodeURIComponent(selectedProject.id)}/download`;
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
      await loadProject(selectedProject.id);
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
    handleCancelGeneration,
    cancelingGeneration,
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
