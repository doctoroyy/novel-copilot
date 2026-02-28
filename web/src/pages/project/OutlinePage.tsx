import { useProject } from '@/contexts/ProjectContext';
import { OutlineView } from '@/components/views';
import { NoProjectSelected } from '@/components/NoProjectSelected';

export default function OutlinePage() {
  const { selectedProject, loadProject, handleGenerateOutline, generatingOutline } = useProject();

  if (!selectedProject) {
    return <NoProjectSelected title="未找到项目" description="请先选择有效项目后再查看大纲。"/>;
  }

  return (
      <OutlineView 
        project={selectedProject}
        onRefresh={() => loadProject(selectedProject.id)}
        onAddVolumes={handleGenerateOutline}
        addingVolumes={generatingOutline}
      />
  );
}
