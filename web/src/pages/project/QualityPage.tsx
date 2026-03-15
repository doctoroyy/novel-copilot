import { useProject } from '@/contexts/ProjectContext';
import { QualityView } from '@/components/views';
import { NoProjectSelected } from '@/components/NoProjectSelected';

export default function QualityPage() {
  const { selectedProject } = useProject();

  if (!selectedProject) {
    return <NoProjectSelected title="未找到项目" description="请先选择有效项目后再查看质量报告。"/>;
  }

  return <QualityView project={selectedProject} />;
}
