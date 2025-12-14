import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

interface ActivityPanelProps {
  logs: string[];
  onClear: () => void;
}

export function ActivityPanel({ logs, onClear }: ActivityPanelProps) {
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

      {/* Log List */}
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-2">
          {logs.map((log, i) => (
            <div 
              key={i}
              className="text-xs font-mono p-2 rounded-lg bg-muted/50 text-muted-foreground break-all"
            >
              {log}
            </div>
          ))}
          {logs.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <div className="text-2xl mb-2">📝</div>
              <p className="text-xs">暂无日志</p>
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
            <div className="text-lg font-bold text-green-500">🟢</div>
            <div className="text-xs text-muted-foreground">运行中</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
