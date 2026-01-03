import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';
import type { ProjectDetail } from '@/lib/api';

interface AnimeEpisode {
  id: string;
  episode_num: number;
  status: string;
  duration_seconds?: number;
  video_r2_key?: string;
  error_message?: string;
}

interface AnimeProject {
  id: string;
  project_id: string;
  total_episodes: number;
  status: string;
}

interface AnimeViewProps {
  project: ProjectDetail;
}

export function AnimeView({ project }: AnimeViewProps) {
  const { config: aiConfig, isConfigured, maskedApiKey, loaded: configLoaded } = useAIConfig();
  
  const [animeProject, setAnimeProject] = useState<AnimeProject | null>(null);
  const [episodes, setEpisodes] = useState<AnimeEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [totalEpisodes, setTotalEpisodes] = useState(60);

  // Check if anime project exists for this novel project
  const fetchAnimeProject = useCallback(async () => {
    try {
      setLoading(true);
      // Use project name as identifier
      const res = await fetch(`/api/anime/projects?novelProject=${encodeURIComponent(project.name)}`);
      const data = await res.json();
      
      if (data.success && data.projects.length > 0) {
        const anime = data.projects.find((p: any) => p.name === `anime-${project.name}`);
        if (anime) {
          setAnimeProject(anime);
          // Fetch episodes
          const episodesRes = await fetch(`/api/anime/projects/${anime.id}`);
          const episodesData = await episodesRes.json();
          if (episodesData.success) {
            setEpisodes(episodesData.episodes || []);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch anime project:', error);
    } finally {
      setLoading(false);
    }
  }, [project.name]);

  useEffect(() => {
    fetchAnimeProject();
  }, [fetchAnimeProject]);

  // Create anime project from novel
  const handleCreateAnimeProject = async () => {
    if (!isConfigured) {
      alert('请先在设置中配置 AI API Key');
      return;
    }

    try {
      setLoading(true);
      
      // Get all chapters content
      const chaptersContent: string[] = [];
      for (const chapterFile of project.chapters) {
        const index = parseInt(chapterFile.replace('.md', ''), 10);
        const res = await fetch(`/api/projects/${encodeURIComponent(project.name)}/chapters/${index}`);
        const data = await res.json();
        if (data.success) {
          chaptersContent.push(data.content);
        }
      }

      const novelText = chaptersContent.join('\n\n---\n\n');

      const res = await fetch('/api/anime/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `anime-${project.name}`,
          novelText,
          totalEpisodes,
        }),
      });

      const data = await res.json();
      if (data.success) {
        await fetchAnimeProject();
      } else {
        alert(data.error);
      }
    } catch (error) {
      console.error('Failed to create anime project:', error);
      alert('创建失败');
    } finally {
      setLoading(false);
    }
  };

  // Start generation
  const handleGenerate = async () => {
    if (!animeProject || !isConfigured) {
      alert('请先在设置中配置 AI API Key');
      return;
    }

    setGenerating(true);

    try {
      const res = await fetch(`/api/anime/projects/${animeProject.id}/generate`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAIConfigHeaders(aiConfig),
        },
        body: JSON.stringify({}),
      });

      const data = await res.json();
      if (data.success) {
        alert(`生成完成: ${data.processed}/${data.total} 集`);
        await fetchAnimeProject();
      } else {
        alert(data.error);
      }
    } catch (error) {
      console.error('Generation failed:', error);
      alert('生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'error': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'processing': case 'script': case 'storyboard': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default: return 'bg-zinc-700 text-zinc-100 border-zinc-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '待处理';
      case 'script': return '剧本';
      case 'storyboard': return '分镜';
      case 'audio': return '音频';
      case 'video': return '视频';
      case 'done': return '完成';
      case 'error': return '错误';
      default: return status;
    }
  };

  const doneCount = episodes.filter(e => e.status === 'done').length;
  const progress = episodes.length > 0 ? (doneCount / episodes.length) * 100 : 0;

  // Wait for both anime project data and AI config to load
  if (loading || !configLoaded) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // No anime project yet - show creation view
  if (!animeProject) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="glass-card">
          <CardHeader className="text-center">
            <div className="text-6xl mb-4">🎬</div>
            <CardTitle className="gradient-text">将小说转换为AI动漫</CardTitle>
            <CardDescription>
              自动将《{project.name}》的 {project.chapters.length} 章内容转换为 AI 动漫视频
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-sm">转换说明</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• 小说内容将被均匀分配到各集</li>
                <li>• AI 自动生成每集的剧本和分镜</li>
                <li>• 每集时长约 90-120 秒</li>
                <li>• 使用 Edge TTS 生成配音</li>
              </ul>
            </div>

            {/* AI Config Status */}
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">AI 配置</span>
                {isConfigured ? (
                  <span className="text-sm text-green-400">✓ 已配置 ({maskedApiKey})</span>
                ) : (
                  <span className="text-sm text-red-400">✗ 未配置 (请在设置中配置)</span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">总集数</label>
              <input
                type="number"
                value={totalEpisodes}
                onChange={(e) => setTotalEpisodes(parseInt(e.target.value) || 60)}
                min={1}
                max={100}
                className="w-full px-4 py-2 bg-muted/50 border border-border rounded-lg"
              />
              <p className="text-xs text-muted-foreground mt-1">
                每集约 {Math.round((project.chapters.length * 2000) / totalEpisodes)} 字内容
              </p>
            </div>

            <Button
              onClick={handleCreateAnimeProject}
              disabled={loading || project.chapters.length === 0 || !isConfigured}
              className="w-full gradient-bg hover:opacity-90"
            >
              🚀 开始创建动漫项目
            </Button>

            {project.chapters.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">
                请先生成一些章节内容
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Anime project exists - show episodes
  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <span className="text-2xl">🎬</span>
            AI 动漫生成
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {doneCount} / {episodes.length} 集已完成
          </p>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={generating || !isConfigured}
          className="gradient-bg hover:opacity-90"
        >
          {generating ? '生成中...' : '🚀 开始生成'}
        </Button>
      </div>

      <Progress value={progress} className="mb-6" />

      <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2">
        {episodes.map(episode => (
          <div
            key={episode.id}
            className={`p-2 rounded-lg text-center border ${getStatusColor(episode.status)}`}
          >
            <div className="text-sm font-bold">{episode.episode_num}</div>
            <div className="text-[10px]">{getStatusText(episode.status)}</div>
          </div>
        ))}
      </div>

      {episodes.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <div className="text-4xl mb-2">📺</div>
          <p>暂无集数数据</p>
        </div>
      )}
    </div>
  );
}
