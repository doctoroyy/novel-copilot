
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';
import { Film, Loader2, ArrowLeft, RefreshCw, FileText, Layout, PauseCircle, Trash2 } from 'lucide-react';

// ... (imports remain)

interface AnimeEpisodeDetailProps {
  project: any;
  episodeId: string;
  onBack: () => void;
}

export function AnimeEpisodeDetail({ project, episodeId, onBack }: AnimeEpisodeDetailProps) {
  const { config: aiConfig, isConfigured } = useAIConfig();
  const [episode, setEpisode] = useState<any | null>(null);
  const [animeProject, setAnimeProject] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Action states
  const [processing, setProcessing] = useState(false);

  // ... (useEffect loadData remains)

  // Actions
  const reloadEpisode = async () => {
      if(!animeProject || !episode) return;
      const res = await fetch(`/api/anime/projects/${animeProject.id}/episodes/${episode.episode_num}`);
      const data = await res.json();
      if(data.success) setEpisode(data.episode);
      if(data.episode.status === 'processing') {
          setTimeout(reloadEpisode, 2000); // Poll if processing
      } else {
          setProcessing(false);
      }
  };

  const runAction = async (action: string) => {
      if (!animeProject || !episode || !isConfigured) return;
      setProcessing(true);
      try {
          await fetch(`/api/anime/projects/${animeProject.id}/episodes/${episode.episode_num}/${action}`, {
              method: action === 'content' ? 'DELETE' : 'POST', // content is for delete
              headers: getAIConfigHeaders(aiConfig)
          });
          reloadEpisode();
      } catch (e) {
          console.error(e);
          setProcessing(false);
      }
  };

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
                {episode?.status === 'processing' && <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 animate-pulse">生成中...</Badge>}
                {episode?.status === 'stopped' && <Badge variant="outline" className="text-yellow-600">已暂停</Badge>}
            </h2>
         </div>
         <div className="ml-auto flex items-center gap-2">
            {/* Delete / Reset */}
            <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => {
                if(confirm('Confirm delete all generated content for this episode?')) runAction('content');
            }}>
                <Trash2 className="w-4 h-4"/>
            </Button>

            {/* Stop */}
            {episode?.status === 'processing' && (
                <Button variant="outline" size="sm" onClick={() => runAction('cancel')} className="text-yellow-600 gap-2 border-yellow-200 bg-yellow-50">
                    <PauseCircle className="w-4 h-4"/> 暂停
                </Button>
            )}

            {/* Generation Pipeline */}
            {(!episode?.script) && (
                <Button size="sm" onClick={() => runAction('generate/script')} disabled={processing || episode?.status === 'processing'}>
                    <FileText className="w-4 h-4 mr-2"/> 生成剧本
                </Button>
            )}

            {(episode?.script && !episode?.storyboard_json) && (
                <Button size="sm" onClick={() => runAction('generate/storyboard')} disabled={processing || episode?.status === 'processing'}>
                    <Layout className="w-4 h-4 mr-2"/> 生成分镜
                </Button>
            )}

            {(episode?.storyboard_json) && (
                <Button size="sm" onClick={() => runAction('generate/video')} disabled={processing || episode?.status === 'processing'} className="gradient-bg">
                    {processing ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Film className="w-4 h-4 mr-2"/>}
                    {episode?.status === 'done' ? '重新生成视频' : '生成视频'}
                </Button>
            )}
         </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="video" className="h-full flex flex-col">
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

            <TabsContent value="script" className="flex-1 m-0 overflow-hidden">
                <ScrollArea className="h-full p-8 max-w-4xl mx-auto">
                    {episode.script ? (
                        <div className="bg-card border rounded-lg p-8 shadow-sm">
                            <pre className="whitespace-pre-wrap font-serif text-base leading-loose opacity-90">{episode.script}</pre>
                        </div>
                    ) : <div className="text-center py-20 text-muted-foreground">暂无剧本</div>}
                </ScrollArea>
            </TabsContent>

            <TabsContent value="storyboard" className="flex-1 m-0 overflow-hidden">
                <ScrollArea className="h-full p-6">
                    {episode.storyboard || episode.storyboard_json ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
                             {(episode.storyboard || JSON.parse(episode.storyboard_json || '[]')).map((shot: any, idx: number) => (
                                <Card key={idx} className="overflow-hidden bg-card/50">
                                    <div className="aspect-video bg-muted/30 flex items-center justify-center relative">
                                        <span className="text-4xl opacity-10 font-black">{shot.shot_id}</span>
                                        <Badge className="absolute top-2 right-2 bg-black/50">{shot.duration}s</Badge>
                                    </div>
                                    <CardContent className="p-4 space-y-2">
                                        <p className="text-sm">{shot.description}</p>
                                        {shot.dialogue && (
                                            <div className="text-xs italic opacity-70 border-l-2 border-primary pl-2">
                                                "{shot.dialogue}"
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                             ))}
                        </div>
                    ) : <div className="text-center py-20 text-muted-foreground">暂无分镜</div>}
                </ScrollArea>
            </TabsContent>

            <TabsContent value="video" className="flex-1 m-0 overflow-hidden bg-black/95">
                <ScrollArea className="h-full p-6">
                    <div className="flex justify-between items-center mb-6">
                         <h3 className="text-xl font-bold text-white">
                            分镜预览 ({episode.status === 'done' ? '生成的视频片段' : '生成中...'})
                         </h3>
                         <Button variant="outline" className="gap-2" disabled>
                            Generate Merged Video (Client-side FFmpeg coming soon)
                         </Button>
                    </div>

                    {episode.storyboard_json ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
                             {(JSON.parse(episode.storyboard_json || '[]')).map((shot: any, idx: number) => {
                                 const videoUrl = `/api/anime/projects/${animeProject?.id}/episodes/${episode.episode_num}/shots/${shot.shot_id}/video`;
                                 const audioUrl = `/api/anime/projects/${animeProject?.id}/episodes/${episode.episode_num}/shots/${shot.shot_id}/audio`;
                                 // Check if shot has keys before showing player? 
                                 // Actually let's try to load, if 404 browser handles it (poster or empty).
                                 // Better: Only show player if shot.video_key exists in the JSON data.
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
                                                {shot.description}
                                            </p>
                                            {hasAudio && (
                                                <audio controls className="w-full h-6 mt-1 opacity-60 hover:opacity-100 transition-opacity">
                                                    <source src={audioUrl} type="audio/mpeg" />
                                                </audio>
                                            )}
                                            <div className="flex items-center justify-between mt-auto">
                                                <div className="text-[10px] text-zinc-600 font-mono">
                                                    Motion: {shot.action}
                                                </div>
                                                <Button 
                                                    size="icon" 
                                                    variant="ghost" 
                                                    className="h-6 w-6 hover:bg-white/10"
                                                    title="Regenerate this shot"
                                                    onClick={async () => {
                                                        // Optimistically set status to pending/processing in UI?
                                                        // Or just trigger and wait for re-fetch?
                                                        // Let's force a refresh after trigger.
                                                        try {
                                                            await fetch(`/api/anime/projects/${animeProject?.id}/episodes/${episode.episode_num}/shots/${shot.shot_id}/regenerate`, {
                                                                method: 'POST',
                                                                headers: getAIConfigHeaders(aiConfig)
                                                            });
                                                            // Reload episode data
                                                            const epRes = await fetch(`/api/anime/projects/${animeProject.id}/episodes/${episode.episode_num}`);
                                                            const epData = await epRes.json();
                                                            if (epData.success) setEpisode(epData.episode);
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
                        <div className="text-center py-20 text-muted-foreground">
                            请先点击“生成视频”开始制作流程
                        </div>
                    )}
                </ScrollArea>
            </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
