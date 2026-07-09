import { useProject } from '@/contexts/ProjectContext';
import { ChapterBlueprintView } from '@/components/views/ChapterBlueprintView';
import { NoProjectSelected } from '@/components/NoProjectSelected';

export default function BlueprintPage() {
  const { selectedProject } = useProject();
  if (!selectedProject) return <NoProjectSelected />;
  return <ChapterBlueprintView projectId={selectedProject.id} projectName={selectedProject.name} />;
}
