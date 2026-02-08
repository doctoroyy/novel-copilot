
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';
import { getAuthHeaders } from '@/lib/auth';
import { Film, Loader2, ArrowLeft, RefreshCw, FileText, Layout, PauseCircle, Trash2, Sparkles } from 'lucide-react';

interface AnimeEpisodeDetailProps {
  project: any;
  episodeId: string;
  onBack: () => void;
}

export function AnimeEpisodeDetail({ project, episodeId, onBack }: AnimeEpisodeDetailProps) {
  const { config: aiConfig, isConfigured } = useAIConfig();
  const [episode, setEpisode] = useState<any | null>(null);
  const [animeProject, setAnimeProject] = useState<any | null>(null);
  const [, setLoading] = useState(true);
  
  // Action states - separate for each action type
  const [generatingScript, setGeneratingScript] = useState(false);
  const [generatingStoryboard, setGeneratingStoryboard] = useState(false);
  const [generatingVideo, setGeneratingVideo] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const projectsRes = await fetch(`/api/anime/projects?novelProject=${encodeURIComponent(project.name)}`, {
            headers: getAuthHeaders()
        });
        const projectsData = await projectsRes.json();
        const anime = projectsData.projects?.find((p: any) => p.name === `anime-${project.name}`);
        
        if (anime) {
            setAnimeProject(anime);
            const epNum = parseInt(episodeId); 
            const epRes = await fetch(`/api/anime/projects/${anime.id}/episodes/${epNum}`, {
                headers: getAuthHeaders()
            });
            const epData = await epRes.json();
            
            if (epData.success && epData.episode) {
                setEpisode(epData.episode);
            }
        }
      } catch (error) {
        console.error("Failed to load episode", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [project.name, episodeId]);

  // Reload episode data
  const reloadEpisode = async () => {
      if(!animeProject || !episode) return;
      const res = await fetch(`/api/anime/projects/${animeProject.id}/episodes/${episode.episode_num}`, {
          headers: getAuthHeaders()
      });
      const data = await res.json();
      if(data.success) setEpisode(data.episode);
      return data.episode?.status;
  };

  // Poll for processing status
  const pollUntilComplete = async (setProcessing: (v: boolean) => void) => {
      const status = await reloadEpisode();
      if(status === 'processing') {
          setTimeout(() => pollUntilComplete(setProcessing), 2000);
      } else {
          setProcessing(false);
      }
  };

  // Generate Script
  const handleGenerateScript = async () => {
      if (!animeProject || !episode || !isConfigured) return;
      setGeneratingScript(true);
      try {
          await fetch(`/api/anime/projects/${animeProject.id}/episodes/${episode.episode_num}/generate/script`, {
              method: 'POST',
              headers: { ...getAuthHeaders(), ...getAIConfigHeaders(aiConfig) }
          });
          pollUntilComplete(setGeneratingScript);
      } catch (e) {
          console.error(e);
          setGeneratingScript(false);
      }
  };

  // Generate Storyboard
  const handleGenerateStoryboard = async () => {
      if (!animeProject || !episode || !isConfigured) return;
      setGeneratingStoryboard(true);
      try {
          await fetch(`/api/anime/projects/${animeProject.id}/episodes/${episode.episode_num}/generate/storyboard`, {
              method: 'POST',
              headers: { ...getAuthHeaders(), ...getAIConfigHeaders(aiConfig) }
          });
          pollUntilComplete(setGeneratingStoryboard);
      } catch (e) {
          console.error(e);
          setGeneratingStoryboard(false);
      }
  };

  // Generate Video
  const handleGenerateVideo = async () => {
      if (!animeProject || !episode || !isConfigured) return;
      setGeneratingVideo(true);
      try {
          await fetch(`/api/anime/projects/${animeProject.id}/episodes/${episode.episode_num}/generate/video`, {
              method: 'POST',
              headers: { ...getAuthHeaders(), ...getAIConfigHeaders(aiConfig) }
          });
          pollUntilComplete(setGeneratingVideo);
      } catch (e) {
          console.error(e);
          setGeneratingVideo(false);
      }
  };

  // Cancel generation
  const handleCancel = async () => {
      if (!animeProject || !episode) return;
      await fetch(`/api/anime/projects/${animeProject.id}/episodes/${episode.episode_num}/cancel`, {
          method: 'POST',
          headers: getAuthHeaders()
      });
      reloadEpisode();
      setGeneratingScript(false);
      setGeneratingStoryboard(false);
      setGeneratingVideo(false);
  };

  // Delete content
  const handleDeleteContent = async () => {
      if (!animeProject || !episode) return;
      if(!confirm('确认删除该集所有生成内容？')) return;
      await fetch(`/api/anime/projects/${animeProject.id}/episodes/${episode.episode_num}/content`, {
          method: 'DELETE',
          headers: getAuthHeaders()
      });
      reloadEpisode();
  };

  // Loading state
  if (!episode) {
    return (
      <div className="h-full flex flex-col bg-background items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground">加载中...</p>
        <Button variant="ghost" className="mt-4" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" /> 返回
        </Button>
      </div>
    );
  }

  const isProcessing = episode?.status === 'processing' || generatingScript || generatingStoryboard || generatingVideo;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="h-16 border-b flex items-center px-6 gap-4 bg-muted/10 shrink-0">
         <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-5 h-5"/>
         </Button>
         <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
                第 {episode?.episode_num} 集
                {episode?.status === 'done' && <Badge variant="secondary" className="bg-green-500/10 text-green-500">已完成</Badge>}
                {isProcessing && <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 animate-pulse">生成中...</Badge>}
                {episode?.status === 'stopped' && <Badge variant="outline" className="text-yellow-600">已暂停</Badge>}
            </h2>
         </div>
         <div className="ml-auto flex items-center gap-2">
            {/* Delete / Reset */}
            <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={handleDeleteContent}>
                <Trash2 className="w-4 h-4"/>
            </Button>

            {/* Stop */}
            {isProcessing && (
                <Button variant="outline" size="sm" onClick={handleCancel} className="text-yellow-600 gap-2 border-yellow-200 bg-yellow-50">
                    <PauseCircle className="w-4 h-4"/> 暂停
                </Button>
            )}
         </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="script" className="h-full flex flex-col">
            <div className="px-6 border-b bg-muted/5 shrink-0">
                <TabsList className="h-12 bg-transparent p-0 gap-6">
                    <TabsTrigger value="script" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">
                        📜 剧本
                    </TabsTrigger>
                    <TabsTrigger value="storyboard" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">
                        🖼️ 分镜
                    </TabsTrigger>
                     <TabsTrigger value="video" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4">
                        🎥 视频
                    </TabsTrigger>
                </TabsList>
            </div>

            {/* ============ SCRIPT TAB ============ */}
            <TabsContent value="script" className="flex-1 m-0 overflow-hidden">
                <ScrollArea className="h-full">
                    <div className="p-8 max-w-4xl mx-auto">
                        {/* Action Bar */}
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-semibold">剧本内容</h3>
                            <Button 
                                onClick={handleGenerateScript} 
                                disabled={generatingScript || isProcessing}
                                className="gap-2"
                            >
                                {generatingScript ? (
                                    <><Loader2 className="w-4 h-4 animate-spin"/> 生成中...</>
                                ) : (
                                    <><Sparkles className="w-4 h-4"/> {episode.script ? '重新生成剧本' : '生成剧本'}</>
                                )}
                            </Button>
                        </div>
                        
                        {episode.script ? (
                            <div className="bg-card border rounded-lg p-8 shadow-sm">
                                <pre className="whitespace-pre-wrap font-serif text-base leading-loose opacity-90">{episode.script}</pre>
                            </div>
                        ) : (
                            <div className="text-center py-20 text-muted-foreground border-2 border-dashed rounded-lg">
                                <FileText className="w-12 h-12 mx-auto mb-4 opacity-20"/>
                                <p className="mb-4">暂无剧本内容</p>
                                <Button onClick={handleGenerateScript} disabled={generatingScript}>
                                    <Sparkles className="w-4 h-4 mr-2"/> 点击生成剧本
                                </Button>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </TabsContent>

            {/* ============ STORYBOARD TAB ============ */}
            <TabsContent value="storyboard" className="flex-1 m-0 overflow-hidden">
                <ScrollArea className="h-full">
                    <div className="p-6">
                        {/* Action Bar */}
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-semibold">分镜脚本</h3>
                            <Button 
                                onClick={handleGenerateStoryboard} 
                                disabled={generatingStoryboard || isProcessing || !episode.script}
                                className="gap-2"
                            >
                                {generatingStoryboard ? (
                                    <><Loader2 className="w-4 h-4 animate-spin"/> 生成中...</>
                                ) : (
                                    <><Layout className="w-4 h-4"/> {episode.storyboard_json ? '重新生成分镜' : '生成分镜'}</>
                                )}
                            </Button>
                        </div>
                        
                        {!episode.script && (
                            <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 p-4 rounded-lg mb-6 text-sm">
                                ⚠️ 请先生成剧本后再生成分镜
                            </div>
                        )}
                        
                        {episode.storyboard_json ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
                                 {(JSON.parse(episode.storyboard_json || '[]')).map((shot: any, idx: number) => (
                                    <Card key={idx} className="overflow-hidden bg-card/50">
                                        <div className="aspect-video bg-muted/30 flex items-center justify-center relative">
                                            <span className="text-4xl opacity-10 font-black">{shot.shot_id}</span>
                                            <Badge className="absolute top-2 right-2 bg-black/50">{shot.duration}s</Badge>
                                        </div>
                                        <CardContent className="p-4 space-y-2">
                                            <p className="text-sm">{shot.description || shot.visual_description}</p>
                                            {(shot.dialogue || shot.narration_text) && (
                                                <div className="text-xs italic opacity-70 border-l-2 border-primary pl-2">
                                                    "{shot.dialogue || shot.narration_text}"
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                 ))}
                            </div>
                        ) : (
                            <div className="text-center py-20 text-muted-foreground border-2 border-dashed rounded-lg">
                                <Layout className="w-12 h-12 mx-auto mb-4 opacity-20"/>
                                <p className="mb-4">暂无分镜数据</p>
                                {episode.script && (
                                    <Button onClick={handleGenerateStoryboard} disabled={generatingStoryboard}>
                                        <Layout className="w-4 h-4 mr-2"/> 点击生成分镜
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </TabsContent>

            {/* ============ VIDEO TAB ============ */}
            <TabsContent value="video" className="flex-1 m-0 overflow-hidden bg-black/95">
                <ScrollArea className="h-full">
                    <div className="p-6">
                        {/* Action Bar */}
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-white">视频预览</h3>
                            <div className="flex gap-2">
                                <Button 
                                    onClick={handleGenerateVideo} 
                                    disabled={generatingVideo || isProcessing || !episode.storyboard_json}
                                    className="gradient-bg gap-2"
                                >
                                    {generatingVideo ? (
                                        <><Loader2 className="w-4 h-4 animate-spin"/> 生成中...</>
                                    ) : (
                                        <><Film className="w-4 h-4"/> {episode.status === 'done' ? '重新生成视频' : '生成视频'}</>
                                    )}
                                </Button>
                                <Button variant="outline" className="gap-2" disabled>
                                    合并视频 (Coming Soon)
                                </Button>
                            </div>
                        </div>

                        {!episode.storyboard_json && (
                            <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 p-4 rounded-lg mb-6 text-sm">
                                ⚠️ 请先生成分镜后再生成视频
                            </div>
                        )}

                        {episode.storyboard_json ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
                                 {(JSON.parse(episode.storyboard_json || '[]')).map((shot: any, idx: number) => {
                                     const videoUrl = `/api/anime/projects/${animeProject?.id}/episodes/${episode.episode_num}/shots/${shot.shot_id}/video`;
                                     const audioUrl = `/api/anime/projects/${animeProject?.id}/episodes/${episode.episode_num}/shots/${shot.shot_id}/audio`;
                                     const hasVideo = !!shot.video_key;
                                     const hasAudio = !!shot.audio_key;

                                     return (
                                        <div key={idx} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden flex flex-col">
                                            <div className="relative aspect-video bg-black flex items-center justify-center">
                                                {hasVideo ? (
                                                    <video controls className="w-full h-full object-contain">
                                                        <source src={videoUrl} type="video/mp4" />
                                                    </video>
                                                ) : shot.status === 'error' ? (
                                                    <div className="text-red-500 flex flex-col items-center p-4 text-center">
                                                        <Film className="w-8 h-8 mb-2 opacity-50"/>
                                                        <span className="text-xs font-bold">生成失败</span>
                                                        <span className="text-[10px] mt-1 opacity-80 max-w-full truncate px-2" title={shot.error}>
                                                            {shot.error || '未知错误'}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="text-zinc-700 flex flex-col items-center">
                                                        <Film className="w-8 h-8 mb-2 opacity-50"/>
                                                        <span className="text-xs">等待生成...</span>
                                                    </div>
                                                )}
                                                <Badge className="absolute top-2 left-2 bg-black/60 backdrop-blur text-white border-0">
                                                    Shot {shot.shot_id}
                                                </Badge>
                                                <Badge className="absolute top-2 right-2 bg-primary/80 text-white border-0">
                                                    {shot.duration}s
                                                </Badge>
                                            </div>
                                            
                                            <div className="p-3 space-y-2 flex-1 flex flex-col">
                                                <p className="text-xs text-zinc-400 line-clamp-2" title={shot.description}>
                                                    {shot.description || shot.visual_description}
                                                </p>
                                                {hasAudio && (
                                                    <audio controls className="w-full h-6 mt-1 opacity-60 hover:opacity-100 transition-opacity">
                                                        <source src={audioUrl} type="audio/mpeg" />
                                                    </audio>
                                                )}
                                                <div className="flex items-center justify-between mt-auto">
                                                    <div className="text-[10px] text-zinc-600 font-mono">
                                                        Motion: {shot.action || shot.action_motion}
                                                    </div>
                                                    <Button 
                                                        size="icon" 
                                                        variant="ghost" 
                                                        className="h-6 w-6 hover:bg-white/10"
                                                        title="Regenerate this shot"
                                                        onClick={async () => {
                                                            try {
                                                                await fetch(`/api/anime/projects/${animeProject?.id}/episodes/${episode.episode_num}/shots/${shot.shot_id}/regenerate`, {
                                                                    method: 'POST',
                                                                    headers: { ...getAuthHeaders(), ...getAIConfigHeaders(aiConfig) }
                                                                });
                                                                reloadEpisode();
                                                            } catch (e) {
                                                                console.error(e);
                                                            }
                                                        }}
                                                    >
                                                        <RefreshCw className="w-3 h-3 text-zinc-400" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                     );
                                 })}
                            </div>
                        ) : (
                            <div className="text-center py-20 text-muted-foreground border-2 border-dashed border-zinc-700 rounded-lg">
                                <Film className="w-12 h-12 mx-auto mb-4 opacity-20"/>
                                <p>请先生成分镜后再生成视频</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
