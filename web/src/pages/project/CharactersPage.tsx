import { useProject } from '@/contexts/ProjectContext';
import { CharacterGraphView } from '@/components/views';
import { NoProjectSelected } from '@/components/NoProjectSelected';

export default function CharactersPage() {
  const { selectedProject } = useProject();

  if (!selectedProject) {
    return <NoProjectSelected title="未找到项目" description="请先选择有效项目后再查看人物关系。"/>;
  }

  return <CharacterGraphView project={selectedProject} />;
}
