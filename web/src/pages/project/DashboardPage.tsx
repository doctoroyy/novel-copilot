import { BookOpen } from 'lucide-react';
import { useProject } from '@/contexts/ProjectContext';
import { DashboardView } from '@/components/views';

export default function DashboardPage() {
  const { 
    selectedProject, 
    loading,
    handleGenerateOutline,
    handleGenerateChapters,
  } = useProject();

  if (!selectedProject) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground h-full">
        <div className="text-center">
          <BookOpen className="h-16 w-16 mx-auto mb-4 opacity-50" />
          <p className="text-xl font-medium mb-2">选择一个项目开始</p>
          <p className="text-sm">从左侧选择项目，或创建新项目</p>
        </div>
      </div>
    );
  }

  const defaultOutlineChapters = Math.max(1, selectedProject.state.totalChapters || 400);
  const defaultOutlineWordCount = Math.max(5, Math.round(defaultOutlineChapters / 4));
  const defaultMinChapterWords = Math.max(500, selectedProject.state.minChapterWords || 2500);

  return (
    <DashboardView 
      project={selectedProject} 
      onGenerateOutline={() => handleGenerateOutline(
        String(defaultOutlineChapters),
        String(defaultOutlineWordCount),
        String(defaultMinChapterWords),
        ''
      )}
      onGenerateChapters={() => handleGenerateChapters('1')}
      loading={loading}
    />
  );
}
