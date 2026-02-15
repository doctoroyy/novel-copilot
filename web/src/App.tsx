import { useState, useEffect, useCallback, useRef } from 'react';
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
  generateChaptersWithProgress,
  fetchChapter,
  deleteProject,
  resetProject,
  generateBible,
  deleteChapter,
  batchDeleteChapters,
  getActiveTask,
  getAllActiveTasks,
  cancelAllActiveTasks,
  type ProjectSummary,
  type ProjectDetail,
  type GenerationTask,
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
import { FloatingProgressButton } from '@/components/FloatingProgressButton';
import { addTaskToHistory } from '@/lib/taskHistory';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';
import { useGeneration } from '@/contexts/GenerationContext';
import { Toaster } from "@/components/ui/toaster";

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
  const [generatingOutline, setGeneratingOutline] = useState(false);

  // Active task recovery state
  const [activeTask, setActiveTask] = useState<GenerationTask | null>(null);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  // Generation progress state from context (persists across tab changes)
  const { generationState, setGenerationState, startTask, completeTask } = useGeneration();

  // Mobile state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileActivityPanelOpen, setMobileActivityPanelOpen] = useState(false);
  
  // Desktop state (default open)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [desktopActivityPanelOpen, setDesktopActivityPanelOpen] = useState(false);

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
    // Guard for SSR environments
    if (typeof window === 'undefined') return;

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

  // Sync SSE progress to GenerationContext for FloatingProgressButton
  useEffect(() => {
    if (!generationProgress) return;
    
    // Only update if there's actual progress data
    if (generationProgress.status === 'done' || generationProgress.status === 'error') {
      // Task completed or failed - reset after a brief delay
      setGenerationState(prev => ({
        ...prev,
        isGenerating: false,
        status: generationProgress.status === 'done' ? 'done' : 'error',
        message: generationProgress.message || (generationProgress.status === 'done' ? '生成完成' : '生成失败'),
      }));
      return;
    }
    
    // Active generation progress
    setGenerationState(prev => ({
      ...prev,
      isGenerating: true,
      current: generationProgress.current,
      total: generationProgress.total,
      currentChapter: generationProgress.chapterIndex,
      currentChapterTitle: generationProgress.chapterTitle,
      status: generationProgress.status as any,
      message: generationProgress.message || `正在生成第 ${generationProgress.chapterIndex} 章...`,
      projectName: generationProgress.projectName,
      startTime: prev.startTime || Date.now(),
    }));
  }, [generationProgress, setGenerationState]);


  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Global task check: Only run ONCE on mount to detect any running tasks
  // After initial check, progress updates come via SSE (/api/events)
  useEffect(() => {
    const checkActiveTasksOnce = async () => {
      try {
        const tasks = await getAllActiveTasks();
        
        // Find any running task and sync its progress to generationState
        const runningTask = tasks.find(t => t.status === 'running');
        if (runningTask) {
          // Check if task is healthy using Unix timestamp (3 minutes threshold)
          const threeMinutesMs = 3 * 60 * 1000;
          const isHealthy = runningTask.updatedAtMs && (Date.now() - runningTask.updatedAtMs < threeMinutesMs);
          
          if (!isHealthy) {
            // Task is stale - show as needing attention, not actively generating
            console.warn(`Task ${runningTask.id} appears stale (updatedAtMs: ${runningTask.updatedAtMs}, now: ${Date.now()}). Showing as paused.`);
            // Don't set isGenerating - let the project-level check handle showing resume dialog
            return;
          }
          
          const estimatedElapsedMs = runningTask.completedChapters.length * 60 * 1000;
          const estimatedStartTime = runningTask.updatedAtMs - estimatedElapsedMs;

          setGenerationState({
            isGenerating: true,
            current: runningTask.completedChapters.length,
            total: runningTask.targetCount,
            currentChapter: runningTask.currentProgress,
            status: 'generating',
            message: runningTask.currentMessage || `正在生成第 ${runningTask.currentProgress} 章...`,
            startTime: estimatedStartTime > 0 ? estimatedStartTime : Date.now(),
            projectName: runningTask.projectName,
          });
        }
      } catch (err) {
        console.warn('Failed to check active tasks:', err);
      }
    };

    checkActiveTasksOnce();
  }, [setGenerationState]);

  // Load project when URL changes
  useEffect(() => {
    if (projectName && projectName !== selectedProject?.name) {
      loadProject(projectName);
    } else if (!projectName) {
      setSelectedProject(null);
    }
  }, [projectName, selectedProject?.name, loadProject]);

  // Check for active generation tasks when project loads
  // For running tasks: sync progress once (real-time updates come via SSE)
  // For paused tasks: show resume dialog
  const checkedProjectRef = useRef<string | null>(null);


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
    let taskId: string | undefined;
    try {
      setGeneratingOutline(true);
      taskId = startTask('outline', `生成大纲: ${selectedProject.name}`, selectedProject.name);
      log(`生成大纲: ${selectedProject.name}`);
      const outline = await generateOutline(
        selectedProject.name,
        parseInt(outlineChapters, 10),
        parseInt(outlineWordCount, 10),
        outlineCustomPrompt || undefined,
        getAIConfigHeaders(aiConfig),
        (progressMsg) => log(`📝 ${progressMsg}`)
      );
      log(`✅ 大纲生成完成: ${outline.volumes.length} 卷, ${outline.totalChapters} 章`);
      if (taskId) completeTask(taskId, true, `${outline.volumes.length} 卷, ${outline.totalChapters} 章`);
      addTaskToHistory({
        type: 'outline',
        title: `大纲生成完成`,
        status: 'success',
        startTime: Date.now(),
        details: `${outline.volumes.length} 卷, ${outline.totalChapters} 章`,
      });
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
      log(`❌ 生成失败: ${(err as Error).message}`);
      if (taskId) completeTask(taskId, false, (err as Error).message);
      addTaskToHistory({
        type: 'outline',
        title: `大纲生成失败`,
        status: 'error',
        startTime: Date.now(),
        details: (err as Error).message,
      });
    } finally {
      setGeneratingOutline(false);
    }
  };

  const handleGenerateChapters = useCallback(async (options?: { resumeTask?: GenerationTask; count?: number }) => {
    if (!selectedProject) return;
    if (!isConfigured) {
      setError('请先在设置中配置 AI API Key');
      setShowSettingsDialog(true);
      return;
    }
    
    const resumeTask = options?.resumeTask;
    
    // Prevent concurrent generation for the SAME project (serial enforcement)
    // Only check if NOT resuming (resuming means we want to attach to the existing one)
    if (!resumeTask && generationState.isGenerating && generationState.projectName === selectedProject.name) {
      setError('该小说已有生成任务正在进行中，请等待完成后再试');
      return;
    }
    try {
      setLoading(true);
      const count = options?.count ?? (resumeTask ? resumeTask.targetCount : parseInt(generateCount, 10));
      const startTime = Date.now();
      log(resumeTask ? `恢复任务: ${selectedProject.name}, 目标 ${count} 章` : `生成章节: ${selectedProject.name}, ${count} 章`);
      
      // Initialize generation state - simple start, detailed state will come from events
      setGenerationState({
        isGenerating: true,
        current: 0,
        total: count,
        status: 'preparing',
        message: '准备生成章节...',
        startTime,
        projectName: selectedProject.name,
      });
      
      await generateChaptersWithProgress(
        selectedProject.name,
        count,
        {
          onStart: (total) => {
            log(`📝 开始生成 ${total} 章...`);
            setGenerationState(prev => ({ ...prev, current: 0, total, status: 'generating' }));
          },
          onTaskResumed: (event: any) => {
             const completed = event.completedChapters?.length || 0;
             const total = event.targetCount || count;
             log(`🔄 恢复任务: 已完成 ${completed}/${total} 章`);
             setGenerationState(prev => ({
               ...prev,
               current: completed,
               total: total,
               currentChapter: event.currentProgress || 0,
               status: 'generating',
               message: event.currentMessage || `恢复生成...`,
             }));
          },
          onProgress: (event) => {
            if (event.message) log(`📝 ${event.message}`);
            setGenerationState(prev => ({
              ...prev,
              // Don't update current here - only update in onChapterComplete
              // Backend sends current=1 when starting first chapter, which would show 20% before any chapter is done
              currentChapter: event.chapterIndex,
              status: (event.status as 'preparing' | 'generating' | 'saving') || prev.status,
              message: event.message,
            }));
          },
          onChapterComplete: (chapterIndex, title) => {
            log(`✅ 第 ${chapterIndex} 章「${title}」完成`);
            setGenerationState(prev => ({
              ...prev,
              current: prev.current + 1,
              currentChapterTitle: title,
              status: 'generating',
              message: `完成第 ${chapterIndex} 章: ${title}`,
            }));
            // Optimistically update project state for immediate UI feedback
            setSelectedProject(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                state: {
                  ...prev.state,
                  nextChapterIndex: Math.max(prev.state.nextChapterIndex, chapterIndex + 1),
                },
                chapters: [...prev.chapters, title],
              };
            });
          },
          onChapterError: (chapterIndex, error) => {
            log(`❌ 第 ${chapterIndex} 章失败: ${error}`);
            setGenerationState(prev => ({
              ...prev,
              status: 'error',
              message: `第 ${chapterIndex} 章失败: ${error}`,
            }));
          },
          onDone: (results, failedChapters) => {
            log(`🎉 完成! 成功 ${results.length} 章, 失败 ${failedChapters.length} 章`);
            setGenerationState(prev => ({
              ...prev,
              isGenerating: false,
              status: 'done',
              message: `完成! 成功 ${results.length} 章`,
            }));
            // Track in history
            addTaskToHistory({
              type: 'chapters',
              title: `生成 ${results.length} 章完成`,
              status: 'success',
              startTime: generationState.startTime || Date.now(),
              endTime: Date.now(),
              details: selectedProject?.name,
            });
          },
          onError: (error) => {
            log(`❌ 生成失败: ${error}`);
            setGenerationState(prev => ({
              ...prev,
              isGenerating: false,
              status: 'error',
              message: error,
            }));
            // Track in history
            addTaskToHistory({
              type: 'chapters',
              title: `章节生成失败`,
              status: 'error',
              startTime: generationState.startTime || Date.now(),
              endTime: Date.now(),
              details: error,
            });
          },
        },
        getAIConfigHeaders(aiConfig)
      );
      
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
      log(`❌ 生成失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
      // Reset generation state after a brief delay to show completion
      setTimeout(() => {
        setGenerationState({
          isGenerating: false,
          current: 0,
          total: 0,
        });
      }, 2000);
    }
  }, [selectedProject, isConfigured, generationState, generateCount, aiConfig, loadProject, setGenerationState, log]);

  // Check for active generation tasks when project loads
  // For running tasks: actively resume stream
  // For paused tasks: show resume dialog
  useEffect(() => {
    if (!selectedProject) return;
    // Avoid duplicate checks for the same project
    if (checkedProjectRef.current === selectedProject.name) return;
    checkedProjectRef.current = selectedProject.name;
    
    const checkActiveTask = async () => {
      try {
        const task = await getActiveTask(selectedProject.name);
        if (!task) {
          setActiveTask(null);
          return;
        }
        
        setActiveTask(task);
        
        if (task.status === 'running') {
          // Check if task is healthy (3 min threshold)
          const threeMinutesMs = 3 * 60 * 1000;
          const isHealthy = task.updatedAtMs && (Date.now() - task.updatedAtMs < threeMinutesMs);
          
          if (isHealthy) {
            // Task is healthy - actively resume stream!
            // This ensures we get real-time updates even after refresh
            handleGenerateChapters({ resumeTask: task });
          } else {
            // Task is stale (likely crashed) - show resume dialog
            setShowResumeDialog(true);
          }
        } else if (task.status === 'paused') {
          setShowResumeDialog(true);
        }
      } catch (err) {
        console.warn('Failed to check active task:', err);
      }
    };

    checkActiveTask();
  }, [selectedProject?.name, handleGenerateChapters, setGenerationState]);

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
    const startTime = Date.now();
    const taskId = startTask('bible', 'AI 正在想象 Story Bible...');
    try {
      log('🤖 AI 正在想象 Story Bible...');
      const bible = await generateBible(aiGenre, aiTheme, aiKeywords, getAIConfigHeaders(aiConfig));
      setNewProjectBible(bible);
      log('✅ Story Bible 生成完成');
      completeTask(taskId, true);
      addTaskToHistory({
        type: 'bible',
        title: 'Story Bible 生成完成',
        status: 'success',
        startTime,
        endTime: Date.now(),
      });
    } catch (err) {
      setError((err as Error).message);
      log(`❌ 生成失败: ${(err as Error).message}`);
      completeTask(taskId, false, (err as Error).message);
      addTaskToHistory({
        type: 'bible',
        title: 'Story Bible 生成失败',
        status: 'error',
        startTime,
        endTime: Date.now(),
        details: (err as Error).message,
      });
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
            generatingOutline={generatingOutline}
            generationState={generationState}
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
            onProjectRefresh={() => loadProject(selectedProject.name)}
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
      <Toaster />

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
            selectedProjectId={selectedProject?.id || selectedProject?.path || null}
            onSelectProject={(projectId) => {
              handleSelectProject(projectId);
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
              {/* Bible generation progress overlay */}
              {generatingBible ? (
                <div className="h-[200px] sm:h-[250px] max-h-[300px] bg-muted/50 rounded-md flex flex-col items-center justify-center gap-4 border border-dashed border-primary/30">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-4 border-primary/20 animate-pulse"></div>
                    <div className="absolute inset-0 w-16 h-16 rounded-full border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-2xl">🤖</div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-primary animate-pulse">AI 正在想象...</p>
                    <p className="text-xs text-muted-foreground mt-1">正在生成世界观、人物设定、主线目标</p>
                  </div>
                </div>
              ) : (
                <Textarea
                  placeholder="世界观、人物设定、主线目标..."
                  className="h-[200px] sm:h-[250px] max-h-[300px] font-mono text-xs sm:text-sm resize-none bg-muted/50"
                  value={newProjectBible}
                  onChange={(e) => setNewProjectBible(e.target.value)}
                />
              )}
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

      {/* Resume Task Dialog */}
      <Dialog open={showResumeDialog} onOpenChange={setShowResumeDialog}>
        <DialogContent className="glass-card">
          <DialogHeader>
            <DialogTitle className="gradient-text">📝 检测到未完成的任务</DialogTitle>
            <DialogDescription>
              发现之前的章节生成任务尚未完成，是否继续？
            </DialogDescription>
          </DialogHeader>
          {activeTask && (
            <div className="py-4 space-y-3 text-sm">
              {(() => {
                const completed = activeTask.completedChapters.length;
                const total = Math.max(1, activeTask.targetCount);
                const progressPercent = Math.min(100, Math.max(0, (completed / total) * 100));
                const remaining = Math.max(0, activeTask.targetCount - completed);
                return (
                  <>
                    {/* Progress bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>进度</span>
                        <span>{Math.round(progressPercent)}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded bg-muted/50">
                        <div className="text-lg font-semibold">{activeTask.targetCount}</div>
                        <div className="text-xs text-muted-foreground">目标</div>
                      </div>
                      <div className="p-2 rounded bg-green-500/10">
                        <div className="text-lg font-semibold text-green-500">{completed}</div>
                        <div className="text-xs text-muted-foreground">已完成</div>
                      </div>
                      <div className="p-2 rounded bg-amber-500/10">
                        <div className="text-lg font-semibold text-amber-500">{remaining}</div>
                        <div className="text-xs text-muted-foreground">剩余</div>
                      </div>
                    </div>
                  </>
                );
              })()}
              {activeTask.failedChapters.length > 0 && (
                <p className="text-destructive text-center">⚠️ 失败：{activeTask.failedChapters.length} 章</p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                if (activeTask && selectedProject) {
                  await cancelAllActiveTasks(selectedProject.name);
                  setActiveTask(null);
                }
                setShowResumeDialog(false);
              }}
            >
              放弃任务
            </Button>
            <Button
              className="gradient-bg"
              onClick={async () => {
                if (activeTask && selectedProject) {
                  const remaining = Math.max(0, activeTask.targetCount - activeTask.completedChapters.length);
                  setGenerateCount(String(remaining));
                  setShowResumeDialog(false);
                  // Clean up old tasks first
                  await cancelAllActiveTasks(selectedProject.name);
                  setActiveTask(null);
                  
                  // Navigate to generate tab first
                  navigate(`/project/${encodeURIComponent(selectedProject.name)}/generate`);
                  // Then trigger generation for remaining chapters
                  setTimeout(() => {
                    handleGenerateChapters({ count: remaining });
                  }, 100);
                }
              }}
              disabled={!activeTask || (activeTask.targetCount - activeTask.completedChapters.length) <= 0}
            >
              继续生成 (重新发起)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating Progress Button */}
      <FloatingProgressButton />
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
