import { useProject } from '@/contexts/ProjectContext';
import { BibleView } from '@/components/views';

export default function BiblePage() {
  const { selectedProject } = useProject();

  if (!selectedProject) {
    return null;
  }

  return <BibleView project={selectedProject} />;
}
