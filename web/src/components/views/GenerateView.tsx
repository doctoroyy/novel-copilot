import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FileText,
  Loader2,
  PenLine,
  RefreshCw,
  Rocket,
  Route,
  ShieldCheck,
  Sparkles,
  Square,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
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
  outlineChapters: string;
  outlineWordCount: string;
  outlineMinChapterWords: string;
  outlineCustomPrompt: string;
  onOutlineChaptersChange: (value: string) => void;
  onOutlineWordCountChange: (value: string) => void;
  onOutlineMinChapterWordsChange: (value: string) => void;
  onOutlineCustomPromptChange: (value: string) => void;
  onGenerateOutline: () => void;
  generateCount: string;
  onGenerateCountChange: (value: string) => void;
  onGenerateChapters: () => void;
  onCancelGeneration?: () => void;
  cancelingGeneration?: boolean;
  onResetState: () => void;
}

type StageState = 'done' | 'active' | 'idle' | 'attention';

type Stage = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  state: StageState;
};

function stageClasses(state: StageState) {
  if (state === 'done') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (state === 'active') return 'border-primary/50 bg-primary/10 text-primary';
  if (state === 'attention') return 'border-destructive/50 bg-destructive/10 text-destructive';
  return 'border-border/70 bg-muted/20 text-muted-foreground';
}

export function GenerateView({
  project,
  loading,
  generatingOutline,
  generationState,
  outlineChapters,
  outlineWordCount,
  outlineMinChapterWords,
  outlineCustomPrompt,
  onOutlineChaptersChange,
  onOutlineWordCountChange,
  onOutlineMinChapterWordsChange,
  onOutlineCustomPromptChange,
  onGenerateOutline,
  generateCount,
  onGenerateCountChange,
  onGenerateChapters,
  onCancelGeneration,
  cancelingGeneration,
  onResetState,
}: GenerateViewProps) {
  const chaptersGenerated = Math.max(0, project.state.nextChapterIndex - 1);
  const remainingChapters = Math.max(0, project.state.totalChapters - chaptersGenerated);
  const generationProgressPercent = project.state.totalChapters > 0
    ? Math.min(100, Math.max(0, (chaptersGenerated / project.state.totalChapters) * 100))
    : 0;
  const generatingCurrentProject = Boolean(
    generationState?.isGenerating && (!generationState.projectName || generationState.projectName === project.name)
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

  const activeStage = useMemo(() => {
    if (generatingCurrentProject || loading) return 'draft';
    if (!project.outline) return 'outline';
    if (project.state.needHuman) return 'attention';
    if (chaptersGenerated === 0) return 'context';
    if (remainingChapters <= 0) return 'qc';
    return 'memory';
  }, [
    chaptersGenerated,
    generatingCurrentProject,
    loading,
    project.outline,
    project.state.needHuman,
    remainingChapters,
  ]);

  const stages = useMemo<Stage[]>(() => {
    const outlineDone = Boolean(project.outline);
    const draftDone = chaptersGenerated > 0;
    return [
      {
        id: 'outline',
        label: '大纲',
        description: outlineDone ? '结构已建立' : '先生成 Story Bible 与卷规划',
        icon: FileText,
        state: activeStage === 'outline' ? 'active' : outlineDone ? 'done' : 'idle',
      },
      {
        id: 'context',
        label: '上下文',
        description: '同步摘要、角色、伏笔与章节目标',
        icon: Route,
        state: activeStage === 'context' ? 'active' : draftDone ? 'done' : outlineDone ? 'idle' : 'idle',
      },
      {
        id: 'draft',
        label: '正文生产',
        description: generatingCurrentProject ? '正在生成章节' : `还剩 ${remainingChapters} 章`,
        icon: Wand2,
        state: activeStage === 'draft' ? 'active' : draftDone ? 'done' : 'idle',
      },
      {
        id: 'qc',
        label: '质检',
        description: remainingChapters <= 0 ? '建议进入质量检测' : '关键节点做节奏与一致性检查',
        icon: ShieldCheck,
        state: activeStage === 'qc' ? 'active' : 'idle',
      },
      {
        id: 'memory',
        label: '记忆回写',
        description: '摘要、时间线和人物状态进入下一轮',
        icon: Sparkles,
        state: activeStage === 'memory' ? 'active' : draftDone ? 'done' : 'idle',
      },
      {
        id: 'attention',
        label: '人工介入',
        description: project.state.needHuman ? project.state.needHumanReason || '需要处理异常' : '无阻塞',
        icon: AlertTriangle,
        state: activeStage === 'attention' ? 'attention' : 'idle',
      },
    ];
  }, [
    activeStage,
    chaptersGenerated,
    generatingCurrentProject,
    project.outline,
    project.state.needHuman,
    project.state.needHumanReason,
    remainingChapters,
  ]);

  const canGenerateChapters = Boolean(project.outline) && remainingChapters > 0 && !generatingCurrentProject && !project.state.needHuman;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 lg:space-y-5 lg:p-6">
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

      <section className="rounded-lg border border-border/80 bg-card">
        <div className="grid gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="border-b border-border/70 p-4 lg:border-b-0 lg:border-r lg:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">Generation Runway</p>
                <h2 className="mt-1 text-xl font-semibold">生成流程台</h2>
              </div>
              <span className="rounded-md bg-muted px-2 py-1 text-xs tabular-nums">{Math.round(generationProgressPercent)}%</span>
            </div>
            <div className="space-y-2">
              {stages.map((stage, index) => {
                const Icon = stage.icon;
                return (
                  <div key={stage.id} className={`rounded-lg border p-3 ${stageClasses(stage.state)}`}>
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background/70">
                        {stage.state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{index + 1}. {stage.label}</p>
                          {stage.state === 'active' && <CircleDot className="h-4 w-4 animate-pulse" />}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 opacity-85">{stage.description}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-4 lg:p-5">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold">当前操作</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {project.outline
                    ? `已生成 ${chaptersGenerated} 章，还剩 ${remainingChapters} 章。`
                    : '先建立大纲，再进入正文生成。'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md border border-border/70 px-3 py-2">
                  <p className="text-muted-foreground">已生成</p>
                  <p className="mt-1 font-semibold tabular-nums">{chaptersGenerated}</p>
                </div>
                <div className="rounded-md border border-border/70 px-3 py-2">
                  <p className="text-muted-foreground">剩余</p>
                  <p className="mt-1 font-semibold tabular-nums">{remainingChapters}</p>
                </div>
                <div className="rounded-md border border-border/70 px-3 py-2">
                  <p className="text-muted-foreground">下一章</p>
                  <p className="mt-1 font-semibold tabular-nums">{project.state.nextChapterIndex}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="rounded-lg py-0">
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <div>
                      <h4 className="font-semibold">大纲生成</h4>
                      <p className="text-xs text-muted-foreground">确定全书规模、卷目标和章节节奏。</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label className="text-xs">目标章数</Label>
                      <Input type="number" value={outlineChapters} onChange={(e) => onOutlineChaptersChange(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">目标字数（万字）</Label>
                      <Input type="number" value={outlineWordCount} onChange={(e) => onOutlineWordCountChange(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">每章最少字数</Label>
                      <Input
                        type="number"
                        min={500}
                        max={20000}
                        step={100}
                        value={outlineMinChapterWords}
                        onChange={(e) => onOutlineMinChapterWordsChange(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">自定义提示词（可选）</Label>
                    <Textarea
                      placeholder="例如：多加感情线、增加反转、强化升级爽点..."
                      className="min-h-[92px] resize-none text-sm"
                      value={outlineCustomPrompt}
                      onChange={(e) => onOutlineCustomPromptChange(e.target.value)}
                    />
                  </div>
                  <Button onClick={onGenerateOutline} disabled={loading || generatingOutline} className="w-full">
                    {generatingOutline ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                    {generatingOutline ? '生成大纲中...' : project.outline ? '重新生成大纲' : '生成大纲'}
                  </Button>
                  {project.outline && (
                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">
                      <div className="mb-1 flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" />
                        已有大纲
                      </div>
                      <p className="line-clamp-2 text-muted-foreground">{project.outline.mainGoal}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-lg py-0">
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-center gap-2">
                    <PenLine className="h-4 w-4 text-primary" />
                    <div>
                      <h4 className="font-semibold">章节生产</h4>
                      <p className="text-xs text-muted-foreground">按可审阅批次推进正文。</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">生成章数</Label>
                    <Select
                      value={normalizedGenerateCount}
                      onValueChange={onGenerateCountChange}
                      disabled={generatingCurrentProject || remainingChapters <= 0}
                    >
                      <SelectTrigger>
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

                  <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">全书进度</span>
                      <span className="font-medium tabular-nums">{Math.round(generationProgressPercent)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full progress-gradient transition-all duration-500" style={{ width: `${generationProgressPercent}%` }} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>当前最少字数：{project.state.minChapterWords}</span>
                      <span className="text-right">目标：{project.state.totalChapters} 章</span>
                    </div>
                  </div>

                  <Button onClick={onGenerateChapters} disabled={loading || !canGenerateChapters} className="w-full">
                    {(loading || generatingCurrentProject) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    {(loading || generatingCurrentProject) ? '生成中...' : '开始生成'}
                  </Button>

                  {generatingCurrentProject && onCancelGeneration && (
                    <Button onClick={onCancelGeneration} disabled={Boolean(cancelingGeneration)} variant="destructive" className="w-full">
                      {cancelingGeneration ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                      {cancelingGeneration ? '正在取消...' : '取消生成'}
                    </Button>
                  )}

                  {!project.outline && (
                    <div className="rounded-md bg-muted/30 p-3 text-sm text-muted-foreground">
                      请先生成大纲。
                    </div>
                  )}
                  {remainingChapters <= 0 && project.outline && (
                    <div className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                      已达到目标章节数，建议进入质量检测。
                    </div>
                  )}
                  {project.state.needHuman && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-destructive">
                        <AlertTriangle className="h-4 w-4" />
                        需要人工介入
                      </div>
                      <p className="mb-3 text-sm text-muted-foreground">{project.state.needHumanReason}</p>
                      <Button variant="outline" size="sm" onClick={onResetState}>
                        <RefreshCw className="h-4 w-4" />
                        重置状态
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
