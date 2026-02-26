import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Newspaper, ListTodo, AlertTriangle } from 'lucide-react';
import type { ProjectDetail } from '@/lib/api';

interface SummaryViewProps {
  project: ProjectDetail;
}

export function SummaryView({ project }: SummaryViewProps) {
  return (
    <div className="p-4 lg:p-6 space-y-4">
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base lg:text-lg">
            <Newspaper className="h-5 w-5 text-primary" />
            <span>剧情摘要</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">用于保持章节连续性的中短期剧情记忆</p>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-360px)] lg:h-[calc(100vh-380px)]">
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {project.state.rollingSummary?.trim() || '暂无摘要'}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListTodo className="h-5 w-5 text-primary" />
            <span>未闭环线索</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {project.state.openLoops.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无未闭环线索</p>
          ) : (
            <ul className="space-y-2">
              {project.state.openLoops.map((loop, idx) => (
                <li
                  key={`${loop}-${idx}`}
                  className="text-sm rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-foreground/90"
                >
                  {loop}
                </li>
              ))}
            </ul>
          )}

          <div className="pt-2">
            {project.state.needHuman ? (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                需要人工介入
              </Badge>
            ) : (
              <Badge variant="secondary">当前无需人工介入</Badge>
            )}
            {project.state.needHumanReason ? (
              <p className="mt-2 text-xs text-muted-foreground">{project.state.needHumanReason}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

