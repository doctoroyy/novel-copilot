import { BookOpen } from 'lucide-react';

interface NoProjectSelectedProps {
  title?: string;
  description?: string;
}

export function NoProjectSelected({
  title = '请选择一个项目',
  description = '从左侧项目列表中选择，或先创建新项目。',
}: NoProjectSelectedProps) {
  return (
    <div className="h-full min-h-[320px] flex items-center justify-center text-muted-foreground p-6">
      <div className="text-center">
        <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p className="text-base font-medium mb-1">{title}</p>
        <p className="text-sm">{description}</p>
      </div>
    </div>
  );
}
