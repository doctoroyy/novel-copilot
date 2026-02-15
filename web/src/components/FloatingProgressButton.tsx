import { useState, useEffect } from 'react';
import { Activity, X, ChevronDown, ChevronUp, Check, Loader2, AlertCircle, Sparkles, BookOpen, FileText, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGeneration, type ActiveTask, type TaskType } from '@/contexts/GenerationContext';
import { cancelAllActiveTasks } from '@/lib/api';
import {
  TASK_HISTORY_EVENT_NAME,
  getTaskHistorySnapshot,
  type TaskHistoryItem,
} from '@/lib/taskHistory';

// Task type icons and labels
const TASK_CONFIG: Record<TaskType, { icon: React.ReactNode; label: string }> = {
  chapters: { icon: <BookOpen className="w-4 h-4" />, label: '章节生成' },
  outline: { icon: <FileText className="w-4 h-4" />, label: '大纲生成' },
  bible: { icon: <Sparkles className="w-4 h-4" />, label: 'Story Bible' },
  other: { icon: <Activity className="w-4 h-4" />, label: '任务' },
};

export function FloatingProgressButton() {
  const { generationState, activeTasks } = useGeneration();
  const [isOpen, setIsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [cancelingProjectName, setCancelingProjectName] = useState<string | null>(null);

  // Listen for history updates
  useEffect(() => {
    const handler = () => setHistory(getTaskHistorySnapshot());
    handler();
    window.addEventListener(TASK_HISTORY_EVENT_NAME, handler);
    return () => window.removeEventListener(TASK_HISTORY_EVENT_NAME, handler);
  }, []);

  // Combine legacy generation state with new active tasks
  const allTasks: ActiveTask[] = [
    ...activeTasks,
    // Add legacy chapter generation if active
    ...(generationState.isGenerating ? [{
      id: 'legacy-chapters',
      type: 'chapters' as TaskType,
      title: generationState.message || '生成章节中...',
      status: generationState.status || 'generating',
      current: generationState.current,
      total: generationState.total,
      startTime: generationState.startTime ?? 0,
      projectName: generationState.projectName,
    }] : []),
  ];

  const hasActiveTasks = allTasks.length > 0;

  const handleCancelTask = async (projectName?: string) => {
    if (!projectName || cancelingProjectName) return;
    setCancelingProjectName(projectName);
    try {
      await cancelAllActiveTasks(projectName);
    } catch (error) {
      console.error('Failed to cancel generation task:', error);
    } finally {
      setCancelingProjectName(null);
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
                    ? Math.min(100, Math.max(0, Math.round((Math.max(0, (task.current || 0) - 1) / task.total) * 100)))
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
                            {progressPercent !== null && ` · ${progressPercent}%`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          {task.type === 'chapters' && task.projectName && (
                            <button
                              onClick={() => { void handleCancelTask(task.projectName); }}
                              disabled={cancelingProjectName === task.projectName}
                              className="p-1 rounded hover:bg-destructive/20 text-destructive disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                              title="取消任务"
                            >
                              {cancelingProjectName === task.projectName
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
              <span>历史记录 ({history.length})</span>
              {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            
            {showHistory && (
              <div className="px-3 pb-3 space-y-2">
                {history.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2 text-center">
                    暂无历史记录
                  </div>
                ) : (
                  history.map(item => (
                    <div key={item.id} className="flex items-start gap-2 py-2 border-b border-border/50 last:border-0">
                      {item.status === 'success' ? (
                        <Check className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(item.startTime).toLocaleTimeString()}
                          {item.details && ` · ${item.details}`}
                        </p>
                      </div>
                    </div>
                  ))
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
