import { useState, useEffect } from 'react';
import { Activity, X, ChevronDown, ChevronUp, Check, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGeneration } from '@/contexts/GenerationContext';

// Task history item type
export interface TaskHistoryItem {
  id: string;
  type: 'bible' | 'outline' | 'chapters' | 'other';
  title: string;
  status: 'success' | 'error' | 'cancelled';
  startTime: number;
  endTime?: number;
  details?: string;
}

// In-memory history (could be persisted to localStorage in future)
let taskHistory: TaskHistoryItem[] = [];

export function addTaskToHistory(task: Omit<TaskHistoryItem, 'id'>) {
  const id = `task-${Date.now()}`;
  taskHistory = [{ id, ...task }, ...taskHistory.slice(0, 19)]; // Keep last 20
  // Trigger re-render via storage event
  window.dispatchEvent(new CustomEvent('taskHistoryUpdate'));
}

export function FloatingProgressButton() {
  const { generationState } = useGeneration();
  const [isOpen, setIsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);

  // Listen for history updates
  useEffect(() => {
    const handler = () => setHistory([...taskHistory]);
    window.addEventListener('taskHistoryUpdate', handler);
    return () => window.removeEventListener('taskHistoryUpdate', handler);
  }, []);

  // Current tasks from generation state
  const currentTasks = generationState.isGenerating ? [{
    id: 'current',
    type: 'chapters' as const,
    title: generationState.message || 'Generating...',
    status: generationState.status,
    current: generationState.current,
    total: generationState.total,
  }] : [];

  const hasActiveTasks = currentTasks.length > 0;

  // Calculate progress percentage
  const progressPercent = generationState.total > 0 
    ? Math.round((generationState.current / generationState.total) * 100)
    : 0;

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
            ? "bg-primary text-primary-foreground animate-pulse" 
            : "bg-card border border-border text-muted-foreground hover:text-foreground"
        )}
      >
        {hasActiveTasks ? (
          <div className="relative">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 text-[10px] rounded-full flex items-center justify-center text-white font-bold">
              {currentTasks.length}
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
            <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
              <span>当前任务</span>
              {hasActiveTasks && (
                <span className="text-primary">{progressPercent}%</span>
              )}
            </div>
            {currentTasks.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                暂无进行中的任务
              </div>
            ) : (
              <div className="space-y-2">
                {currentTasks.map(task => (
                  <div key={task.id} className="bg-muted/50 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {task.current} / {task.total} 章
                        </p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                ))}
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
    </>
  );
}
