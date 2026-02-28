import { useState, useEffect, useMemo } from 'react';
import { Activity, X, ChevronDown, ChevronUp, Check, Loader2, AlertCircle, Sparkles, BookOpen, FileText, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGeneration, type ActiveTask, type TaskType } from '@/contexts/GenerationContext';
import { cancelAllActiveTasks, cancelTaskById, getAllActiveTasks, getTaskHistory, type GenerationTask } from '@/lib/api';
import {
  TASK_HISTORY_EVENT_NAME,
  getTaskHistorySnapshot,
  type TaskHistoryItem,
} from '@/lib/taskHistory';
import { useServerEventsContext } from '@/contexts/ServerEventsContext';

// Task type icons and labels
const TASK_CONFIG: Record<TaskType, { icon: React.ReactNode; label: string }> = {
  chapters: { icon: <BookOpen className="w-4 h-4" />, label: '章节生成' },
  outline: { icon: <FileText className="w-4 h-4" />, label: '大纲生成' },
  bible: { icon: <Sparkles className="w-4 h-4" />, label: 'Story Bible' },
  other: { icon: <Activity className="w-4 h-4" />, label: '任务' },
};

export function FloatingProgressButton() {
  const { generationState, activeTasks } = useGeneration();
  const { taskUpdateCounter } = useServerEventsContext();
  const [isOpen, setIsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [serverHistory, setServerHistory] = useState<GenerationTask[]>([]);
  const [cancelingTaskId, setCancelingTaskId] = useState<string | null>(null);
  const [serverTasks, setServerTasks] = useState<ActiveTask[]>([]);

  // Map server task to ActiveTask structure
  const mapServerTask = (task: GenerationTask): ActiveTask => {
    const type = (task.taskType || 'chapters') as TaskType;
    const completedCount = Array.isArray(task.completedChapters) ? task.completedChapters.length : 0;
    const current = type === 'chapters'
      ? Math.max(0, completedCount)
      : Math.max(0, task.currentProgress || 0);
    const total = task.targetCount > 0 ? task.targetCount : undefined;
    const numericTaskId = typeof task.id === 'number' ? task.id : undefined;
    const fallbackTitle = task.projectName
      ? `${task.projectName}: ${type === 'outline' ? '大纲生成中...' : '任务执行中...'}`
      : '任务执行中...';

    // Map server status to ActiveTask status
    let status: ActiveTask['status'] = 'generating';
    if (task.status === 'paused') status = 'preparing';
    else if (task.status === 'completed') status = 'done';
    else if (task.status === 'failed') status = 'error';

    return {
      id: `server-${task.id}`,
      taskId: numericTaskId,
      type,
      title: task.currentMessage || fallbackTitle,
      status,
      current,
      total,
      startTime: task.createdAt || task.updatedAtMs || Date.now(),
      projectName: task.projectName,
      startChapter: task.startChapter,
      message: task.currentMessage || undefined,
    };
  };

  // Listen for history updates
  useEffect(() => {
    const handler = () => setHistory(getTaskHistorySnapshot());
    handler();
    window.addEventListener(TASK_HISTORY_EVENT_NAME, handler);
    return () => window.removeEventListener(TASK_HISTORY_EVENT_NAME, handler);
  }, []);

  // Fetch server history when history panel is opened
  useEffect(() => {
    if (showHistory && isOpen) {
      void getTaskHistory().then(setServerHistory).catch(() => {});
    }
  }, [showHistory, isOpen]);

  // 通过 SSE 信号驱动拉取任务列表（替代轮询）
  // taskUpdateCounter 变化时（后端推送 task_update 事件）或首次 mount 时拉取
  useEffect(() => {
    let disposed = false;

    const sync = async () => {
      try {
        const tasks = await getAllActiveTasks();
        if (disposed) return;
        setServerTasks(tasks.map(mapServerTask));
      } catch {
        if (disposed) return;
        // 网络/认证失败时保留上一次快照
      }
    };

    void sync();

    return () => {
      disposed = true;
    };
  }, [taskUpdateCounter]);

  const allTasks = useMemo(() => {
    const merged: ActiveTask[] = [
      ...serverTasks,
      ...activeTasks,
      ...(generationState.isGenerating ? [{
        id: 'legacy-chapters',
        type: 'chapters' as TaskType,
        title: generationState.message || '生成章节中...',
        status: generationState.status || 'generating',
        current: generationState.current,
        total: generationState.total,
        startTime: generationState.startTime ?? 0,
        projectName: generationState.projectName,
        taskId: generationState.taskId,
      }] : []),
    ];

    const seen = new Set<string>();
    return merged.filter((task) => {
      const key = typeof task.taskId === 'number' ? `task-${task.taskId}` : `id-${task.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [serverTasks, activeTasks, generationState]);

  const hasActiveTasks = allTasks.length > 0;

  const handleCancelTask = async (task: ActiveTask) => {
    if (cancelingTaskId) return;
    setCancelingTaskId(task.id);
    try {
      if (typeof task.taskId === 'number') {
        await cancelTaskById(task.taskId);
      } else if (task.projectName) {
        await cancelAllActiveTasks(task.projectName);
      }
    } catch (error) {
      console.error('Failed to cancel generation task:', error);
    } finally {
      setCancelingTaskId(null);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg",
          "flex items-center justify-center transition-all duration-300",
          "hover:scale-110 active:scale-95",
          hasActiveTasks
            ? "bg-primary text-primary-foreground"
            : "bg-card border border-border text-muted-foreground hover:text-foreground"
        )}
      >
        {hasActiveTasks ? (
          <div className="relative">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 text-[10px] rounded-full flex items-center justify-center text-white font-bold">
              {allTasks.length}
            </span>
          </div>
        ) : (
          <Activity className="w-6 h-6" />
        )}
      </button>

      {/* Progress Panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-80 max-h-[70vh] rounded-xl shadow-2xl border border-border bg-card overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              任务管理
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-muted rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Current Tasks */}
          <div className="p-3 border-b border-border">
            <div className="text-xs text-muted-foreground mb-2">
              当前任务 ({allTasks.length})
            </div>
            {allTasks.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                暂无进行中的任务
              </div>
            ) : (
              <div className="space-y-2">
                {allTasks.map(task => {
                  const config = TASK_CONFIG[task.type];
                  const progressPercent = task.total && task.total > 0
                    ? Math.min(100, Math.max(0, Math.round((Math.max(0, task.current || 0) / task.total) * 100)))
                    : null;

                  return (
                    <div key={task.id} className="bg-muted/50 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 text-primary shrink-0 animate-pulse">
                          {config.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{task.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {config.label}
                            {task.projectName && ` · ${task.projectName}`}
                            {task.startChapter && ` · 第 ${task.startChapter} 章起`}
                            {progressPercent !== null && ` · ${progressPercent}%`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          {(task.status === 'generating' || task.status === 'preparing') && (
                            <button
                              onClick={() => { void handleCancelTask(task); }}
                              disabled={cancelingTaskId === task.id}
                              className="p-1 rounded hover:bg-destructive/20 text-destructive disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                              title="取消任务"
                            >
                              {cancelingTaskId === task.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Square className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Progress bar for tasks with progress */}
                      {progressPercent !== null && (
                        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all duration-300"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      )}
                      {/* Indeterminate progress for tasks without specific progress */}
                      {progressPercent === null && (
                        <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden relative">
                          <div
                            className="absolute h-full w-1/3 bg-primary rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite]"
                            style={{
                              animation: 'indeterminate 1.5s ease-in-out infinite',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* History Section */}
          <div className="max-h-[40vh] overflow-y-auto">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-3 py-2 flex items-center justify-between text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              <span>历史记录</span>
              {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showHistory && (
              <div className="px-3 pb-3 space-y-2">
                {serverHistory.length === 0 && history.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2 text-center">
                    暂无历史记录
                  </div>
                ) : (
                  <>
                    {/* Local History (Deprecated/Transient) */}
                    {history.map(item => (
                      <div key={item.id} className="flex items-start gap-2 py-2 border-b border-border/50 last:border-0">
                        {item.status === 'success' ? (
                          <Check className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate" title={item.title}>{item.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(item.startTime).toLocaleTimeString()}
                            {item.details && ` · ${item.details}`}
                          </p>
                        </div>
                      </div>
                    ))}
                    {/* Server History */}
                    {serverHistory.map(task => {
                      const isSuccess = task.status === 'completed';
                      const taskTitle = task.projectName || '未命名任务';
                      const subInfo = task.taskType === 'chapters'
                        ? `已完成 ${task.completedChapters.length}/${task.targetCount} 章`
                        : task.currentMessage || '任务已结束';

                      return (
                        <div key={`hist-${task.id}`} className="flex items-start gap-2 py-2 border-b border-border/50 last:border-0">
                          {isSuccess ? (
                            <Check className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate" title={taskTitle}>{taskTitle}</p>
                            <p className="text-xs text-muted-foreground truncate" title={subInfo}>
                              {new Date(task.createdAt || 0).toLocaleDateString()}
                              {' · '}
                              {subInfo}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CSS for indeterminate animation */}
      <style>{`
        @keyframes indeterminate {
          0% { left: -33%; }
          100% { left: 100%; }
        }
      `}</style>
    </>
  );
}
