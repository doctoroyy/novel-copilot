import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface GenerationState {
  isGenerating: boolean;
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
    // Auto-reset after showing completion
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
