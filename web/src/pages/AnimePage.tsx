import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Clapperboard, Play, Rocket } from 'lucide-react';

interface AnimeProject {
  id: string;
  name: string;
  total_episodes: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  error_message?: string;
  created_at: string;
}

interface AnimeEpisode {
  id: string;
  episode_num: number;
  status: string;
  duration_seconds?: number;
  video_r2_key?: string;
  error_message?: string;
}

export function AnimePage() {
  const [projects, setProjects] = useState<AnimeProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<AnimeProject | null>(null);
  const [episodes, setEpisodes] = useState<AnimeEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  // Form state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [novelFile, setNovelFile] = useState<File | null>(null);
  const [totalEpisodes, setTotalEpisodes] = useState(60);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/projects');
      const data = await res.json();
      if (data.success) {
        setProjects(data.projects);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch project details with episodes
  const fetchProjectDetails = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/anime/projects/${projectId}`);
      const data = await res.json();
      if (data.success) {
        setSelectedProject(data.project);
        setEpisodes(data.episodes);
      }
    } catch (error) {
      console.error('Failed to fetch project details:', error);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Create project
  const handleCreateProject = async () => {
    if (!newProjectName || !novelFile) return;

    setCreating(true);
    try {
      const novelText = await novelFile.text();
      
      const res = await fetch('/api/anime/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProjectName,
          novelText,
          totalEpisodes,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setShowCreateDialog(false);
        setNewProjectName('');
        setNovelFile(null);
        await fetchProjects();
      } else {
        alert(data.error);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      alert('创建失败');
    } finally {
      setCreating(false);
    }
  };

  // Start generation
  const handleGenerate = async () => {
    if (!selectedProject || !apiKey) {
      alert('请先配置 Gemini API Key');
      return;
    }

    setGenerating(true);
    localStorage.setItem('gemini_api_key', apiKey);

    try {
      const res = await fetch(`/api/anime/projects/${selectedProject.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });

      const data = await res.json();
      if (data.success) {
        alert(`生成完成: ${data.processed}/${data.total} 集`);
        await fetchProjectDetails(selectedProject.id);
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

  // Delete project
  const handleDeleteProject = async (id: string) => {
    if (!confirm('确定删除此项目?')) return;

    try {
      await fetch(`/api/anime/projects/${id}`, { method: 'DELETE' });
      await fetchProjects();
      if (selectedProject?.id === id) {
        setSelectedProject(null);
        setEpisodes([]);
      }
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  // Calculate progress
  const getProgress = (eps: AnimeEpisode[]) => {
    const done = eps.filter(e => e.status === 'done').length;
    return eps.length > 0 ? (done / eps.length) * 100 : 0;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done': return 'text-green-500';
      case 'error': return 'text-red-500';
      case 'processing': return 'text-yellow-500';
      default: return 'text-gray-400';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '待处理';
      case 'script': return '剧本生成中';
      case 'storyboard': return '分镜生成中';
      case 'audio': return '音频生成中';
      case 'video': return '视频生成中';
      case 'done': return '完成';
      case 'error': return '错误';
      default: return status;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="container mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-500 flex items-center gap-3">
              <Clapperboard className="h-8 w-8 text-purple-300" />
              小说转AI动漫
            </h1>
            <p className="text-gray-400 mt-1">自动将小说转换为60集AI动漫视频</p>
          </div>
          <div className="flex gap-4 items-center">
            <input
              type="password"
              placeholder="Gemini API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white w-64"
            />
            <Button 
              onClick={() => setShowCreateDialog(true)}
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
            >
              + 新建项目
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Project List */}
          <div className="col-span-4">
            <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-white">项目列表</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {projects.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">暂无项目，创建一个吧</p>
                ) : (
                  projects.map(project => (
                    <div
                      key={project.id}
                      onClick={() => fetchProjectDetails(project.id)}
                      className={`p-4 rounded-lg cursor-pointer transition-all ${
                        selectedProject?.id === project.id
                          ? 'bg-purple-600/30 border border-purple-500'
                          : 'bg-slate-700/50 hover:bg-slate-600/50'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-medium text-white">{project.name}</h3>
                          <p className="text-sm text-gray-400">
                            {project.total_episodes} 集 · 
                            <span className={getStatusColor(project.status)}>
                              {' '}{getStatusText(project.status)}
                            </span>
                          </p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id); }}
                          className="text-red-400 hover:text-red-300 text-sm"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Episode List */}
          <div className="col-span-8">
            {selectedProject ? (
              <Card className="bg-slate-800/50 border-slate-700 backdrop-blur">
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle className="text-white">{selectedProject.name}</CardTitle>
                      <CardDescription className="text-gray-400">
                        {episodes.filter(e => e.status === 'done').length} / {episodes.length} 集已完成
                      </CardDescription>
                    </div>
                    <Button
                      onClick={handleGenerate}
                      disabled={generating || !apiKey}
                      className="bg-gradient-to-r from-green-500 to-emerald-500"
                    >
                      {generating ? '生成中...' : (
                        <>
                          <Rocket className="mr-2 h-4 w-4" />
                          开始生成
                        </>
                      )}
                    </Button>
                  </div>
                  <Progress value={getProgress(episodes)} className="mt-4" />
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-6 gap-3 max-h-[500px] overflow-y-auto">
                    {episodes.map(episode => (
                      <div
                        key={episode.id}
                        className={`p-3 rounded-lg text-center ${
                          episode.status === 'done'
                            ? 'bg-green-600/20 border border-green-500/30'
                            : episode.status === 'error'
                            ? 'bg-red-600/20 border border-red-500/30'
                            : 'bg-slate-700/50'
                        }`}
                      >
                        <div className="text-lg font-bold text-white">第{episode.episode_num}集</div>
                        <div className={`text-xs ${getStatusColor(episode.status)}`}>
                          {getStatusText(episode.status)}
                        </div>
                        {episode.video_r2_key && (
                          <button className="mt-2 text-xs text-purple-400 hover:text-purple-300">
                            <span className="inline-flex items-center gap-1">
                              <Play className="h-3 w-3" />
                              预览
                            </span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-slate-800/50 border-slate-700 backdrop-blur h-full flex items-center justify-center">
                <CardContent className="text-center py-20">
                  <Clapperboard className="mx-auto mb-4 h-12 w-12 text-purple-300" />
                  <p className="text-gray-400">选择一个项目查看详情</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Create Dialog */}
        {showCreateDialog && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <Card className="bg-slate-800 border-slate-600 w-full max-w-lg">
              <CardHeader>
                <CardTitle className="text-white">创建新项目</CardTitle>
                <CardDescription className="text-gray-400">
                  上传小说文件，自动生成AI动漫视频
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-2">项目名称</label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="输入项目名称"
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-2">小说文件 (TXT)</label>
                  <input
                    type="file"
                    accept=".txt"
                    onChange={(e) => setNovelFile(e.target.files?.[0] || null)}
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-2">总集数</label>
                  <input
                    type="number"
                    value={totalEpisodes}
                    onChange={(e) => setTotalEpisodes(parseInt(e.target.value) || 60)}
                    min={1}
                    max={100}
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                  />
                </div>
                <div className="flex gap-3 justify-end pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setShowCreateDialog(false)}
                    className="border-slate-600 text-gray-300"
                  >
                    取消
                  </Button>
                  <Button
                    onClick={handleCreateProject}
                    disabled={creating || !newProjectName || !novelFile}
                    className="bg-gradient-to-r from-purple-500 to-pink-500"
                  >
                    {creating ? '创建中...' : '创建项目'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export default AnimePage;
