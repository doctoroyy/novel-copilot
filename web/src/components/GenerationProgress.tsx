import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface GenerationProgressProps {
  isGenerating: boolean;
  current: number;
  total: number;
  currentChapter?: number;
  currentChapterTitle?: string;
  status?: 'preparing' | 'generating' | 'saving' | 'done' | 'error';
  message?: string;
  startTime?: number;
}

const statusLabels: Record<string, string> = {
  preparing: '准备中',
  generating: '生成中',
  saving: '保存中',
  done: '完成',
  error: '错误',
};

const statusEmojis: Record<string, string> = {
  preparing: '🔄',
  generating: '✍️',
  saving: '💾',
  done: '✅',
  error: '❌',
};

export function GenerationProgress({
  isGenerating,
  current,
  total,
  currentChapter,
  currentChapterTitle,
  status = 'generating',
  message,
  startTime,
}: GenerationProgressProps) {
  const [dots, setDots] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  
  // Animated dots
  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, [isGenerating]);
  
  // Elapsed time counter
  useEffect(() => {
    if (!isGenerating || !startTime) return;
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isGenerating, startTime]);
  
  if (!isGenerating) return null;
  
  // Calculate progress based on completed chapters (current - 1)
  // If status is 'done', force 100%
  let percentage = 0;
  if (status === 'done') {
    percentage = 100;
  } else if (total > 0) {
    // current is 1-based index of the chapter being generated
    const completed = Math.max(0, current - 1);
    percentage = (completed / total) * 100;
  }
  
  const progress = Math.min(100, Math.max(0, percentage));
  const estimatedTotalTime = current > 0 ? (elapsedTime / current) * total : 0;
  const remainingTime = Math.max(0, Math.floor(estimatedTotalTime - elapsedTime));
  
  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}秒`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
  };

  return (
    <Card className="generation-progress-card overflow-hidden border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
      <CardContent className="p-4 lg:p-6">
        {/* Header with animated status */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-lg animate-pulse">
                {statusEmojis[status] || '⏳'}
              </div>
              {status === 'generating' && (
                <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              )}
            </div>
            <div>
              <div className="font-semibold text-sm lg:text-base flex items-center gap-1">
                {statusLabels[status] || status}
                <span className="text-primary w-8">{dots}</span>
              </div>
              <div className="text-xs lg:text-sm text-muted-foreground">
                {current} / {total} 章
              </div>
            </div>
          </div>
          
          {/* Time display */}
          <div className="text-right text-xs lg:text-sm text-muted-foreground">
            <div>已用时: {formatTime(elapsedTime)}</div>
            {current > 0 && remainingTime > 0 && (
              <div className="text-primary">预计还需: {formatTime(remainingTime)}</div>
            )}
          </div>
        </div>
        
        {/* Progress bar with gradient animation */}
        <div className="relative h-3 bg-muted rounded-full overflow-hidden mb-3">
          <div 
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary via-primary/80 to-primary rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
          </div>
        </div>
        
        {/* Progress percentage */}
        <div className="flex justify-between items-center text-xs lg:text-sm mb-3">
          <span className="text-muted-foreground">进度</span>
          <span className="font-mono font-semibold text-primary">{Math.round(progress)}%</span>
        </div>
        
        {/* Current chapter info */}
        {currentChapter && (
          <div className="p-3 rounded-lg bg-background/50 border border-border/50 mb-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">正在生成:</span>
              <span className="font-medium truncate">
                第 {currentChapter} 章
                {currentChapterTitle && ` - ${currentChapterTitle}`}
              </span>
            </div>
          </div>
        )}
        
        {/* Status message with typewriter effect */}
        {message && (
          <div className="text-xs lg:text-sm text-muted-foreground animate-fade-in flex items-start gap-2">
            <span className="text-primary">▸</span>
            <span className="typewriter">{message}</span>
          </div>
        )}
        
        {/* Writing animation indicator */}
        <div className="mt-4 flex items-center justify-center gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce"
              style={{ animationDelay: `${i * 0.1}s` }}
            />
          ))}
        </div>
      </CardContent>
      
      {/* Shimmer animation CSS */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
        .typewriter {
          display: inline-block;
          overflow: hidden;
          white-space: nowrap;
          animation: typing 0.5s steps(20, end);
        }
        @keyframes typing {
          from { max-width: 0; }
          to { max-width: 100%; }
        }
      `}</style>
    </Card>
  );
}
