import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// Task types for tracking different generation operations
export type TaskType = 'chapters' | 'outline' | 'bible' | 'other';

export interface ActiveTask {
  id: string;
  taskId?: number;
  type: TaskType;
  title: string;
  status: 'preparing' | 'generating' | 'saving' | 'done' | 'error';
  current?: number;
  total?: number;
  message?: string;
  startTime: number;
  projectName?: string;
  startChapter?: number;
}

export interface GenerationState {
  // Legacy state for chapters (backwards compatibility)
  isGenerating: boolean;
  taskId?: number;
  current: number;
  total: number;
  currentChapter?: number;
  currentChapterTitle?: string;
  status?: 'preparing' | 'generating' | 'saving' | 'done' | 'error';
  message?: string;
  startTime?: number;
  projectName?: string;
}

interface GenerationContextValue {
  generationState: GenerationState;
  setGenerationState: React.Dispatch<React.SetStateAction<GenerationState>>;
  // Multi-task tracking
  activeTasks: ActiveTask[];
  startTask: (type: TaskType, title: string, projectName?: string, total?: number) => string;
  updateTask: (taskId: string, updates: Partial<ActiveTask>) => void;
  completeTask: (taskId: string, success: boolean, details?: string) => void;
  // Legacy helpers
  startGeneration: (projectName: string, total: number) => void;
  updateProgress: (updates: Partial<GenerationState>) => void;
  completeGeneration: () => void;
  resetGeneration: () => void;
}

const DEFAULT_STATE: GenerationState = {
  isGenerating: false,
  current: 0,
  total: 0,
};

const GenerationContext = createContext<GenerationContextValue | null>(null);

export function GenerationProvider({ children }: { children: ReactNode }) {
  const [generationState, setGenerationState] = useState<GenerationState>(DEFAULT_STATE);
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);

  // Start a new task and return its ID
  const startTask = useCallback((type: TaskType, title: string, projectName?: string, total?: number) => {
    const taskId = `${type}-${Date.now()}`;
    const newTask: ActiveTask = {
      id: taskId,
      type,
      title,
      status: 'generating',
      startTime: Date.now(),
      projectName,
      total,
      current: 0,
    };
    setActiveTasks(prev => [...prev, newTask]);
    return taskId;
  }, []);

  // Update an existing task
  const updateTask = useCallback((taskId: string, updates: Partial<ActiveTask>) => {
    setActiveTasks(prev => prev.map(task =>
      task.id === taskId ? { ...task, ...updates } : task
    ));
  }, []);

  // Complete and remove a task
  const completeTask = useCallback((taskId: string, success: boolean, details?: string) => {
    setActiveTasks(prev => prev.map(task =>
      task.id === taskId ? { ...task, status: success ? 'done' : 'error', message: details } : task
    ));
    // Remove after a brief delay
    setTimeout(() => {
      setActiveTasks(prev => prev.filter(task => task.id !== taskId));
    }, 1500);
  }, []);

  // Legacy support for chapters
  const startGeneration = useCallback((projectName: string, total: number) => {
    setGenerationState({
      isGenerating: true,
      current: 0,
      total,
      status: 'preparing',
      message: '准备生成章节...',
      startTime: Date.now(),
      projectName,
    });
  }, []);

  const updateProgress = useCallback((updates: Partial<GenerationState>) => {
    setGenerationState(prev => ({ ...prev, ...updates }));
  }, []);

  const completeGeneration = useCallback(() => {
    setGenerationState(prev => ({
      ...prev,
      isGenerating: false,
      status: 'done',
    }));
    setTimeout(() => {
      setGenerationState(DEFAULT_STATE);
    }, 2000);
  }, []);

  const resetGeneration = useCallback(() => {
    setGenerationState(DEFAULT_STATE);
  }, []);

  return (
    <GenerationContext.Provider value={{
      generationState,
      setGenerationState,
      activeTasks,
      startTask,
      updateTask,
      completeTask,
      startGeneration,
      updateProgress,
      completeGeneration,
      resetGeneration,
    }}>
      {children}
    </GenerationContext.Provider>
  );
}

export function useGeneration() {
  const context = useContext(GenerationContext);
  if (!context) {
    throw new Error('useGeneration must be used within a GenerationProvider');
  }
  return context;
}
