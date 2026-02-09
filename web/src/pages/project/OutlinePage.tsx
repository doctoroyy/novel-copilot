import { useProject } from '@/contexts/ProjectContext';
import { OutlineView } from '@/components/views';

export default function OutlinePage() {
  const { selectedProject, loadProject } = useProject();

  if (!selectedProject) {
    return null;
  }

  return (
    <OutlineView 
      project={selectedProject} 
      onRefresh={() => loadProject(selectedProject.name)} 
    />
  );
}
