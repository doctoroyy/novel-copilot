import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, RotateCw, FileText, Target, Trophy, Library, Edit2, Save, X, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { type ProjectDetail, type NovelOutline, refineOutline, updateOutline, addVolumes } from '@/lib/api';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

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
  const [milestonesExpanded, setMilestonesExpanded] = useState(false);
  // 新增卷对话框状态
  const [showAddVolumeDialog, setShowAddVolumeDialog] = useState(false);
  const [addVolumeCount, setAddVolumeCount] = useState('1');
  const [addChaptersPerVolume, setAddChaptersPerVolume] = useState('80');
  const [isAddingVolumes, setIsAddingVolumes] = useState(false);
  
  const { config, isConfigured } = useAIConfig();

  // Initialize editedOutline when entering edit mode
  useEffect(() => {
    if (isEditing && project.outline) {
      setEditedOutline(JSON.parse(JSON.stringify(project.outline)));
    }
  }, [isEditing, project.outline]);

  useEffect(() => {
    setMilestonesExpanded(isEditing);
  }, [isEditing, project.id]);

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
  const isBusy = isRefining || refiningVolIdx !== null || isSaving || isAddingVolumes;

  // 新增卷处理
  const handleAddVolumes = async () => {
    if (!project.outline) return;
    const volumeCount = Number.parseInt(addVolumeCount, 10);
    const chaptersPerVolume = Number.parseInt(addChaptersPerVolume, 10);
    if (!Number.isInteger(volumeCount) || volumeCount <= 0 || volumeCount > 20) {
      setActionError('卷数必须是 1-20 的整数');
      return;
    }
    if (!Number.isInteger(chaptersPerVolume) || chaptersPerVolume <= 0 || chaptersPerVolume > 200) {
      setActionError('每卷章节数必须是 1-200 的整数');
      return;
    }
    setShowAddVolumeDialog(false);
    setActionError(null);
    setIsAddingVolumes(true);
    setRefineMessage('正在准备追加新卷...');
    try {
      await addVolumes(
        project.id,
        {
          newVolumeCount: volumeCount,
          chaptersPerVolume,
          minChapterWords: project.state.minChapterWords || 2500,
        },
        {
          onStart: (data) => setRefineMessage(data.message),
          onProgress: (data) => setRefineMessage(data.message),
          onVolumeComplete: (data) => setRefineMessage(data.message),
          onDone: (_outline, message) => setRefineMessage(message),
          onError: (error) => setActionError(error),
        }
      );
      onRefresh?.();
    } catch (error) {
      setActionError(`追加卷失败：${(error as Error).message}`);
    } finally {
      setIsAddingVolumes(false);
      setTimeout(() => setRefineMessage(''), 3000);
    }
  };

  const milestoneItems = (outline.milestones || []).map((milestone, index) => ({
    index,
    text:
      typeof milestone === 'string'
        ? milestone.trim()
        : ((milestone as any).milestone || (milestone as any).description || '').trim(),
  }));
  const displayMilestones = isEditing ? milestoneItems : milestoneItems.filter((item) => item.text);
  const shouldShowMilestones = isEditing || milestonesExpanded;

  return (
    <>
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
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base lg:text-lg">
              <Trophy className="h-5 w-5 text-yellow-500" />
              <span>里程碑</span>
            </CardTitle>
            {!isEditing && displayMilestones.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground"
                onClick={() => setMilestonesExpanded((prev) => !prev)}
              >
                {milestonesExpanded ? (
                  <>
                    收起 <ChevronUp className="ml-1 h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    展开 <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {displayMilestones.length === 0 ? (
            <p className="text-xs lg:text-sm text-muted-foreground">暂无里程碑</p>
          ) : shouldShowMilestones ? (
            <div className="space-y-2">
              {displayMilestones.map((milestone) => (
                <div key={milestone.index} className="flex items-start gap-3 p-2 group">
                  <span className="text-primary mt-1.5">•</span>
                  {isEditing ? (
                    <div className="flex-1 flex gap-2">
                      <Input
                        value={milestone.text}
                        onChange={(e) => updateMilestone(milestone.index, e.target.value)}
                        className="h-8 text-xs lg:text-sm"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        onClick={() => removeMilestone(milestone.index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs lg:text-sm text-muted-foreground pt-0.5">{milestone.text}</span>
                  )}
                </div>
              ))}
              {isEditing && (
                <Button variant="outline" size="sm" onClick={addMilestone} className="w-full mt-2 border-dashed">
                  <Plus className="mr-1 h-3 w-3" /> 添加里程碑
                </Button>
              )}
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full justify-between text-xs text-muted-foreground"
              onClick={() => setMilestonesExpanded(true)}
            >
              <span>已收起 {displayMilestones.length} 条里程碑</span>
              <span className="inline-flex items-center gap-1">
                点击展开
                <ChevronDown className="h-3.5 w-3.5" />
              </span>
            </Button>
          )}
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
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddVolumeDialog(true)}
                disabled={isBusy}
                className="h-8 text-xs lg:text-sm"
              >
                {isAddingVolumes ? (
                  <Loader2 className="mr-2 h-3 w-3 lg:h-4 lg:w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-3 w-3 lg:h-4 lg:w-4" />
                )}
                新增卷
              </Button>
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

    {/* 新增卷对话框 */}
    <Dialog open={showAddVolumeDialog} onOpenChange={setShowAddVolumeDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增卷</DialogTitle>
          <DialogDescription>
            基于已有大纲追加新卷，AI 将自动衔接已有剧情。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-sm">新增卷数</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={addVolumeCount}
              onChange={(e) => setAddVolumeCount(e.target.value)}
              className="bg-muted/50"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">每卷章节数</Label>
            <Input
              type="number"
              min={1}
              max={200}
              value={addChaptersPerVolume}
              onChange={(e) => setAddChaptersPerVolume(e.target.value)}
              className="bg-muted/50"
            />
          </div>
          {project.outline && (
            <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/30">
              当前：{project.outline.volumes.length} 卷 / {project.outline.totalChapters} 章
              <br />
              追加后预计：{project.outline.volumes.length + Number.parseInt(addVolumeCount, 10) || 0} 卷 / {project.outline.totalChapters + (Number.parseInt(addVolumeCount, 10) || 0) * (Number.parseInt(addChaptersPerVolume, 10) || 0)} 章
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAddVolumeDialog(false)}>取消</Button>
          <Button onClick={handleAddVolumes} className="gradient-bg hover:opacity-90">
            <Plus className="mr-1 h-4 w-4" /> 开始生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
