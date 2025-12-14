import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ProjectDetail } from '@/lib/api';

interface BibleViewProps {
  project: ProjectDetail;
}

export function BibleView({ project }: BibleViewProps) {
  return (
    <div className="p-6">
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>📕</span>
            <span>Story Bible</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-280px)]">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <pre className="whitespace-pre-wrap font-mono text-sm bg-muted/30 p-4 rounded-lg">
                {project.bible || '暂无 Story Bible'}
              </pre>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
