import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import type { ProjectDetail } from '@/lib/types';

interface OutlineViewProps {
  project: ProjectDetail;
}

export function OutlineView({ project }: OutlineViewProps) {
  if (!project.outline) {
    return (
      <div className="p-6">
        <Card className="glass-card">
          <CardContent className="p-12 text-center text-muted-foreground">
            <div className="text-5xl mb-4">📋</div>
            <p className="text-lg font-medium mb-2">尚未生成大纲</p>
            <p className="text-sm">前往"生成"标签页创建大纲</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { outline } = project;

  return (
    <div className="p-6 space-y-6">
      {/* Main Goal */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>🎯</span>
            <span>主线目标</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{outline.mainGoal}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="secondary">{outline.totalChapters} 章</Badge>
            <Badge variant="secondary">{outline.targetWordCount} 万字</Badge>
            <Badge variant="secondary">{outline.volumes.length} 卷</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Milestones */}
      {outline.milestones && outline.milestones.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>🏆</span>
              <span>里程碑</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {outline.milestones.map((milestone, i) => (
                <div key={i} className="flex items-start gap-3 p-2">
                  <span className="text-primary">•</span>
                  <span className="text-sm text-muted-foreground">{milestone}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Volumes */}
      <div className="space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          <span>📚</span>
          <span>卷目结构</span>
        </h3>
        
        <ScrollArea className="h-[calc(100vh-450px)]">
          <div className="space-y-4 pr-4">
            {outline.volumes.map((vol, volIndex) => (
              <Card key={volIndex} className="glass-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Badge variant="outline">第 {volIndex + 1} 卷</Badge>
                      <span>{vol.title}</span>
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">
                      第 {vol.startChapter} - {vol.endChapter} 章
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="p-2 rounded-lg bg-muted/30">
                      <span className="text-xs text-muted-foreground">目标</span>
                      <p className="truncate">{vol.goal}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/30">
                      <span className="text-xs text-muted-foreground">冲突</span>
                      <p className="truncate">{vol.conflict}</p>
                    </div>
                    <div className="p-2 rounded-lg bg-muted/30">
                      <span className="text-xs text-muted-foreground">高潮</span>
                      <p className="truncate">{vol.climax}</p>
                    </div>
                  </div>
                  
                  {/* Chapter list (collapsed by default, show first few) */}
                  <details className="group">
                    <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                      查看 {vol.chapters.length} 章详情 →
                    </summary>
                    <div className="mt-3 space-y-1.5 pl-2 border-l-2 border-primary/30">
                      {vol.chapters.map((ch) => (
                        <div key={ch.index} className="text-sm py-1">
                          <span className="text-muted-foreground mr-2">第{ch.index}章</span>
                          <span className="font-medium">{ch.title}</span>
                          {ch.goal && (
                            <p className="text-xs text-muted-foreground mt-0.5 ml-12">{ch.goal}</p>
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
