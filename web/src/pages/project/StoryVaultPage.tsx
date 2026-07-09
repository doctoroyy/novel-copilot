import { useProject } from '@/contexts/ProjectContext';
import { StoryVaultView } from '@/components/views/StoryVaultView';
import { NoProjectSelected } from '@/components/NoProjectSelected';

export default function StoryVaultPage() {
  const { selectedProject } = useProject();
  if (!selectedProject) return <NoProjectSelected />;
  return <StoryVaultView projectId={selectedProject.id} projectName={selectedProject.name} />;
}
