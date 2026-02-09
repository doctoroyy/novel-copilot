import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BookMarked } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { ProjectDetail } from '@/lib/api';

interface BibleViewProps {
  project: ProjectDetail;
}

export function BibleView({ project }: BibleViewProps) {
  return (
    <div className="p-4 lg:p-6">
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base lg:text-lg">
            <BookMarked className="h-5 w-5 text-primary" />
            <span>小说设定</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            世界观、角色背景、核心设定等
          </p>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-280px)] lg:h-[calc(100vh-320px)]">
            {project.bible ? (
              <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90">
                <ReactMarkdown>{project.bible}</ReactMarkdown>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <BookMarked className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p>暂无小说设定</p>
                <p className="text-xs mt-2">在创建项目时添加设定，或使用 AI 自动生成</p>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
