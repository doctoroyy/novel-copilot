import { useProject } from '@/contexts/ProjectContext';
import { CharacterGraphView } from '@/components/views';

export default function CharactersPage() {
  const { selectedProject } = useProject();

  if (!selectedProject) {
    return null;
  }

  return <CharacterGraphView project={selectedProject} />;
}
