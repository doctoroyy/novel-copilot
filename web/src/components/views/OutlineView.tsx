import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, RotateCw } from 'lucide-react';
import { type ProjectDetail, refineOutline } from '@/lib/api';

interface OutlineViewProps {
  project: ProjectDetail;
}

export function OutlineView({ project }: OutlineViewProps) {
  const [isRefining, setIsRefining] = useState(false);
  const [refiningVolIdx, setRefiningVolIdx] = useState<number | null>(null);

  const handleRefine = async () => {
    try {
      setIsRefining(true);
      await refineOutline(project.name);
      
      setTimeout(() => {
        window.location.reload();
      }, 500);

    } catch (error) {
      alert(`操作失败: ${(error as Error).message}`);
    } finally {
      setIsRefining(false);
    }
  };

  const handleRefineVolume = async (volIndex: number) => {
    try {
      setRefiningVolIdx(volIndex);
      // Explicitly pass volumeIndex to force regeneration of this volume
      await refineOutline(project.name, volIndex);
      
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      alert(`操作失败: ${(error as Error).message}`);
    } finally {
      setRefiningVolIdx(null);
    }
  };

  if (!project.outline) {
    return (
      <div className="p-4 lg:p-6">
        <Card className="glass-card">
          <CardContent className="p-8 lg:p-12 text-center text-muted-foreground">
            <div className="text-4xl lg:text-5xl mb-4">📋</div>
            <p className="text-base lg:text-lg font-medium mb-2">尚未生成大纲</p>
            <p className="text-xs lg:text-sm">前往"生成"标签页创建大纲</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { outline } = project;
  const isBusy = isRefining || refiningVolIdx !== null;

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Main Goal */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base lg:text-lg">
            <span>🎯</span>
            <span>主线目标</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-xs lg:text-sm">{outline.mainGoal}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="secondary" className="text-xs">{outline.totalChapters} 章</Badge>
            <Badge variant="secondary" className="text-xs">{outline.targetWordCount} 万字</Badge>
            <Badge variant="secondary" className="text-xs">{outline.volumes.length} 卷</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Milestones */}
      {outline.milestones && outline.milestones.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base lg:text-lg">
              <span>🏆</span>
              <span>里程碑</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {outline.milestones.map((milestone, i) => {
                // Handle both string and object formats from LLM
                const milestoneText = typeof milestone === 'string' 
                  ? milestone 
                  : (milestone as any).milestone || (milestone as any).description || JSON.stringify(milestone);
                return (
                  <div key={i} className="flex items-start gap-3 p-2">
                    <span className="text-primary">•</span>
                    <span className="text-xs lg:text-sm text-muted-foreground">{milestoneText}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Volumes */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium flex items-center gap-2 text-sm lg:text-base">
            <span>📚</span>
            <span>卷目结构</span>
          </h3>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefine}
            disabled={isBusy}
            className="h-8 text-xs lg:text-sm"
          >
            {isRefining ? (
              <Loader2 className="mr-2 h-3 w-3 lg:h-4 lg:w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-3 w-3 lg:h-4 lg:w-4 text-yellow-500" />
            )}
            完善缺失章节
          </Button>
        </div>
        
        <ScrollArea className="h-[calc(100vh-400px)] lg:h-[calc(100vh-450px)]">
          <div className="space-y-4 pr-2 lg:pr-4">
            {outline.volumes.map((vol, volIndex) => (
              <Card key={volIndex} className="glass-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm lg:text-base flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="text-xs shrink-0">第 {volIndex + 1} 卷</Badge>
                      <span className="truncate">{vol.title}</span>
                    </CardTitle>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {vol.startChapter}-{vol.endChapter}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 lg:h-8 lg:w-8"
                        title="重新生成本卷章节"
                        onClick={() => handleRefineVolume(volIndex)}
                        disabled={isBusy}
                      >
                         <RotateCw className={`h-3 w-3 lg:h-4 lg:w-4 ${refiningVolIdx === volIndex ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 lg:gap-3 text-xs lg:text-sm">
                    <div className="p-2 rounded-lg bg-muted/30">
                      <span className="text-xs text-muted-foreground">目标</span>
                      <p className="truncate text-xs lg:text-sm">{vol.goal}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/30">
                      <span className="text-xs text-muted-foreground">冲突</span>
                      <p className="truncate text-xs lg:text-sm">{vol.conflict}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/30">
                      <span className="text-xs text-muted-foreground">高潮</span>
                      <p className="truncate text-xs lg:text-sm">{vol.climax}</p>
                    </div>
                  </div>
                  
                  {/* Chapter list (collapsed by default, show first few) */}
                  <details className="group">
                    <summary className="cursor-pointer text-xs lg:text-sm text-muted-foreground hover:text-foreground">
                      查看 {vol.chapters.length} 章详情 →
                    </summary>
                    <div className="mt-3 space-y-1.5 pl-2 border-l-2 border-primary/30">
                      {vol.chapters.map((ch, chIdx) => (
                        <div key={ch.index || chIdx} className="text-xs lg:text-sm py-1">
                          <span className="text-muted-foreground mr-2">第{ch.index}章</span>
                          <span className="font-medium">{ch.title}</span>
                          {ch.goal && (
                            <p className="text-xs text-muted-foreground mt-0.5 ml-8 lg:ml-12">{ch.goal}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
