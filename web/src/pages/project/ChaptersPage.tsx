import { useProject } from '@/contexts/ProjectContext';
import { ChapterListView } from '@/components/views';

export default function ChaptersPage() {
  const { 
    selectedProject, 
    handleViewChapter,
    handleDeleteChapter,
    handleBatchDeleteChapters,
  } = useProject();

  if (!selectedProject) {
    return null;
  }

  return (
    <ChapterListView 
      project={selectedProject} 
      onViewChapter={handleViewChapter}
      onDeleteChapter={handleDeleteChapter}
      onBatchDeleteChapters={handleBatchDeleteChapters}
    />
  );
}
