import { useProject } from '@/contexts/ProjectContext';
import { SummaryView } from '@/components/views';
import { NoProjectSelected } from '@/components/NoProjectSelected';

export default function SummaryPage() {
  const { selectedProject } = useProject();

  if (!selectedProject) {
    return <NoProjectSelected title="未找到项目" description="请先选择有效项目后再查看剧情摘要。"/>;
  }

  return <SummaryView project={selectedProject} />;
}

