import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { FileText, Wand2, CheckCircle, AlertTriangle, RefreshCw, Loader2, Rocket, PenLine, Pause, Square } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GenerationProgress } from '@/components/GenerationProgress';
import type { ProjectDetail } from '@/lib/api';

interface GenerationState {
  isGenerating: boolean;
  current: number;
  total: number;
  currentChapter?: number;
  currentChapterTitle?: string;
  status?: 'preparing' | 'generating' | 'analyzing' | 'planning' | 'reviewing' | 'repairing' | 'saving' | 'updating_summary' | 'done' | 'error';
  message?: string;
  startTime?: number;
  projectName?: string;
}

interface GenerateViewProps {
  project: ProjectDetail;
  loading: boolean;
  generatingOutline?: boolean;
  generationState?: GenerationState;
  // Outline generation
  outlineChapters: string;
  outlineWordCount: string;
  outlineCustomPrompt: string;
  onOutlineChaptersChange: (value: string) => void;
  onOutlineWordCountChange: (value: string) => void;
  onOutlineCustomPromptChange: (value: string) => void;
  onGenerateOutline: () => void;
  // Chapter generation
  generateCount: string;
  onGenerateCountChange: (value: string) => void;
  plannerMode?: 'llm' | 'rule';
  onPlannerModeChange?: (value: 'llm' | 'rule') => void;
  autoOutline?: 'on' | 'off';
  onAutoOutlineChange?: (value: 'on' | 'off') => void;
  autoCharacters?: 'on' | 'off';
  onAutoCharactersChange?: (value: 'on' | 'off') => void;
  repairAttempts?: string;
  onRepairAttemptsChange?: (value: string) => void;
  conflictPolicy?: 'block' | 'takeover';
  onConflictPolicyChange?: (value: 'block' | 'takeover') => void;
  onGenerateChapters: () => void;
  onPauseGeneration?: () => void;
  onStopGeneration?: () => void;
  onResetState: () => void;
}

export function GenerateView({
  project,
  loading,
  generatingOutline,
  generationState,
  outlineChapters,
  outlineWordCount,
  outlineCustomPrompt,
  onOutlineChaptersChange,
  onOutlineWordCountChange,
  onOutlineCustomPromptChange,
  onGenerateOutline,
  generateCount,
  onGenerateCountChange,
  plannerMode = 'llm',
  onPlannerModeChange = () => {},
  autoOutline = 'on',
  onAutoOutlineChange = () => {},
  autoCharacters = 'on',
  onAutoCharactersChange = () => {},
  repairAttempts = '1',
  onRepairAttemptsChange = () => {},
  conflictPolicy = 'block',
  onConflictPolicyChange = () => {},
  onGenerateChapters,
  onPauseGeneration = () => {},
  onStopGeneration = () => {},
  onResetState,
}: GenerateViewProps) {
  const isCurrentProjectGenerating = Boolean(
    generationState?.isGenerating && generationState?.projectName === project.name
  );

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Generation Progress Overlay - only show if the progress belongs to THIS project */}
      {generationState?.isGenerating && generationState?.projectName === project.name && (
        <GenerationProgress
          isGenerating={generationState.isGenerating}
          current={generationState.current}
          total={generationState.total}
          currentChapter={generationState.currentChapter}
          currentChapterTitle={generationState.currentChapterTitle}
          status={generationState.status}
          message={generationState.message}
          startTime={generationState.startTime}
        />
      )}
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
      {/* Outline Generation */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base lg:text-lg">
            <FileText className="h-5 w-5 text-primary" />
            大纲生成
          </CardTitle>
          <CardDescription className="text-xs lg:text-sm">
            为 "{project.name}" 生成故事大纲
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:gap-4">
            <div className="space-y-2">
              <Label className="text-xs lg:text-sm">目标章数</Label>
              <Input
                type="number"
                value={outlineChapters}
                onChange={(e) => onOutlineChaptersChange(e.target.value)}
                className="bg-muted/50 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs lg:text-sm">目标字数（万字）</Label>
              <Input
                type="number"
                value={outlineWordCount}
                onChange={(e) => onOutlineWordCountChange(e.target.value)}
                className="bg-muted/50 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs lg:text-sm">自定义提示词（可选）</Label>
            <Textarea
              placeholder="添加额外的写作要求，如：多加感情线、增加反转..."
              className="min-h-[80px] lg:min-h-[100px] bg-muted/50 resize-none text-xs lg:text-sm"
              value={outlineCustomPrompt}
              onChange={(e) => onOutlineCustomPromptChange(e.target.value)}
            />
          </div>
          <Button 
            onClick={onGenerateOutline} 
            disabled={loading || generatingOutline} 
            className="w-full gradient-bg hover:opacity-90 text-sm lg:text-base"
          >
            {generatingOutline ? <><Loader2 className="h-4 w-4 animate-spin" /> 生成大纲中...</> : <><Rocket className="h-4 w-4" /> 生成大纲</>}
          </Button>

          {project.outline && (
            <div className="mt-4 p-3 lg:p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2 text-green-500 font-medium mb-2 text-xs lg:text-sm">
                <CheckCircle className="h-4 w-4" />
                <span>已有大纲</span>
              </div>
              <div className="text-xs lg:text-sm text-muted-foreground space-y-1">
                <p>主线: {project.outline.mainGoal}</p>
                <p>
                  {project.outline.volumes.length} 卷 / {project.outline.totalChapters} 章 / {project.outline.targetWordCount} 万字
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chapter Generation */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base lg:text-lg">
            <Wand2 className="h-5 w-5 text-primary" />
            章节生成
          </CardTitle>
          <CardDescription className="text-xs lg:text-sm">
            当前进度: {project.state.nextChapterIndex - 1} / {project.state.totalChapters}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs lg:text-sm">生成章数</Label>
            <Select value={generateCount} onValueChange={onGenerateCountChange}>
              <SelectTrigger className="bg-muted/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 章</SelectItem>
                <SelectItem value="5">5 章</SelectItem>
                <SelectItem value="10">10 章</SelectItem>
                <SelectItem value="20">20 章</SelectItem>
                <SelectItem value="50">50 章</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:gap-4">
            <div className="space-y-2">
              <Label className="text-xs lg:text-sm">规划模式</Label>
              <Select value={plannerMode} onValueChange={(v) => onPlannerModeChange(v as 'llm' | 'rule')}>
                <SelectTrigger className="bg-muted/50 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="llm">LLM Planner</SelectItem>
                  <SelectItem value="rule">规则 Planner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs lg:text-sm">冲突策略</Label>
              <Select value={conflictPolicy} onValueChange={(v) => onConflictPolicyChange(v as 'block' | 'takeover')}>
                <SelectTrigger className="bg-muted/50 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="block">检测到任务则阻止</SelectItem>
                  <SelectItem value="takeover">接管运行中任务</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 lg:gap-4">
            <div className="space-y-2">
              <Label className="text-xs lg:text-sm">自动补大纲</Label>
              <Select value={autoOutline} onValueChange={(v) => onAutoOutlineChange(v as 'on' | 'off')}>
                <SelectTrigger className="bg-muted/50 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">开启</SelectItem>
                  <SelectItem value="off">关闭</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs lg:text-sm">自动补人物</Label>
              <Select value={autoCharacters} onValueChange={(v) => onAutoCharactersChange(v as 'on' | 'off')}>
                <SelectTrigger className="bg-muted/50 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="on">开启</SelectItem>
                  <SelectItem value="off">关闭</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs lg:text-sm">QC 修复次数</Label>
              <Select value={repairAttempts} onValueChange={onRepairAttemptsChange}>
                <SelectTrigger className="bg-muted/50 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 次</SelectItem>
                  <SelectItem value="1">1 次</SelectItem>
                  <SelectItem value="2">2 次</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button 
            onClick={onGenerateChapters} 
            disabled={loading || isCurrentProjectGenerating || (!project.outline && autoOutline === 'off')} 
            className="w-full gradient-bg hover:opacity-90 text-sm lg:text-base"
          >
            {loading || isCurrentProjectGenerating ? <><Loader2 className="h-4 w-4 animate-spin" /> 生成中...</> : <><PenLine className="h-4 w-4" /> 开始生成</>}
          </Button>

          {isCurrentProjectGenerating && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={onPauseGeneration} className="text-xs lg:text-sm">
                <Pause className="h-4 w-4 mr-1" />
                暂停任务
              </Button>
              <Button variant="destructive" onClick={onStopGeneration} className="text-xs lg:text-sm">
                <Square className="h-4 w-4 mr-1" />
                停止任务
              </Button>
            </div>
          )}

          {!project.outline && autoOutline === 'off' && (
            <p className="text-xs lg:text-sm text-muted-foreground text-center">
              当前关闭了自动补大纲，请先手动生成大纲
            </p>
          )}

          {project.state.needHuman && (
            <div className="p-3 lg:p-4 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-center gap-2 text-destructive font-medium mb-2 text-xs lg:text-sm">
                <AlertTriangle className="h-4 w-4" />
                <span>需要人工介入</span>
              </div>
              <p className="text-xs lg:text-sm mb-3">{project.state.needHumanReason}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={onResetState}
                className="text-xs lg:text-sm"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                重置状态
              </Button>
            </div>
          )}

          {/* Progress indicator */}
          <div className="pt-4 border-t border-border">
            <div className="flex justify-between text-xs lg:text-sm text-muted-foreground mb-2">
              <span>生成进度</span>
              <span>{Math.round(((project.state.nextChapterIndex - 1) / project.state.totalChapters) * 100)}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full progress-gradient transition-all duration-500"
                style={{ width: `${((project.state.nextChapterIndex - 1) / project.state.totalChapters) * 100}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
