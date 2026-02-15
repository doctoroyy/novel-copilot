import { useProject } from '@/contexts/ProjectContext';
import { BibleView } from '@/components/views';
import { NoProjectSelected } from '@/components/NoProjectSelected';

export default function BiblePage() {
  const { selectedProject } = useProject();

  if (!selectedProject) {
    return <NoProjectSelected title="未找到项目" description="请先选择有效项目后再查看设定。"/>;
  }

  return <BibleView project={selectedProject} />;
}
