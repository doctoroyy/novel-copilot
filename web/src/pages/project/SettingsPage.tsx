import { useProject } from '@/contexts/ProjectContext';
import { SettingsView } from '@/components/views/SettingsView';
import { NoProjectSelected } from '@/components/NoProjectSelected';

export default function SettingsPage() {
  const { selectedProject, loadProject } = useProject();

  if (!selectedProject) {
    return <NoProjectSelected title="未找到项目" description="请先选择有效项目后再进行项目设定。"/>;
  }

  return <SettingsView project={selectedProject} onRefresh={() => loadProject(selectedProject.id)} />;
}

