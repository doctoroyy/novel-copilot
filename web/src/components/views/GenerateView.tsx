import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { FileText, Wand2, CheckCircle, AlertTriangle, RefreshCw, Loader2, Rocket, PenLine, Square } from 'lucide-react';
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

type FlowNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  active: boolean;
};

type FlowEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
};

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

  const flowStage = useMemo(() => {
    if (generatingCurrentProject || loading) return 'generating';
    if (!project.outline) return 'outline';
    if (project.state.needHuman) return 'blocked';
    if (project.state.nextChapterIndex <= 1) return 'ready';
    return 'iterating';
  }, [
    generatingCurrentProject,
    loading,
    project.outline,
    project.state.needHuman,
    project.state.nextChapterIndex,
  ]);

  const flowNodes = useMemo<FlowNode[]>(
    () => {
      return [
        {
          id: 'outline',
          label: '大纲生成\n(Story Bible/卷规划)',
          x: 20,
          y: 24,
          active: flowStage === 'outline',
        },
        {
          id: 'context',
          label: '上下文构建\n(摘要/角色/图谱)',
          x: 230,
          y: 24,
          active: flowStage === 'ready',
        },
        {
          id: 'write',
          label: '章节生成\n(正文产出)',
          x: 440,
          y: 24,
          active: flowStage === 'generating',
        },
        {
          id: 'review',
          label: '自检/QC\n(重复/节奏)',
          x: 440,
          y: 172,
          active: flowStage === 'generating',
        },
        {
          id: 'memory',
          label: '记忆更新\n(摘要/时间线)',
          x: 230,
          y: 172,
          active: flowStage === 'iterating',
        },
        {
          id: 'blocked',
          label: '人工介入\n(异常处理)',
          x: 20,
          y: 172,
          active: flowStage === 'blocked',
        },
      ];
    },
    [flowStage]
  );

  const flowEdges = useMemo<FlowEdge[]>(
    () => [
      { id: 'e1', source: 'outline', target: 'context', label: '进入构建' },
      { id: 'e2', source: 'context', target: 'write', label: '开始写作' },
      { id: 'e3', source: 'write', target: 'review', label: '自检' },
      { id: 'e4', source: 'review', target: 'memory', label: '更新记忆' },
      { id: 'e5', source: 'memory', target: 'context', label: '下一章' },
      { id: 'e6', source: 'review', target: 'blocked', label: '需人工' },
    ],
    []
  );

  const nodeSize = { width: 160, height: 64 };

  const nodeMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    flowNodes.forEach((node) => map.set(node.id, { x: node.x, y: node.y }));
    return map;
  }, [flowNodes]);

  const edgePaths = useMemo(() => {
    const getCenter = (id: string) => {
      const node = nodeMap.get(id);
      if (!node) return { x: 0, y: 0 };
      return {
        x: node.x + nodeSize.width / 2,
        y: node.y + nodeSize.height / 2,
      };
    };

    return flowEdges.map((edge) => {
      const from = getCenter(edge.source);
      const to = getCenter(edge.target);
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      return {
        ...edge,
        path: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
        labelX: midX,
        labelY: midY - 6,
      };
    });
  }, [flowEdges, nodeMap, nodeSize.height, nodeSize.width]);

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
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
              <div className="space-y-2">
                <Label className="text-xs lg:text-sm">每章最少字数</Label>
                <Input
                  type="number"
                  min={500}
                  max={20000}
                  step={100}
                  value={outlineMinChapterWords}
                  onChange={(e) => onOutlineMinChapterWordsChange(e.target.value)}
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
              {generatingOutline
                ? <><Loader2 className="h-4 w-4 animate-spin" /> 生成大纲中...</>
                : <><Rocket className="h-4 w-4" /> 生成大纲</>}
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
                  <p>当前每章最少字数: {project.state.minChapterWords} 字</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

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
              {(loading || generatingCurrentProject)
                ? <><Loader2 className="h-4 w-4 animate-spin" /> 生成中...</>
                : <><PenLine className="h-4 w-4" /> 开始生成</>}
            </Button>

            {generatingCurrentProject && onCancelGeneration && (
              <Button
                onClick={onCancelGeneration}
                disabled={Boolean(cancelingGeneration)}
                variant="destructive"
                className="w-full text-sm lg:text-base"
              >
                {cancelingGeneration
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> 正在取消...</>
                  : <><Square className="h-4 w-4" /> 取消生成</>}
              </Button>
            )}

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

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base lg:text-lg">
            <Wand2 className="h-5 w-5 text-primary" />
            生成流程可视化
          </CardTitle>
          <CardDescription className="text-xs lg:text-sm">
            当前阶段: {
              flowStage === 'outline' ? '等待大纲' :
              flowStage === 'ready' ? '准备生成' :
              flowStage === 'generating' ? '生成中' :
              flowStage === 'iterating' ? '持续生成' :
              '需人工介入'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative h-[320px] lg:h-[380px] rounded-lg border border-border/60 bg-slate-950/70 overflow-hidden">
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 620 260"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <marker
                  id="arrow"
                  markerWidth="10"
                  markerHeight="10"
                  refX="6"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L0,6 L6,3 z" fill="rgba(148, 163, 184, 0.8)" />
                </marker>
              </defs>
              {edgePaths.map((edge) => (
                <g key={edge.id}>
                  <path
                    d={edge.path}
                    stroke="rgba(148, 163, 184, 0.7)"
                    strokeWidth="2"
                    fill="none"
                    markerEnd="url(#arrow)"
                  />
                  <text
                    x={edge.labelX}
                    y={edge.labelY}
                    fill="rgba(226, 232, 240, 0.8)"
                    fontSize="10"
                    textAnchor="middle"
                  >
                    {edge.label}
                  </text>
                </g>
              ))}
              {flowNodes.map((node) => {
                const lines = node.label.split('\n');
                const centerX = node.x + nodeSize.width / 2;
                const lineHeight = 18;
                const startY = node.y + nodeSize.height / 2 - ((lines.length - 1) * lineHeight) / 2 + 4;

                return (
                  <g key={node.id}>
                    {node.active && (
                      <rect
                        x={node.x - 4}
                        y={node.y - 4}
                        width={nodeSize.width + 8}
                        height={nodeSize.height + 8}
                        rx={18}
                        fill="none"
                        stroke="rgba(56, 189, 248, 0.25)"
                        strokeWidth="2"
                      />
                    )}
                    <rect
                      x={node.x}
                      y={node.y}
                      width={nodeSize.width}
                      height={nodeSize.height}
                      rx={14}
                      fill="rgba(15, 23, 42, 0.82)"
                      stroke={node.active ? 'rgba(56, 189, 248, 0.95)' : 'rgba(148, 163, 184, 0.35)'}
                      strokeWidth={node.active ? '2.5' : '1.5'}
                    />
                    <text
                      x={centerX}
                      y={startY}
                      fill="rgba(226, 232, 240, 0.95)"
                      fontSize="12"
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      {lines.map((line, index) => (
                        <tspan
                          key={`${node.id}-${index}`}
                          x={centerX}
                          dy={index === 0 ? 0 : lineHeight}
                        >
                          {line}
                        </tspan>
                      ))}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
