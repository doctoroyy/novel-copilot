import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, RotateCw, FileText, Target, Trophy, Library, Edit2, Save, X, Plus, Trash2 } from 'lucide-react';
import { type ProjectDetail, type NovelOutline, refineOutline, updateOutline } from '@/lib/api';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';

interface OutlineViewProps {
  project: ProjectDetail;
  onRefresh?: () => void;
}

export function OutlineView({ project, onRefresh }: OutlineViewProps) {
  const [isRefining, setIsRefining] = useState(false);
  const [refiningVolIdx, setRefiningVolIdx] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedOutline, setEditedOutline] = useState<NovelOutline | null>(null);
  const [refineMessage, setRefineMessage] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  
  const { config, isConfigured } = useAIConfig();

  // Initialize editedOutline when entering edit mode
  useEffect(() => {
    if (isEditing && project.outline) {
      setEditedOutline(JSON.parse(JSON.stringify(project.outline)));
    }
  }, [isEditing, project.outline]);

  const handleRefine = async () => {
    if (!isConfigured) {
      setActionError('请先在设置中配置 AI API Key');
      return;
    }

    try {
      setActionError(null);
      setIsRefining(true);
      setRefineMessage('正在分析大纲...');
      const headers = getAIConfigHeaders(config);
      await refineOutline(project.id, undefined, headers, {
        onStart: (totalVolumes) => {
          setRefineMessage(`发现 ${totalVolumes} 卷需要完善`);
        },
        onProgress: (data) => {
          setRefineMessage(data.message);
        },
        onVolumeComplete: (data) => {
          setRefineMessage(data.message);
        },
      });
      setRefineMessage('');
      onRefresh?.();
    } catch (error) {
      setActionError(`操作失败：${(error as Error).message}`);
      setRefineMessage('');
    } finally {
      setIsRefining(false);
    }
  };

  const handleRefineVolume = async (volIndex: number) => {
    if (!isConfigured) {
      setActionError('请先在设置中配置 AI API Key');
      return;
    }

    try {
      setActionError(null);
      setRefiningVolIdx(volIndex);
      setRefineMessage(`正在重新生成第 ${volIndex + 1} 卷的章节大纲...`);
      const headers = getAIConfigHeaders(config);
      await refineOutline(project.id, volIndex, headers, {
        onProgress: (data) => {
          setRefineMessage(data.message);
        },
        onVolumeComplete: (data) => {
          setRefineMessage(data.message);
        },
      });
      setRefineMessage('');
      onRefresh?.();
    } catch (error) {
      setActionError(`操作失败：${(error as Error).message}`);
      setRefineMessage('');
    } finally {
      setRefiningVolIdx(null);
    }
  };

  const handleSave = async () => {
    if (!editedOutline) return;
    
    try {
      setActionError(null);
      setIsSaving(true);
      await updateOutline(project.id, editedOutline);
      setIsEditing(false);
      onRefresh?.();
    } catch (error) {
      setActionError(`保存失败：${(error as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (confirm('确定要放弃修改吗？')) {
      setIsEditing(false);
      setEditedOutline(null);
    }
  };

  // Helper to update milestones
  const updateMilestone = (index: number, value: string) => {
    if (!editedOutline) return;
    const newMilestones = [...(editedOutline.milestones || [])];
    newMilestones[index] = value;
    setEditedOutline({ ...editedOutline, milestones: newMilestones });
  };

  const addMilestone = () => {
    if (!editedOutline) return;
    setEditedOutline({ 
      ...editedOutline, 
      milestones: [...(editedOutline.milestones || []), ''] 
    });
  };

  const removeMilestone = (index: number) => {
    if (!editedOutline) return;
    const newMilestones = [...(editedOutline.milestones || [])];
    newMilestones.splice(index, 1);
    setEditedOutline({ ...editedOutline, milestones: newMilestones });
  };

  // Helper to update volume
  const updateVolume = (volIndex: number, field: string, value: string) => {
    if (!editedOutline) return;
    const newVolumes = [...editedOutline.volumes];
    newVolumes[volIndex] = { ...newVolumes[volIndex], [field]: value };
    setEditedOutline({ ...editedOutline, volumes: newVolumes });
  };

  // Helper to update chapter within volume
  const updateChapter = (volIndex: number, chIndex: number, field: string, value: string) => {
    if (!editedOutline) return;
    const newVolumes = [...editedOutline.volumes];
    const newChapters = [...newVolumes[volIndex].chapters];
    newChapters[chIndex] = { ...newChapters[chIndex], [field]: value };
    newVolumes[volIndex] = { ...newVolumes[volIndex], chapters: newChapters };
    setEditedOutline({ ...editedOutline, volumes: newVolumes });
  };

  if (!project.outline) {
    return (
      <div className="p-4 lg:p-6">
        <Card className="glass-card">
          <CardContent className="p-8 lg:p-12 text-center text-muted-foreground">
            <FileText className="h-10 w-10 lg:h-12 lg:w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-base lg:text-lg font-medium mb-2">尚未生成大纲</p>
            <p className="text-xs lg:text-sm">前往"生成"标签页创建大纲</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Use editedOutline if editing, otherwise project.outline
  const outline = isEditing && editedOutline ? editedOutline : project.outline;
  const isBusy = isRefining || refiningVolIdx !== null || isSaving;

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}
      {/* Header Actions */}
      <div className="flex justify-end gap-2">
        {isEditing ? (
          <>
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={isBusy}>
              <X className="mr-1 h-4 w-4" /> 取消
            </Button>
            <Button variant="default" size="sm" onClick={handleSave} disabled={isBusy}>
              {isSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} 保存
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} disabled={isBusy}>
            <Edit2 className="mr-1 h-4 w-4" /> 编辑大纲
          </Button>
        )}
      </div>

      {/* Main Goal */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base lg:text-lg">
            <Target className="h-5 w-5 text-primary" />
            <span>主线目标</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <Textarea 
              value={outline.mainGoal} 
              onChange={(e) => setEditedOutline(prev => prev ? ({ ...prev, mainGoal: e.target.value }) : null)}
              className="min-h-[100px]"
            />
          ) : (
            <p className="text-muted-foreground text-xs lg:text-sm whitespace-pre-wrap">{outline.mainGoal}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="secondary" className="text-xs">{outline.totalChapters} 章</Badge>
            <Badge variant="secondary" className="text-xs">{outline.targetWordCount} 万字</Badge>
            <Badge variant="secondary" className="text-xs">{outline.volumes.length} 卷</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Milestones */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base lg:text-lg">
            <Trophy className="h-5 w-5 text-yellow-500" />
            <span>里程碑</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(outline.milestones || []).map((milestone, i) => {
              const milestoneText = typeof milestone === 'string' 
                ? milestone 
                : (milestone as any).milestone || (milestone as any).description || JSON.stringify(milestone);
              
              return (
                <div key={i} className="flex items-start gap-3 p-2 group">
                  <span className="text-primary mt-1.5">•</span>
                  {isEditing ? (
                    <div className="flex-1 flex gap-2">
                      <Input 
                        value={milestoneText} 
                        onChange={(e) => updateMilestone(i, e.target.value)}
                        className="h-8 text-xs lg:text-sm"
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => removeMilestone(i)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs lg:text-sm text-muted-foreground pt-0.5">{milestoneText}</span>
                  )}
                </div>
              );
            })}
            {isEditing && (
              <Button variant="outline" size="sm" onClick={addMilestone} className="w-full mt-2 border-dashed">
                <Plus className="mr-1 h-3 w-3" /> 添加里程碑
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Volumes */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium flex items-center gap-2 text-sm lg:text-base">
            <Library className="h-5 w-5 text-primary" />
            <span>卷目结构</span>
          </h3>
          {!isEditing && (
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
          )}
        </div>

        {/* Refine progress banner */}
        {refineMessage && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20 animate-in fade-in slide-in-from-top-2 duration-300">
            <Sparkles className="h-4 w-4 text-primary animate-pulse shrink-0" />
            <span className="text-sm text-primary font-medium">{refineMessage}</span>
          </div>
        )}
        
        <ScrollArea className="h-[calc(100vh-450px)] lg:h-[calc(100vh-500px)]">
          <div className="space-y-4 pr-2 lg:pr-4">
            {outline.volumes.map((vol, volIndex) => (
              <Card key={volIndex} className="glass-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm lg:text-base flex items-center gap-2 min-w-0 flex-1">
                      <Badge variant="outline" className="text-xs shrink-0">第 {volIndex + 1} 卷</Badge>
                      {isEditing ? (
                        <Input 
                          value={vol.title} 
                          onChange={(e) => updateVolume(volIndex, 'title', e.target.value)} 
                          className="h-7 text-sm font-bold"
                        />
                      ) : (
                        <span className="truncate">{vol.title}</span>
                      )}
                    </CardTitle>
                    {!isEditing && (
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
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 gap-2">
                    <div className="p-2 rounded-lg bg-muted/30">
                      <span className="text-xs text-primary font-medium mb-1 block">目标</span>
                      {isEditing ? (
                         <Textarea 
                          value={vol.goal} 
                          onChange={(e) => updateVolume(volIndex, 'goal', e.target.value)}
                          className="text-xs min-h-[60px]"
                        />
                      ) : (
                        <p className="text-xs lg:text-sm">{vol.goal}</p>
                      )}
                    </div>
                    {/* Collapsible details for Conflict/Climax to save space? Or just show them. */}
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="p-2 rounded-lg bg-muted/30">
                          <span className="text-xs text-muted-foreground mb-1 block">冲突</span>
                          {isEditing ? (
                             <Input 
                              value={vol.conflict} 
                              onChange={(e) => updateVolume(volIndex, 'conflict', e.target.value)}
                              className="text-xs h-7"
                            />
                          ) : (
                            <p className="truncate text-xs lg:text-sm">{vol.conflict}</p>
                          )}
                        </div>
                        <div className="p-2 rounded-lg bg-muted/30">
                          <span className="text-xs text-muted-foreground mb-1 block">高潮</span>
                           {isEditing ? (
                             <Input 
                              value={vol.climax} 
                              onChange={(e) => updateVolume(volIndex, 'climax', e.target.value)}
                              className="text-xs h-7"
                            />
                          ) : (
                            <p className="truncate text-xs lg:text-sm">{vol.climax}</p>
                          )}
                        </div>
                     </div>
                  </div>
                  
                  {/* Chapter list */}
                  <details className="group" open={isEditing}>
                    <summary className="cursor-pointer text-xs lg:text-sm text-muted-foreground hover:text-foreground">
                      {isEditing ? '编辑章节列表' : `查看 ${vol.chapters.length} 章详情 →`}
                    </summary>
                    <div className="mt-3 space-y-1.5 pl-2 border-l-2 border-primary/30">
                      {vol.chapters.map((ch, chIdx) => (
                        <div key={ch.index || chIdx} className="py-2 border-b border-border/50 last:border-0">
                          <div className="flex items-center gap-2 mb-1">
                             <Badge variant="outline" className="text-[10px] h-5 px-1 bg-background/50">第{ch.index}章</Badge>
                             {isEditing ? (
                               <Input 
                                value={ch.title} 
                                onChange={(e) => updateChapter(volIndex, chIdx, 'title', e.target.value)} 
                                className="h-6 text-xs flex-1"
                                placeholder="章节标题"
                              />
                             ) : (
                               <span className="font-medium text-xs lg:text-sm">{ch.title}</span>
                             )}
                          </div>
                          {isEditing ? (
                             <Textarea 
                                value={ch.goal} 
                                onChange={(e) => updateChapter(volIndex, chIdx, 'goal', e.target.value)} 
                                className="text-xs min-h-[40px] mt-1"
                                placeholder="章节目标/摘要"
                              />
                          ) : ch.goal && (
                            <p className="text-xs text-muted-foreground pl-1">{ch.goal}</p>
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
