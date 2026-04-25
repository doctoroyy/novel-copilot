import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  FileText,
  Flag,
  Gauge,
  Library,
  Loader2,
  PenLine,
  Route,
  ShieldCheck,
  Sparkles,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { ProjectDetail } from '@/lib/api';

interface DashboardViewProps {
  project: ProjectDetail;
  onGenerateOutline: () => void;
  onGenerateChapters: () => void;
  loading: boolean;
}

type StudioMetricProps = {
  label: string;
  value: string | number;
  helper: string;
  icon: LucideIcon;
  tone?: 'green' | 'amber' | 'blue' | 'violet';
};

function StudioMetric({ label, value, helper, icon: Icon, tone = 'blue' }: StudioMetricProps) {
  const toneClass = {
    green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    blue: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  }[tone];

  return (
    <div className="rounded-lg border border-border/70 bg-card/70 p-3 lg:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <p className="mt-2 truncate text-2xl font-semibold tabular-nums lg:text-3xl">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export function DashboardView({ project, onGenerateOutline, onGenerateChapters, loading }: DashboardViewProps) {
  const chaptersGenerated = Math.max(0, project.state.nextChapterIndex - 1);
  const progress = project.state.totalChapters > 0
    ? Math.min(100, Math.max(0, (chaptersGenerated / project.state.totalChapters) * 100))
    : 0;
  const chaptersRemaining = Math.max(0, project.state.totalChapters - chaptersGenerated);
  const volumeCount = project.outline?.volumes.length || 0;
  const nextChapter = chaptersRemaining > 0 ? project.state.nextChapterIndex : project.state.totalChapters;
  const hasOutline = Boolean(project.outline);
  const isComplete = chaptersRemaining <= 0 && hasOutline;
  const nextAction = !hasOutline
    ? '先生成大纲，把长篇结构固定下来'
    : project.state.needHuman
      ? '处理人工介入原因后再继续生成'
      : isComplete
        ? '已达到目标章节数，可进入质检与导出'
        : `继续生产第 ${nextChapter} 章`;

  const ringRadius = 54;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - progress / 100);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 lg:space-y-5 lg:p-6">
      <section className="overflow-hidden rounded-lg border border-border/80 bg-card">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <div className="relative border-b border-border/70 p-5 lg:border-b-0 lg:border-r lg:p-6">
            <div className="absolute inset-x-0 top-0 h-1 progress-gradient" />
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1">
                    <Gauge className="h-3.5 w-3.5" />
                    创作驾驶舱
                  </span>
                  <span>{chaptersGenerated} / {project.state.totalChapters} 章</span>
                </div>
                <h2 className="mt-4 max-w-3xl text-2xl font-semibold tracking-tight lg:text-3xl">
                  {project.name}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {project.outline?.mainGoal || '当前项目还没有大纲。先把主线、卷目标和章节节奏确定下来，后续生成会更稳定。'}
                </p>
              </div>

              <div className="relative mx-auto h-36 w-36 shrink-0 sm:mx-0">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 128 128" aria-hidden="true">
                  <circle
                    cx="64"
                    cy="64"
                    r={ringRadius}
                    stroke="currentColor"
                    strokeWidth="9"
                    fill="none"
                    className="text-muted"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r={ringRadius}
                    stroke="url(#dashboardProgress)"
                    strokeWidth="9"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                    className="transition-all duration-700"
                  />
                  <defs>
                    <linearGradient id="dashboardProgress" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="var(--gradient-from)" />
                      <stop offset="100%" stopColor="var(--gradient-to)" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-semibold tabular-nums">{Math.round(progress)}%</span>
                  <span className="text-xs text-muted-foreground">完成</span>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StudioMetric label="已产出" value={chaptersGenerated} helper={`下一章 ${nextChapter}`} icon={CheckCircle2} tone="green" />
              <StudioMetric label="待完成" value={chaptersRemaining} helper="剩余章节" icon={Clock3} tone="amber" />
              <StudioMetric label="目标规模" value={project.outline?.targetWordCount ? `${project.outline.targetWordCount} 万` : '--'} helper={`${project.state.minChapterWords} 字/章起`} icon={PenLine} tone="blue" />
              <StudioMetric label="结构卷数" value={volumeCount || '--'} helper={hasOutline ? '已建立卷规划' : '待生成大纲'} icon={Library} tone="violet" />
            </div>
          </div>

          <div className="flex flex-col justify-between gap-5 bg-muted/20 p-5 lg:p-6">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                下一步
              </div>
              <p className="mt-3 text-xl font-semibold leading-snug">{nextAction}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {hasOutline
                  ? '当前结构已可进入持续生产。建议一次只推进可审阅的章节批次，并在关键卷尾做质检。'
                  : '大纲是后续章节、摘要、人物关系和质检的共同坐标。'}
              </p>
            </div>

            <div className="grid gap-2">
              {!hasOutline && (
                <Button onClick={onGenerateOutline} disabled={loading} className="h-11 justify-start">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  生成大纲
                </Button>
              )}
              {hasOutline && (
                <Button
                  onClick={onGenerateChapters}
                  disabled={loading || chaptersRemaining <= 0 || Boolean(project.state.needHuman)}
                  className="h-11 justify-start"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : chaptersRemaining <= 0 ? <CheckCircle2 className="h-4 w-4" /> : <Wand2 className="h-4 w-4" />}
                  {chaptersRemaining <= 0 ? '已达目标' : '生成下一章'}
                </Button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border/70 bg-background/70 px-3 py-2">
                  <p className="text-xs text-muted-foreground">状态</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                    {project.state.needHuman ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4 text-emerald-500" />}
                    {project.state.needHuman ? '需处理' : '可继续'}
                  </p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/70 px-3 py-2">
                  <p className="text-xs text-muted-foreground">当前章节</p>
                  <p className="mt-1 text-sm font-medium tabular-nums">第 {Math.max(1, nextChapter)} 章</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {project.outline && (
        <Card className="rounded-lg">
          <CardContent className="p-4 lg:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">卷进度时间线</h3>
              </div>
              <span className="text-xs text-muted-foreground">{project.outline.totalChapters} 章规划</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {project.outline.volumes.map((vol, index) => {
                const total = Math.max(1, vol.endChapter - vol.startChapter + 1);
                const done = Math.min(total, Math.max(0, chaptersGenerated - vol.startChapter + 1));
                const volumeProgress = Math.round((done / total) * 100);
                const isCurrent = nextChapter >= vol.startChapter && nextChapter <= vol.endChapter;

                return (
                  <div
                    key={`${vol.title}-${index}`}
                    className={`rounded-lg border p-3 transition-colors ${isCurrent ? 'border-primary/50 bg-primary/5' : 'border-border/70 bg-muted/20'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{vol.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">第 {vol.startChapter}-{vol.endChapter} 章</p>
                      </div>
                      <span className="rounded-md bg-background px-2 py-1 text-xs font-medium tabular-nums">{volumeProgress}%</span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full progress-gradient transition-all duration-500" style={{ width: `${volumeProgress}%` }} />
                    </div>
                    <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{vol.goal || vol.climax}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="rounded-lg">
          <CardContent className="p-4 lg:p-5">
            <div className="mb-3 flex items-center gap-2">
              <Flag className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">主线目标</h3>
            </div>
            <p className="text-sm leading-7 text-muted-foreground">
              {project.outline?.mainGoal || project.state.rollingSummary || '暂无主线目标。'}
            </p>
          </CardContent>
        </Card>

        <Card className={project.state.needHuman ? 'rounded-lg border-destructive/60 bg-destructive/5' : 'rounded-lg'}>
          <CardContent className="p-4 lg:p-5">
            <div className="mb-3 flex items-center gap-2">
              {project.state.needHuman ? (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              ) : (
                <BookOpen className="h-4 w-4 text-primary" />
              )}
              <h3 className="font-semibold">{project.state.needHuman ? '需要人工介入' : '开放线索'}</h3>
            </div>
            {project.state.needHuman ? (
              <p className="text-sm leading-6 text-destructive">{project.state.needHumanReason}</p>
            ) : project.state.openLoops.length > 0 ? (
              <div className="space-y-2">
                {project.state.openLoops.slice(0, 4).map((loop, index) => (
                  <div key={`${loop}-${index}`} className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    {loop}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无未回收线索。</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
