import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';
import { getAuthHeaders } from '@/lib/auth';

import { useServerEventsContext } from '@/contexts/ServerEventsContext';
import type { ProjectDetail } from '@/lib/api';
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Eye,
  FileText,
  Film,
  ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Users,
} from 'lucide-react';


interface AnimeEpisode {
  id: string;
  episode_num: number;
  status: string;
  duration_seconds?: number;
  video_r2_key?: string;
  error_message?: string;
  script?: string;
  storyboard_json?: string;
  storyboard?: any[];
}


interface AnimeProject {
  id: string;
  project_id: string;
  name: string;
  total_episodes: number;
  status: string;
}



interface AnimeViewProps {
  project: ProjectDetail;
  onEpisodeSelect?: (episodeId: string) => void;
}

async function requestJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(data?.error || `请求失败 (${res.status})`);
  }
  return data as T;
}

export function AnimeView({ project, onEpisodeSelect }: AnimeViewProps) {
  const { config: aiConfig, isConfigured, maskedApiKey, loaded: configLoaded } = useAIConfig();
  
  const [animeProject, setAnimeProject] = useState<AnimeProject | null>(null);
  const [episodes, setEpisodes] = useState<AnimeEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  // Track generating state for specific episodes
  const [generatingEpisodeId, setGeneratingEpisodeId] = useState<string | null>(null);

  const [totalEpisodes, setTotalEpisodes] = useState(60);
  const [selectedEpisode, setSelectedEpisode] = useState<AnimeEpisode | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // New States for Series Refactor
  const [seriesScript, setSeriesScript] = useState<string>('');
  const [characters, setCharacters] = useState<any[]>([]);
  const [voices, setVoices] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('episodes');
  const [actionError, setActionError] = useState<string | null>(null);
  
  // Character image preview
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  // Track which character is generating image
  const [generatingCharId, setGeneratingCharId] = useState<string | null>(null);

  // Load voices on mount
  useEffect(() => {
    const loadVoices = async () => {
      try {
        const data = await requestJson<{ success: boolean; voices?: any[]; error?: string }>(
          '/api/anime/voices',
          { headers: { ...getAuthHeaders(), ...getAIConfigHeaders(aiConfig) } }
        );
        if (!data.success) {
          throw new Error(data.error || '加载音色列表失败');
        }
        setVoices(data.voices || []);
      } catch (error) {
        console.error(error);
      }
    };
    void loadVoices();
  }, [aiConfig]); // Re-fetch if config changes (key might be needed)

  const { lastProgress } = useServerEventsContext();

  // Fetch full details for an episode
  const handleEpisodeClick = async (episode: AnimeEpisode) => {
    setActionError(null);

    if (onEpisodeSelect) {
      // In routed mode, delegate to page-level episode detail.
      onEpisodeSelect(String(episode.episode_num));
      return;
    }

    setSelectedEpisode(episode);
    setIsDetailOpen(true);

    if (!animeProject) return;
    if (!episode.script || (!episode.storyboard && !episode.storyboard_json)) {
      try {
        const data = await requestJson<{ success: boolean; episode?: AnimeEpisode; error?: string }>(
          `/api/anime/projects/${animeProject.id}/episodes/${episode.episode_num}`,
          { headers: getAuthHeaders() }
        );
        if (!data.success || !data.episode) {
          throw new Error(data.error || '分集详情不存在');
        }
        const episodeDetail = data.episode;
        setSelectedEpisode(prev => (prev ? { ...prev, ...episodeDetail } : episodeDetail));
        // Update in list too
        setEpisodes(prev => prev.map(e => e.id === episode.id ? { ...e, ...episodeDetail } : e));
      } catch (error) {
        console.error('Failed to fetch episode details', error);
        setActionError(`加载分集详情失败：${(error as Error).message}`);
      }
    }
  };


  const fetchAnimeProject = useCallback(async (showSpinner = false) => {
    try {
      if (showSpinner) setLoading(true);
      
      const data = await requestJson<{ success: boolean; projects?: AnimeProject[]; error?: string }>(
        `/api/anime/projects?novelProject=${encodeURIComponent(project.name)}`,
        { headers: getAuthHeaders() }
      );
      if (!data.success) {
        throw new Error(data.error || '加载动漫项目列表失败');
      }
      
      if (data.projects && data.projects.length > 0) {
        const anime = data.projects.find((p: any) => p.name === `anime-${project.name}`);
        if (anime) {
          setAnimeProject(anime);

          // Parallel fetch of resources
          const [episodesData, scriptData, charsData] = await Promise.all([
             requestJson<{ success: boolean; episodes?: AnimeEpisode[]; error?: string }>(
               `/api/anime/projects/${anime.id}`,
               { headers: getAuthHeaders() }
             ),
             requestJson<{ success: boolean; script?: { content?: string } | null; error?: string }>(
               `/api/anime/projects/${anime.id}/script`,
               { headers: getAuthHeaders() }
             ),
             requestJson<{ success: boolean; characters?: any[]; error?: string }>(
               `/api/anime/projects/${anime.id}/characters`,
               { headers: getAuthHeaders() }
             )
          ]);
          if (!episodesData.success) throw new Error(episodesData.error || '加载分集失败');
          if (!scriptData.success) throw new Error(scriptData.error || '加载系列剧本失败');
          if (!charsData.success) throw new Error(charsData.error || '加载角色列表失败');
          setEpisodes(episodesData.episodes || []);
          setSeriesScript(scriptData.script?.content || '');
          setCharacters(charsData.characters || []);

          // If detailed view is open, refresh selected episode too
          // Use functional update to access current state without dependency
          setSelectedEpisode(current => {
             if (current) {
                const found = episodesData.episodes?.find((e: AnimeEpisode) => e.id === current.id);
                if (found) {
                   return { ...current, ...found };
                }
             }
             return current;
          });
        } else {
          setAnimeProject(null);
          setEpisodes([]);
          setSeriesScript('');
          setCharacters([]);
        }
      } else {
        setAnimeProject(null);
        setEpisodes([]);
        setSeriesScript('');
        setCharacters([]);
      }
    } catch (error) {
      console.error('Failed to fetch anime project:', error);
      setActionError(`加载动漫项目失败：${(error as Error).message}`);
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }, [project.name]);

  useEffect(() => {
    void fetchAnimeProject(true);
  }, [fetchAnimeProject]);

  // Real-time updates from SSE
  useEffect(() => {
    if (lastProgress && animeProject && lastProgress.projectName === animeProject.name) {
      // Optimistically update the specific episode status
      if (lastProgress.chapterIndex) {
        setEpisodes(prev => prev.map(ep => {
          if (ep.episode_num === lastProgress.chapterIndex) {
            return {
              ...ep,
              status: lastProgress.status === 'generating' ? 'processing' : 
                      lastProgress.status === 'starting' ? 'processing' :
                      lastProgress.status === 'analyzing' ? 'processing' :
                      lastProgress.status
            };
          }
          return ep;
        }));

        // Also update selected episode if it's the one updating
        // Access previous state safely to avoid dependency loop
        setSelectedEpisode(prev => {
           if (prev && prev.episode_num === lastProgress.chapterIndex) {
              const newStatus = lastProgress.status === 'generating' ? 'processing' : 
                                lastProgress.status === 'starting' ? 'processing' :
                                lastProgress.status === 'analyzing' ? 'processing' :
                                lastProgress.status;
              // Only update if status actually changed to avoid extra renders
              if (prev.status !== newStatus) {
                  return { ...prev, status: newStatus };
              }
           }
           return prev;
        });
      }

      // If a batch finishes or errors, refresh full state to be sure
      if (lastProgress.status === 'done' || lastProgress.status === 'error') {
        fetchAnimeProject();
      }
    }
  }, [lastProgress, animeProject, fetchAnimeProject]);


  // Create anime project from novel
  const handleCreateAnimeProject = async () => {
    if (!isConfigured) {
      // alert('请先在设置中配置 AI API Key');
      console.error('Missing API Key');
      setActionError('请先在设置中配置 AI API Key');
      return;
    }

    try {
      setActionError(null);
      setLoading(true);
      
      // Get all chapters content
      const chaptersContent: string[] = [];
      const chapterIndices = project.chapters
        .map((chapterFile) => Number.parseInt(chapterFile.replace('.md', ''), 10))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      for (const index of chapterIndices) {
        const data = await requestJson<{ success: boolean; content?: string; error?: string }>(
          `/api/projects/${encodeURIComponent(project.id)}/chapters/${index}`,
          { headers: getAuthHeaders() }
        );
        if (data.success && typeof data.content === 'string') {
          chaptersContent.push(data.content);
        } else {
          throw new Error(data.error || `读取第 ${index} 章失败`);
        }
      }

      const novelText = chaptersContent.join('\n\n---\n\n');

      const data = await requestJson<{ success: boolean; projectId?: string; error?: string }>('/api/anime/projects', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          name: `anime-${project.name}`,
          novelText,
          totalEpisodes,
        }),
      });
      if (data.success) {
        await fetchAnimeProject();
      } else {
        console.error(data.error);
        setActionError(data.error || '创建动漫项目失败');
      }
    } catch (error) {
      console.error('Failed to create anime project:', error);
      console.error('创建失败', error);
      setActionError(`创建失败：${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // Start generation for all (legacy/batch)
  const handleGenerateAll = async () => {
    if (!animeProject || !isConfigured) return;

    setActionError(null);
    setGenerating(true);

    try {
      const data = await requestJson<{ success: boolean; error?: string }>(`/api/anime/projects/${animeProject.id}/generate`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          ...getAIConfigHeaders(aiConfig),
        },
        body: JSON.stringify({}),
      });
      if (data.success) {
        await fetchAnimeProject();
      } else {
        setActionError(data.error || '批量生成失败');
      }
    } catch (error) {
      console.error('Generation failed:', error);
      setActionError(`批量生成失败：${(error as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  // Generate single episode
  const handleGenerateEpisode = async (episode: AnimeEpisode) => {
    if (!animeProject || !isConfigured) return;

    setActionError(null);
    setGeneratingEpisodeId(episode.id);

    try {
      const data = await requestJson<{ success: boolean; errors?: string[]; error?: string }>(`/api/anime/projects/${animeProject.id}/generate`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          ...getAIConfigHeaders(aiConfig),
        },
        body: JSON.stringify({
           startEpisode: episode.episode_num,
           endEpisode: episode.episode_num 
        }),
      });
      if (data.success) {
        await fetchAnimeProject();
      } else {
         console.error('Episode generation error:', data.errors);
         setActionError(data.error || data.errors?.join?.('；') || '分集生成失败');
      }
    } catch (error) {
      console.error('Episode generation failed:', error);
      setActionError(`分集生成失败：${(error as Error).message}`);
    } finally {
      setGeneratingEpisodeId(null);
    }
  };


  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done': return 'bg-green-500/10 text-green-400 border-green-500/20';
      case 'error': return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'processing': case 'script': case 'storyboard': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      default: return 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50';
    }
  };
  

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return '待处理';
      case 'script': return '生成剧本中';
      case 'storyboard': return '生成分镜中';
      case 'audio': return '生成音频中';
      case 'video': return '生成视频中';
      case 'processing': return '处理中';
      case 'done': return '已完成';
      case 'error': return '错误';
      default: return status;
    }
  };

  const doneCount = episodes.filter(e => e.status === 'done').length;
  const progress = episodes.length > 0 ? (doneCount / episodes.length) * 100 : 0;

  // Estimate words per episode to hint duration
  const wordsPerEpisode = Math.round((project.chapters.length * 2000) / (totalEpisodes || 1));
  const storyboardData = useMemo(() => {
    if (selectedEpisode?.storyboard && Array.isArray(selectedEpisode.storyboard)) {
      return { shots: selectedEpisode.storyboard, parseError: false };
    }
    if (!selectedEpisode?.storyboard_json) {
      return { shots: [], parseError: false };
    }
    try {
      const parsed = JSON.parse(selectedEpisode.storyboard_json);
      return { shots: Array.isArray(parsed) ? parsed : [], parseError: false };
    } catch {
      return { shots: [], parseError: true };
    }
  }, [selectedEpisode?.storyboard, selectedEpisode?.storyboard_json]);


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
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Clapperboard className="h-8 w-8" />
            </div>
            <CardTitle className="gradient-text">将小说转换为AI动漫</CardTitle>
            <CardDescription>
              自动将《{project.name}》的 {project.chapters.length} 章内容转换为 AI 动漫视频
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {actionError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {actionError}
              </div>
            )}
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-sm">转换说明</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• 小说内容将被均匀分配到各集</li>
                <li>• AI 自动生成每集的剧本和分镜</li>
                <li>• 每集时长约 90-120 秒 (建议 300-500 字/集)</li>
                <li>• 使用 Edge TTS 生成配音</li>
              </ul>
            </div>

            {/* AI Config Status */}
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">AI 配置</span>
                {isConfigured ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    已配置 ({maskedApiKey})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-sm text-red-400">
                    <AlertTriangle className="h-4 w-4" />
                    未配置 (请在设置中配置)
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">总集数</label>
              <div className="flex items-center gap-4">
                <input
                    type="number"
                    value={totalEpisodes}
                    onChange={(e) => setTotalEpisodes(parseInt(e.target.value) || 60)}
                    min={1}
                    max={500}
                    className="flex-1 px-4 py-2 bg-muted/50 border border-border rounded-lg"
                />
                <Button 
                    variant="outline" 
                    onClick={() => {
                         // Suggest based on 400 chars per episode (approx 90-120s)
                         const totalChars = project.chapters.length * 2000;
                         const suggested = Math.ceil(totalChars / 400); 
                         setTotalEpisodes(suggested);
                    }}
                >
                    智能推荐
                </Button>
              </div>
              <p className={`text-xs mt-1 ${wordsPerEpisode > 800 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                每集约 {wordsPerEpisode} 字内容
                {wordsPerEpisode > 800 && ' (内容可能过多，建议增加集数)'}
              </p>
            </div>

            <Button
              onClick={handleCreateAnimeProject}
              disabled={loading || project.chapters.length === 0 || !isConfigured}
              className="w-full gradient-bg hover:opacity-90"
            >
              <Clapperboard className="mr-2 h-4 w-4" />
              开始创建动漫项目
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
    <div className="p-6 max-w-7xl mx-auto">
      {actionError && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold flex items-center gap-3">
            <Clapperboard className="h-8 w-8 text-primary" />
             AI 动漫生成
          </h2>
          <div className="flex items-center gap-4 mt-2">
             <p className="text-sm text-muted-foreground">
                {animeProject.name.replace('anime-', '')}
             </p>
             <Badge variant="outline" className="text-xs">
                {doneCount} / {episodes.length} 完成
             </Badge>
          </div>
        </div>
        <Button
          onClick={handleGenerateAll}
          disabled={generating || !isConfigured}
          className="gradient-bg hover:opacity-90 shadow-lg shadow-purple-500/20"
        >
          {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/>生成中...</> : <><Film className="w-4 h-4 mr-2"/>全部开始生成</>}
        </Button>
      </div>

      <Progress value={progress} className="mb-8 h-2" />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6 bg-muted/20 p-1 rounded-lg">
          <TabsTrigger value="script" className="px-6">
            <FileText className="mr-2 h-4 w-4" />
            系列剧本
          </TabsTrigger>
          <TabsTrigger value="characters" className="px-6">
            <Users className="mr-2 h-4 w-4" />
            角色库
          </TabsTrigger>
          <TabsTrigger value="episodes" className="px-6">
            <Clapperboard className="mr-2 h-4 w-4" />
            分集制作
          </TabsTrigger>
        </TabsList>

        {/* ================= SCRIPT TAB ================= */}
        <TabsContent value="script" className="space-y-4">
            <Card className="glass-card">
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>总剧本 & 系列构成</CardTitle>
                        <CardDescription>Generated global script and outline for {animeProject.name}</CardDescription>
                    </div>
                    <Button 
                        onClick={async () => {
                            if (!animeProject) return;
                            setActionError(null);
                            setGenerating(true);
                            try {
                                const data = await requestJson<{ success: boolean; error?: string }>(
                                  `/api/anime/projects/${animeProject.id}/script`,
                                  {
                                    method: 'POST',
                                    headers: { ...getAuthHeaders(), ...getAIConfigHeaders(aiConfig) }
                                  }
                                );
                                if (!data.success) {
                                  throw new Error(data.error || '生成总剧本失败');
                                }
                                await fetchAnimeProject();
                            } catch (error) {
                                setActionError(`生成总剧本失败：${(error as Error).message}`);
                            } finally {
                                setGenerating(false);
                            }
                        }}
                        disabled={generating}
                    >
                        {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <FileText className="w-4 h-4 mr-2"/>}
                        生成/更新总剧本
                    </Button>
                </CardHeader>
                <CardContent>
                    {seriesScript ? (
                        <ScrollArea className="h-[600px] w-full rounded-md border p-4 bg-muted/10">
                            <pre className="whitespace-pre-wrap font-serif text-base leading-relaxed text-foreground/90">
                                {seriesScript}
                            </pre>
                        </ScrollArea>
                    ) : (
                        <div className="text-center py-20 text-muted-foreground border-dashed border-2 rounded-lg">
                            <FileText className="w-12 h-12 mx-auto mb-4 opacity-20"/>
                            <p>暂无总剧本，请点击上方按钮生成。</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </TabsContent>

        {/* ================= CHARACTERS TAB ================= */}
        <TabsContent value="characters" className="space-y-4">
             <div className="flex justify-between items-center mb-4">
                 <h3 className="text-lg font-bold">主要角色 (Main Cast)</h3>
                 <Button 
                    onClick={async () => {
                        if (!animeProject) return;
                        setActionError(null);
                        setGenerating(true);
                        try {
                            const data = await requestJson<{ success: boolean; error?: string }>(
                              `/api/anime/projects/${animeProject.id}/characters/generate`,
                              {
                                method: 'POST',
                                headers: { ...getAuthHeaders(), ...getAIConfigHeaders(aiConfig) }
                              }
                            );
                            if (!data.success) {
                              throw new Error(data.error || '提取角色失败');
                            }
                            await fetchAnimeProject();
                        } catch (error) {
                            setActionError(`提取角色失败：${(error as Error).message}`);
                        } finally {
                            setGenerating(false);
                        }
                    }}
                    disabled={generating}
                    variant="outline"
                 >
                     <ImageIcon className="w-4 h-4 mr-2"/>
                     提取并生成角色
                 </Button>
             </div>
             
             {characters.length === 0 ? (
                 <div className="text-center py-20 text-muted-foreground border-dashed border-2 rounded-lg">
                    <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-20"/>
                    <p>暂无角色数据，请点击提取。</p>
                 </div>
             ) : (
                 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                     {characters.map(char => {
                         const isGenerating = generatingCharId === char.id;
                         
                         return (
                         <Card key={char.id} className="overflow-hidden group flex flex-col">
                             <div 
                                 className="aspect-[3/4] bg-muted relative shrink-0 cursor-pointer"
                                 onClick={() => {
                                     if (char.image_url) {
                                         setPreviewImage({ url: char.image_url, name: char.name });
                                     }
                                 }}
                             >
                                 {char.image_url ? (
                                     <img 
                                         src={char.image_url} 
                                         alt={char.name} 
                                         className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                     />
                                 ) : isGenerating ? (
                                     <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800 text-primary">
                                         <Loader2 className="w-8 h-8 animate-spin mb-2"/>
                                         <span className="text-xs">生成中...</span>
                                     </div>
                                 ) : (
                                     <div className="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-600">
                                         <span className="text-4xl">?</span>
                                     </div>
                                 )}
                                 
                                 {/* Overlay Action */}
                                 <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 flex-col">
                                      {char.image_url && (
                                          <Button 
                                              size="sm" 
                                              variant="secondary"
                                              onClick={(e) => {
                                                  e.stopPropagation();
                                                  setPreviewImage({ url: char.image_url, name: char.name });
                                              }}
                                          >
                                              <Eye className="mr-2 h-4 w-4" />
                                              预览大图
                                          </Button>
                                      )}
                                      <Button 
                                          size="sm" 
                                          variant={char.status === 'generated' ? 'outline' : 'default'}
                                          disabled={isGenerating}
                                          onClick={async (e) => {
                                              e.stopPropagation();
                                              if (!animeProject) return;
                                              setActionError(null);
                                              setGeneratingCharId(char.id);
                                              try {
                                                  const data = await requestJson<{ success: boolean; error?: string }>(
                                                    `/api/anime/projects/${animeProject.id}/characters/${char.id}/image`,
                                                    {
                                                      method: 'POST',
                                                      headers: { ...getAuthHeaders(), ...getAIConfigHeaders(aiConfig) }
                                                    }
                                                  );
                                                  if (!data.success) {
                                                    throw new Error(data.error || '角色立绘生成失败');
                                                  }
                                                  await fetchAnimeProject();
                                              } catch (error) {
                                                  setActionError(`角色立绘生成失败：${(error as Error).message}`);
                                              } finally {
                                                  setGeneratingCharId(null);
                                              }
                                          }}
                                      >
                                          {isGenerating ? (
                                              <><Loader2 className="w-3 h-3 mr-1 animate-spin"/> 生成中...</>
                                          ) : char.status === 'generated' ? (
                                              <>
                                                <RefreshCw className="mr-1 h-3 w-3" />
                                                重新生成
                                              </>
                                          ) : (
                                              <>
                                                <Sparkles className="mr-1 h-3 w-3" />
                                                生成立绘
                                              </>
                                          )}
                                      </Button>
                                 </div>
                             </div>
                             <CardContent className="p-3 flex-1 flex flex-col gap-2">
                                 <div className="font-bold">{char.name}</div>
                                 <p className="text-xs text-muted-foreground line-clamp-2 mb-auto">{char.description}</p>
                                 
                                 {/* Voice Selector */}
                                 <div className="mt-2">
                                     <label className="text-[10px] font-bold text-muted-foreground uppercase">Voice</label>
                                     <select 
                                        className="w-full text-xs bg-muted/50 border border-border rounded px-2 py-1 mt-1"
                                        value={char.voice_id || ''}
                                        onChange={async (e) => {
                                            if (!animeProject) return;
                                            const voiceId = e.target.value;
                                            setActionError(null);
                                            const previousVoiceId = char.voice_id || '';
                                            setCharacters(prev => prev.map(c => c.id === char.id ? { ...c, voice_id: voiceId } : c));
                                            
                                            try {
                                              const data = await requestJson<{ success: boolean; error?: string }>(
                                                `/api/anime/projects/${animeProject.id}/characters/${char.id}`,
                                                {
                                                  method: 'PATCH',
                                                  headers: {
                                                    'Content-Type': 'application/json',
                                                    ...getAuthHeaders()
                                                  },
                                                  body: JSON.stringify({ voiceId })
                                                }
                                              );
                                              if (!data.success) {
                                                throw new Error(data.error || '更新角色配音失败');
                                              }
                                            } catch (error) {
                                              setCharacters(prev => prev.map(c => c.id === char.id ? { ...c, voice_id: previousVoiceId } : c));
                                              setActionError(`更新角色配音失败：${(error as Error).message}`);
                                            }
                                        }}
                                     >
                                        <option value="">No Voice Assigned</option>
                                        {voices.map((v: any) => (
                                            <option key={v.id} value={v.id}>{v.name} ({v.gender})</option>
                                        ))}
                                     </select>
                                 </div>
                             </CardContent>
                         </Card>
                         );
                     })}
                 </div>
             )}
             
             {/* Image Preview Dialog */}
             <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
                 <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 bg-black/95 border-zinc-800 overflow-hidden">
                     <DialogHeader className="sr-only">
                         <DialogTitle>{previewImage?.name}</DialogTitle>
                         <DialogDescription>角色立绘预览</DialogDescription>
                     </DialogHeader>
                     <div className="relative w-full h-full flex items-center justify-center p-4">
                         {previewImage && (
                             <img 
                                 src={previewImage.url} 
                                 alt={previewImage.name}
                                 className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
                             />
                         )}
                         <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/80 px-4 py-2 rounded-full text-white text-sm backdrop-blur">
                             {previewImage?.name}
                         </div>
                     </div>
                 </DialogContent>
             </Dialog>
        </TabsContent>

        {/* ================= EPISODES TAB ================= */}
        <TabsContent value="episodes" className="space-y-4">
            <div className="flex justify-between items-center mb-4">
                 <h3 className="text-lg font-bold">分集制作进度</h3>
            </div>
            {/* List Layout */}
            <div className="space-y-3">
                {episodes.map(episode => (
                <button
                    type="button"
                    key={episode.id}
                    onClick={() => handleEpisodeClick(episode)}
                    className={`
                    group relative overflow-hidden rounded-xl border border-border/50 bg-card/50 p-4 
                    hover:bg-accent/50 hover:border-accent transition-all cursor-pointer flex items-center gap-4
                    ${selectedEpisode?.id === episode.id ? 'ring-2 ring-primary border-transparent' : ''}
                    `}
                >
                    {/* Episode Number - Left Highlight */}
                    <div className={`
                        flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border 
                        ${getStatusColor(episode.status)}
                    `}>
                    <span className="font-bold text-lg">{episode.episode_num}</span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">
                            第 {episode.episode_num} 集
                        </h3>
                        <Badge variant="outline" className={`text-xs h-5 px-2 ${getStatusColor(episode.status)} border-0`}>
                            {getStatusText(episode.status)}
                        </Badge>
                    </div>
                    
                    {/* HIDE ERROR IF DONE */}
                    <p className={`text-xs truncate w-full ${episode.status === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}>
                        {episode.status === 'done' 
                            ? '生成完成，点击查看详情' 
                            : (episode.error_message || '等待生成')
                        }
                    </p>
                    </div>

                    {/* Actions/Icons */}
                    <div className="flex items-center gap-2 text-muted-foreground">
                        {episode.script && <FileText className="w-4 h-4" />}
                        {episode.storyboard_json && <ImageIcon className="w-4 h-4" />}
                        {episode.status === 'done' && <Play className="w-4 h-4 text-green-400" />}
                    </div>
                    
                    {/* Hover indicator */}
                    <div className="absolute right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">
                          查看详情
                        </span>
                    </div>
                </button>
                ))}
            </div>

            {episodes.length === 0 && (
                <div className="text-center py-20 text-muted-foreground bg-muted/20 rounded-xl border border-dashed">
                <Film className="mx-auto mb-4 h-12 w-12 opacity-30" />
                <p className="text-lg">暂无集数数据</p>
                </div>
            )}
        </TabsContent>
        </Tabs>


      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-5xl h-[90vh] glass-card flex flex-col p-0 overflow-hidden gap-0">
          <DialogHeader className="px-6 py-4 border-b bg-muted/10 shrink-0">
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <DialogTitle className="flex items-center gap-3 text-xl">
                    <span className="inline-flex items-center gap-2">
                      <Clapperboard className="h-5 w-5 text-primary" />
                      第 {selectedEpisode?.episode_num} 集
                    </span>
                    {selectedEpisode?.status === 'done' && 
                        <Badge className="bg-green-500/20 text-green-400 hover:bg-green-500/30 border-0">Completed</Badge>
                    }
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                    {selectedEpisode?.id}
                    </DialogDescription>
                </div>
                
                {/* Header Actions */}
                <div className="flex items-center gap-2">
                    <Button 
                        size="sm" 
                        variant="default"
                        className="gradient-bg"
                        disabled={generatingEpisodeId === selectedEpisode?.id || selectedEpisode?.status === 'processing'}
                        onClick={(e) => {
                            e.stopPropagation();
                            if(selectedEpisode) handleGenerateEpisode(selectedEpisode);
                        }}
                    >
                        {generatingEpisodeId === selectedEpisode?.id ? (
                            <><Loader2 className="w-3 h-3 mr-2 animate-spin"/> 处理中...</>
                        ) : (
                            <><Film className="w-3 h-3 mr-2"/> 生成/重新生成视频</>
                        )}
                    </Button>
                </div>
            </div>
          </DialogHeader>

          <Tabs defaultValue="video" className="flex-1 flex flex-col min-h-0 w-full">
            <div className="px-6 border-b bg-muted/5">
                <TabsList className="w-full justify-start h-12 bg-transparent p-0 gap-6">
                    <TabsTrigger value="script" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-0 pb-2 pt-2">
                        <FileText className="mr-2 h-4 w-4" />
                        剧本
                    </TabsTrigger>
                    <TabsTrigger value="storyboard" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-0 pb-2 pt-2">
                        <ImageIcon className="mr-2 h-4 w-4" />
                        分镜
                    </TabsTrigger>
                     <TabsTrigger value="video" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-0 pb-2 pt-2">
                        <Film className="mr-2 h-4 w-4" />
                        视频
                    </TabsTrigger>
                </TabsList>
            </div>

            <div className="flex-1 overflow-hidden bg-background/50">
                <TabsContent value="script" className="h-full m-0">
                <ScrollArea className="h-full w-full p-6">
                    {selectedEpisode?.script ? (
                    <div className="max-w-3xl mx-auto bg-card border rounded-lg p-8 shadow-sm">
                        <pre className="whitespace-pre-wrap font-serif text-base leading-loose text-foreground/90">
                            {selectedEpisode.script}
                        </pre>
                    </div>
                    ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 text-center">
                        <FileText className="w-12 h-12 opacity-20"/>
                        <p>暂无剧本数据</p>
                        <Button variant="outline" size="sm" onClick={() => selectedEpisode && handleGenerateEpisode(selectedEpisode)}>
                            点击生成
                        </Button>
                    </div>
                    )}
                </ScrollArea>
                </TabsContent>

                <TabsContent value="storyboard" className="h-full m-0">
                <ScrollArea className="h-full w-full p-6">
                    {storyboardData.shots.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                        {storyboardData.shots.map((shot: any, idx: number) => (
                        <Card key={idx} className="overflow-hidden border-border/50 bg-card/50 hover:bg-card hover:border-primary/20 transition-all">
                            <div className="aspect-video bg-muted/30 flex items-center justify-center relative group">
                                <span className="text-4xl opacity-10 font-black">SHOT {shot.shot_id}</span>
                                <Badge className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 border-0">{shot.duration}s</Badge>
                            </div>
                            <CardContent className="p-4 space-y-3">
                                <div>
                                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Visual</div>
                                    <p className="text-sm leading-relaxed">{shot.description}</p>
                                </div>
                                {shot.dialogue && (
                                    <div className="bg-primary/5 p-2 rounded border-l-2 border-primary/50">
                                        <div className="text-[10px] font-bold text-primary mb-0.5">AUDIO</div>
                                        <p className="text-sm italic opacity-80">"{shot.dialogue}"</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                        ))}
                    </div>
                    ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 text-center">
                        <ImageIcon className="w-12 h-12 opacity-20"/>
                        <p>{storyboardData.parseError ? '分镜数据格式异常，请重新生成。' : '暂无分镜数据'}</p>
                        <Button variant="outline" size="sm" onClick={() => selectedEpisode && handleGenerateEpisode(selectedEpisode)}>
                            点击生成
                        </Button>
                    </div>
                    )}
                </ScrollArea>
                </TabsContent>

                 <TabsContent value="video" className="h-full m-0 bg-black/90 flex flex-col items-center justify-center relative">
                    {selectedEpisode?.video_r2_key ? (
                         <div className="w-full h-full flex items-center justify-center">
                            {/* Placeholder for video player - replace with real player when R2 url is ready */}
                            <video 
                                controls 
                                className="max-w-full max-h-full aspect-video shadow-2xl"
                                poster="/placeholder-video-poster.png" 
                            >
                                <source src={`/api/anime/projects/${animeProject?.id}/episodes/${selectedEpisode.episode_num}/video`} type="video/mp4" />
                                您的浏览器不支持视频播放。
                            </video>
                         </div>
                    ) : (
                        <div className="text-center space-y-4 max-w-md p-6 bg-zinc-900/50 rounded-xl border border-white/10 backdrop-blur">
                            <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto animate-pulse">
                                {selectedEpisode?.status === 'done' ? (
                                     <Play className="w-10 h-10 text-green-400" />
                                ) : (
                                     <Film className="w-10 h-10 text-primary" />
                                )}
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-white mb-2">
                                   {selectedEpisode?.status === 'done' ? '视频生成模拟完成' : '视频未生成'}
                                </h3>
                                <p className="text-zinc-400 text-sm">
                                    {selectedEpisode?.status === 'done' 
                                        ? '后端已完成流程 (模拟)。这只是演示，因为 Veo API 上未集成。' 
                                        : selectedEpisode?.status === 'processing' || selectedEpisode?.status === 'starting' || selectedEpisode?.status === 'analyzing' 
                                        ? 'AI 正在努力生成中，请耐心等待...' 
                                        : '点击下方按钮开始生成本集视频'}
                                </p>
                            </div>
                            
                            {(selectedEpisode?.status !== 'processing' && selectedEpisode?.status !== 'done') && (
                                <Button 
                                    size="lg" 
                                    className="w-full gradient-bg mt-4"
                                    onClick={() => selectedEpisode && handleGenerateEpisode(selectedEpisode)}
                                >
                                    <Film className="mr-2 h-4 w-4" />
                                    开始生成视频
                                </Button>
                            )}
                            
                             {selectedEpisode?.status === 'done' && (
                                <Button 
                                    size="lg" 
                                    className="w-full bg-zinc-800 hover:bg-zinc-700 mt-4 border border-zinc-700"
                                    onClick={() => selectedEpisode && handleGenerateEpisode(selectedEpisode)}
                                >
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    重新生成
                                </Button>
                            )}
                        </div>
                    )}
                 </TabsContent>
            </div>

          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
