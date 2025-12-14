import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import type { ProgressEvent } from '@/hooks/useServerEvents';

interface ActivityPanelProps {
  logs: string[];
  onClear: () => void;
  progress?: ProgressEvent | null;
}

export function ActivityPanel({ logs, onClear, progress }: ActivityPanelProps) {
  const getStatusColor = (status: ProgressEvent['status']) => {
    switch (status) {
      case 'generating':
        return 'text-blue-400';
      case 'saving':
        return 'text-amber-400';
      case 'updating_summary':
        return 'text-purple-400';
      case 'done':
        return 'text-green-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusEmoji = (status: ProgressEvent['status']) => {
    switch (status) {
      case 'starting':
        return '🚀';
      case 'generating':
        return '✍️';
      case 'saving':
        return '💾';
      case 'updating_summary':
        return '📝';
      case 'done':
        return '✅';
      case 'error':
        return '❌';
      default:
        return '⏳';
    }
  };

  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <aside className="w-80 h-screen flex flex-col border-l border-border bg-sidebar">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="font-medium text-sm">活动日志</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear} className="text-xs">
          清空
        </Button>
      </div>

      {/* Progress Card */}
      {progress && progress.status !== 'done' && (
        <div className="p-3 border-b border-border">
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">{getStatusEmoji(progress.status)}</span>
              <div className="flex-1">
                <div className={`text-sm font-medium ${getStatusColor(progress.status)}`}>
                  {progress.message || '处理中...'}
                </div>
                <div className="text-xs text-muted-foreground">
                  第 {progress.chapterIndex} 章 · {progress.current}/{progress.total}
                </div>
              </div>
            </div>
            
            {/* Progress bar */}
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full progress-gradient transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="text-right text-xs text-muted-foreground mt-1">
              {progressPercent}%
            </div>
          </div>
        </div>
      )}

      {/* Log List */}
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-2">
          {logs.slice().reverse().map((log, i) => {
            // Detect log level from prefix
            let levelClass = 'text-muted-foreground';
            if (log.includes('✅') || log.includes('成功') || log.includes('完成')) {
              levelClass = 'text-green-400';
            } else if (log.includes('❌') || log.includes('失败') || log.includes('错误')) {
              levelClass = 'text-red-400';
            } else if (log.includes('⚠️') || log.includes('警告')) {
              levelClass = 'text-amber-400';
            } else if (log.includes('📋') || log.includes('📝') || log.includes('📚')) {
              levelClass = 'text-blue-400';
            }

            return (
              <div 
                key={logs.length - 1 - i}
                className={`text-xs font-mono p-2 rounded-lg bg-muted/50 break-all ${levelClass}`}
              >
                {log}
              </div>
            );
          })}
          {logs.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <div className="text-2xl mb-2">📝</div>
              <p className="text-xs">等待服务器事件...</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Stats Footer */}
      <div className="p-4 border-t border-border">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-lg font-bold gradient-text">{logs.length}</div>
            <div className="text-xs text-muted-foreground">日志数</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className={`text-lg font-bold ${progress?.status === 'generating' ? 'text-blue-400' : 'text-green-500'}`}>
              {progress?.status === 'generating' ? '⏳' : '🟢'}
            </div>
            <div className="text-xs text-muted-foreground">
              {progress?.status === 'generating' ? '生成中' : '就绪'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
