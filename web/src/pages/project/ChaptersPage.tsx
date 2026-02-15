import { useProject } from '@/contexts/ProjectContext';
import { ChapterListView } from '@/components/views';
import { NoProjectSelected } from '@/components/NoProjectSelected';

export default function ChaptersPage() {
  const { 
    selectedProject, 
    loadProject,
    handleViewChapter,
    handleDeleteChapter,
    handleBatchDeleteChapters,
    handleGenerateChapters,
    generationState,
  } = useProject();

  if (!selectedProject) {
    return <NoProjectSelected title="未找到项目" description="请先选择有效项目后再查看章节。"/>;
  }

  return (
    <ChapterListView 
      project={selectedProject} 
      onViewChapter={handleViewChapter}
      onDeleteChapter={handleDeleteChapter}
      onBatchDeleteChapters={handleBatchDeleteChapters}
      onProjectRefresh={() => loadProject(selectedProject.id)}
      onGenerateNextChapter={() => handleGenerateChapters('1')}
      isProjectGenerating={generationState.isGenerating && generationState.projectName === selectedProject.name}
    />
  );
}
