import { useNavigate, useParams } from 'react-router-dom';
import { useProject } from '@/contexts/ProjectContext';
import { AnimeView, AnimeEpisodeDetail } from '@/components/views';
import { NoProjectSelected } from '@/components/NoProjectSelected';

export default function AnimePage() {
  const { selectedProject } = useProject();
  const { episodeId } = useParams<{ episodeId?: string }>();
  const navigate = useNavigate();

  if (!selectedProject) {
    return <NoProjectSelected title="未找到项目" description="请先选择有效项目后再使用 AI 动漫功能。"/>;
  }

  // If we have an episodeId, show the detail view
  if (episodeId) {
    return (
      <AnimeEpisodeDetail 
        project={selectedProject} 
        episodeId={episodeId}
        onBack={() => navigate(`/project/${encodeURIComponent(selectedProject.name)}/anime`)}
      />
    );
  }

  return (
    <AnimeView 
      project={selectedProject} 
      onEpisodeSelect={(epId) => 
        navigate(`/project/${encodeURIComponent(selectedProject.name)}/anime/episode/${epId}`)
      }
    />
  );
}
