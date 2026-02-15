import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { FileText, Wand2, CheckCircle, AlertTriangle, RefreshCw, Loader2, Rocket, PenLine } from 'lucide-react';
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
  status?: 'preparing' | 'generating' | 'saving' | 'done' | 'error';
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
  onGenerateChapters: () => void;
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
  onGenerateChapters,
  onResetState,
}: GenerateViewProps) {
  const chaptersGenerated = Math.max(0, project.state.nextChapterIndex - 1);
  const remainingChapters = Math.max(0, project.state.totalChapters - chaptersGenerated);
  const generationProgressPercent = project.state.totalChapters > 0
    ? Math.min(100, Math.max(0, (chaptersGenerated / project.state.totalChapters) * 100))
    : 0;
  const generatingCurrentProject = Boolean(
    generationState?.isGenerating && generationState.projectName === project.name
  );
  const selectedGenerateCount = Number.parseInt(generateCount, 10);
  const normalizedGenerateCount = remainingChapters > 0
    ? String(
      Math.min(
        Number.isInteger(selectedGenerateCount) && selectedGenerateCount > 0 ? selectedGenerateCount : 1,
        remainingChapters
      )
    )
    : '1';
  const chapterCountOptions = Array.from(
    new Set(
      [selectedGenerateCount, 1, 5, 10, 20, 50].filter(
        (value) =>
          Number.isInteger(value) &&
          value > 0 &&
          value <= Math.max(remainingChapters, 1)
      )
    )
  ).sort((a, b) => a - b);

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
            当前进度: {chaptersGenerated} / {project.state.totalChapters}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs lg:text-sm">生成章数</Label>
            <Select
              value={normalizedGenerateCount}
              onValueChange={onGenerateCountChange}
              disabled={generatingCurrentProject || remainingChapters <= 0}
            >
              <SelectTrigger className="bg-muted/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {chapterCountOptions.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value} 章
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button 
            onClick={onGenerateChapters} 
            disabled={loading || !project.outline || generatingCurrentProject || remainingChapters <= 0}
            className="w-full gradient-bg hover:opacity-90 text-sm lg:text-base"
          >
            {(loading || generatingCurrentProject) ? <><Loader2 className="h-4 w-4 animate-spin" /> 生成中...</> : <><PenLine className="h-4 w-4" /> 开始生成</>}
          </Button>

          {!project.outline && (
            <p className="text-xs lg:text-sm text-muted-foreground text-center">
              请先生成大纲
            </p>
          )}
          {remainingChapters <= 0 && (
            <p className="text-xs lg:text-sm text-muted-foreground text-center">
              已达到目标章节数
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
              <span>{Math.round(generationProgressPercent)}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full progress-gradient transition-all duration-500"
                style={{ width: `${generationProgressPercent}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
