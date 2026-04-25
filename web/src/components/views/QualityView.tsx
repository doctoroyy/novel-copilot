import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Filter,
  GitBranch,
  Info,
  Play,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Swords,
  TrendingUp,
  Users,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ProjectDetail, QCReportResponse } from '@/lib/api';
import { startQCScan, getQCReport, fixChapterIssues, fixAllIssues, cancelTaskById, cancelAllActiveTasks } from '@/lib/api';
import { useGeneration } from '@/contexts/GenerationContext';

interface QualityViewProps {
  project: ProjectDetail;
}

type ScanMode = 'quick' | 'standard' | 'full';
type SeverityFilter = 'all' | 'critical' | 'major';
type Severity = 'critical' | 'major' | 'minor' | string;

type ChapterIssue = {
  severity: Severity;
  description: string;
  suggestion?: string;
};

type ChapterQCEntry = {
  score?: number;
  issues?: ChapterIssue[];
};

type ActionableIssue = {
  issueId?: string;
  chapterIndex: number;
  type?: string;
  severity: Severity;
  description: string;
  suggestion?: string;
  fixed?: boolean;
};

type ScoreItem = {
  score?: number;
};

type GlobalAnalysisRecord = {
  pacingCurve?: ScoreItem & {
    deadSpots?: Array<{ from?: number; to?: number; reason?: string }>;
  };
  characterArcs?: ScoreItem & {
    characters?: Array<{ name?: string; arcComplete?: boolean; notes?: string }>;
  };
  plotThreads?: ScoreItem & {
    unresolvedCount?: number;
    threads?: Array<{ introducedAt?: number; description?: string }>;
  };
  conflictDensity?: ScoreItem & {
    distribution?: Array<{ range?: string; density?: string | number }>;
  };
};

type QCReportData = {
  globalAnalysis?: GlobalAnalysisRecord;
  chapters?: Record<number, ChapterQCEntry>;
  actionableIssues?: ActionableIssue[];
};

type TriageCardProps = {
  label: string;
  value: number | string;
  helper: string;
  icon: LucideIcon;
  tone: 'red' | 'amber' | 'yellow' | 'green' | 'blue';
};

function asReportData(value: unknown): QCReportData {
  return value && typeof value === 'object' ? value as QCReportData : {};
}

function severityTone(severity: Severity) {
  if (severity === 'critical') return 'text-red-600 dark:text-red-400';
  if (severity === 'major') return 'text-orange-600 dark:text-orange-400';
  return 'text-yellow-600 dark:text-yellow-400';
}

function TriageCard({ label, value, helper, icon: Icon, tone }: TriageCardProps) {
  const toneClass = {
    red: 'bg-red-500/10 text-red-600 dark:text-red-400',
    amber: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    yellow: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    blue: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  }[tone];

  return (
    <div className="rounded-lg border border-border/70 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export function QualityView({ project }: QualityViewProps) {
  const [report, setReport] = useState<QCReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState<number | 'all' | null>(null);
  const [activeBackendTaskId, setActiveBackendTaskId] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>('standard');
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const { startTask, completeTask: completeCtxTask, cancelTask: cancelCtxTask } = useGeneration();
  const fixTaskIdRef = useRef<string | null>(null);
  const scanTaskIdRef = useRef<string | null>(null);

  const loadReport = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);
      const nextReport = await getQCReport(project.name);
      setReport(nextReport);

      if (nextReport?.status === 'running') {
        setScanning(true);
        if (nextReport.taskId) setActiveBackendTaskId(nextReport.taskId);
      } else if (nextReport?.status === 'repairing') {
        setScanning(false);
        if (nextReport.taskId) setActiveBackendTaskId(nextReport.taskId);
      } else {
        setScanning(false);
        setFixing(null);
        setActiveBackendTaskId(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [project.name]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (report?.status === 'repairing' && fixing === null) {
      const taskId = startTask('qc_fix', '质量修复中...', project.name);
      fixTaskIdRef.current = taskId;
    } else if (report?.status !== 'repairing' && fixing !== null) {
      setFixing(null);
      if (fixTaskIdRef.current) {
        completeCtxTask(fixTaskIdRef.current, true);
        fixTaskIdRef.current = null;
      }
    }
    // Keep this effect scoped to backend status restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.status]);

  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(() => void loadReport(false), 3000);
    return () => clearInterval(interval);
  }, [scanning, loadReport]);

  useEffect(() => {
    if (fixing === null) return;
    const interval = setInterval(() => void loadReport(false), 3000);
    return () => clearInterval(interval);
  }, [fixing, loadReport]);

  const handleStartScan = async () => {
    try {
      setScanning(true);
      setError(null);
      const response = await startQCScan(project.name, scanMode);
      const taskId = startTask('qc', '高质量扫描中...', project.name, undefined, response.taskId);
      scanTaskIdRef.current = taskId;
      setTimeout(() => void loadReport(), 1000);
    } catch (err) {
      setError((err as Error).message);
      setScanning(false);
    }
  };

  const handleCancelScan = async () => {
    setCancelling(true);
    const taskId = scanTaskIdRef.current || fixTaskIdRef.current;

    try {
      if (taskId) {
        await cancelCtxTask(taskId).catch((err: unknown) => console.warn('Context cancel failed:', err));
      }

      if (activeBackendTaskId) {
        await cancelTaskById(activeBackendTaskId);
      } else {
        await cancelAllActiveTasks(project.name);
      }

      setScanning(false);
      setFixing(null);
      setActiveBackendTaskId(null);
      setTimeout(() => {
        void loadReport(true);
        setCancelling(false);
      }, 800);
    } catch (err) {
      setError((err as Error).message);
      setCancelling(false);
    }
  };

  const handleFixChapter = async (chapterIndex: number) => {
    if (!report?.reportId) return;
    try {
      setFixing(chapterIndex);
      setError(null);
      const response = await fixChapterIssues(project.name, chapterIndex, report.reportId);
      const taskId = startTask('qc_fix', `修复第 ${chapterIndex} 章...`, project.name, undefined, response.taskId);
      fixTaskIdRef.current = taskId;
    } catch (err) {
      setError((err as Error).message);
      setFixing(null);
      if (fixTaskIdRef.current) {
        completeCtxTask(fixTaskIdRef.current, false);
        fixTaskIdRef.current = null;
      }
    }
  };

  const handleFixAll = async () => {
    if (!report?.reportId) return;
    try {
      setFixing('all');
      setError(null);
      const response = await fixAllIssues(project.name, report.reportId);
      const taskId = startTask('qc_fix', '批量质量修复中...', project.name, undefined, response.taskId);
      fixTaskIdRef.current = taskId;
    } catch (err) {
      setError((err as Error).message);
      setFixing(null);
      if (fixTaskIdRef.current) {
        completeCtxTask(fixTaskIdRef.current, false);
        fixTaskIdRef.current = null;
      }
    }
  };

  const toggleChapter = (chapterIndex: number) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterIndex)) next.delete(chapterIndex);
      else next.add(chapterIndex);
      return next;
    });
  };

  const reportData = asReportData(report?.data);
  const hasChapters = project.chapters.length > 0;
  const actionableIssues = reportData.actionableIssues ?? [];
  const openIssueCount = actionableIssues.filter((issue) => !issue.fixed).length;
  const score = report?.overallScore ?? 0;
  const passRate = report?.totalIssues ? Math.max(0, 100 - report.totalIssues * 5) : score || 0;

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 lg:space-y-5 lg:p-6">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-border/80 bg-card">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="border-b border-border/70 p-5 lg:border-b-0 lg:border-r lg:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    质检分诊台
                  </span>
                  <span>{project.chapters.length} 章可扫描</span>
                </div>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight lg:text-3xl">质量检测</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  把全局节奏、角色弧线、伏笔回收和章节级问题集中到一个处理队列里，优先处理严重与重要问题。
                </p>
              </div>
              <ScoreRing score={score} size={132} />
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <TriageCard label="严重问题" value={report?.criticalCount ?? 0} helper="优先处理" icon={AlertCircle} tone="red" />
              <TriageCard label="重要问题" value={report?.majorCount ?? 0} helper="影响连续性" icon={AlertTriangle} tone="amber" />
              <TriageCard label="轻微问题" value={report?.minorCount ?? 0} helper="可批量优化" icon={Info} tone="yellow" />
              <TriageCard label="待修复" value={openIssueCount} helper={`通过率约 ${Math.round(passRate)}%`} icon={Wrench} tone={openIssueCount > 0 ? 'blue' : 'green'} />
            </div>
          </div>

          <div className="flex flex-col justify-between gap-5 bg-muted/20 p-5 lg:p-6">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                {scanning ? <CircleDot className="h-4 w-4 animate-pulse text-primary" /> : <Shield className="h-4 w-4 text-primary" />}
                扫描控制
              </div>
              <p className="mt-3 text-xl font-semibold">
                {report?.status === 'completed'
                  ? `最近评分 ${report.overallScore}/100`
                  : report?.status === 'running'
                    ? '扫描正在进行'
                    : report?.status === 'repairing'
                      ? '修复任务正在进行'
                      : '尚未完成质量扫描'}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {hasChapters
                  ? '标准扫描适合日常检查；全量扫描适合卷尾、完本或大改之后。'
                  : '当前没有章节可扫描，请先生成章节。'}
              </p>
            </div>

            <div className="grid gap-3">
              <Select value={scanMode} onValueChange={(value) => setScanMode(value as ScanMode)}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quick">快速扫描</SelectItem>
                  <SelectItem value="standard">标准扫描</SelectItem>
                  <SelectItem value="full">全量扫描</SelectItem>
                </SelectContent>
              </Select>

              {scanning || cancelling ? (
                <Button variant="outline" onClick={handleCancelScan} disabled={cancelling} className="h-11 justify-start">
                  {cancelling ? <RefreshCw className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                  {cancelling ? '正在取消...' : '取消扫描'}
                </Button>
              ) : (
                <Button onClick={handleStartScan} disabled={!hasChapters} className="h-11 justify-start">
                  <Play className="h-4 w-4" />
                  {report ? '重新扫描' : '开始扫描'}
                </Button>
              )}

              <Button
                variant="outline"
                onClick={handleFixAll}
                disabled={!report?.reportId || fixing !== null || scanning || openIssueCount === 0}
                className="h-11 justify-start"
              >
                {fixing === 'all' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                {fixing === 'all' ? '修复中...' : '修复全部待处理问题'}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {!hasChapters && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground">
          <Shield className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="font-medium">没有章节可扫描</p>
          <p className="mt-1 text-sm">请先生成章节后再进行质量检测。</p>
        </div>
      )}

      {reportData.globalAnalysis && (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <GlobalCard
            icon={TrendingUp}
            title="节奏曲线"
            score={reportData.globalAnalysis.pacingCurve?.score}
            items={(reportData.globalAnalysis.pacingCurve?.deadSpots ?? []).map(
              (item) => `第${item.from ?? '?'}-${item.to ?? '?'}章：${item.reason ?? '节奏风险'}`
            )}
            emptyText="未发现明显节奏问题"
          />
          <GlobalCard
            icon={Users}
            title="角色弧线"
            score={reportData.globalAnalysis.characterArcs?.score}
            items={(reportData.globalAnalysis.characterArcs?.characters ?? []).map(
              (item) => `${item.name ?? '角色'}：${item.arcComplete ? '弧线完整' : '需要补强'}${item.notes ? ` - ${item.notes}` : ''}`
            )}
            emptyText="暂无角色弧线数据"
          />
          <GlobalCard
            icon={GitBranch}
            title="伏笔回收"
            score={reportData.globalAnalysis.plotThreads?.score}
            items={(reportData.globalAnalysis.plotThreads?.threads ?? []).map(
              (item) => `第${item.introducedAt ?? '?'}章引入：${item.description ?? '未描述'}`
            )}
            emptyText="未发现未回收伏笔"
            badge={reportData.globalAnalysis.plotThreads?.unresolvedCount
              ? `${reportData.globalAnalysis.plotThreads.unresolvedCount} 未回收`
              : undefined}
          />
          <GlobalCard
            icon={Swords}
            title="冲突分布"
            score={reportData.globalAnalysis.conflictDensity?.score}
            items={(reportData.globalAnalysis.conflictDensity?.distribution ?? []).map(
              (item) => `${item.range ?? '未知区间'}：密度 ${item.density ?? '-'}`
            )}
            emptyText="暂无冲突密度数据"
          />
        </section>
      )}

      {actionableIssues.length > 0 && (
        <section className="rounded-lg border border-border/80 bg-card">
          <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">章节问题队列</h3>
              <Badge variant="secondary">{openIssueCount} 待修复</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Select value={severityFilter} onValueChange={(value) => setSeverityFilter(value as SeverityFilter)}>
                <SelectTrigger className="h-9 w-[112px] text-xs">
                  <Filter className="h-3.5 w-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="critical">严重</SelectItem>
                  <SelectItem value="major">重要</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <IssueList
            issues={actionableIssues}
            chapters={reportData.chapters ?? {}}
            severityFilter={severityFilter}
            expandedChapters={expandedChapters}
            fixing={fixing}
            onToggleChapter={toggleChapter}
            onFixChapter={handleFixChapter}
          />
        </section>
      )}

      {report?.status === 'completed' && actionableIssues.length === 0 && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-10 text-center text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="mx-auto mb-3 h-12 w-12" />
          <p className="text-lg font-medium">所有章节通过质量检测</p>
          <p className="mt-1 text-sm">整体评分 {report.overallScore}/100</p>
        </div>
      )}
    </div>
  );
}

function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const normalizedScore = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
  const offset = circumference - (normalizedScore / 100) * circumference;
  const color = normalizedScore >= 80 ? '#22c55e' : normalizedScore >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          className="text-muted"
          strokeWidth={8}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={8}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">{Math.round(normalizedScore)}</span>
        <span className="text-xs text-muted-foreground">评分</span>
      </div>
    </div>
  );
}

function GlobalCard({
  icon: Icon,
  title,
  score,
  items,
  emptyText,
  badge,
}: {
  icon: LucideIcon;
  title: string;
  score?: number;
  items: string[];
  emptyText: string;
  badge?: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-medium">{title}</span>
          {badge && <Badge variant="secondary" className="text-xs">{badge}</Badge>}
        </div>
        {score !== undefined && (
          <span className={`shrink-0 text-sm font-semibold ${score >= 80 ? 'text-emerald-500' : score >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
            {score}
          </span>
        )}
      </div>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.slice(0, 4).map((item, index) => (
            <li key={`${title}-${index}`} className="text-xs leading-5 text-muted-foreground">
              {item}
            </li>
          ))}
          {items.length > 4 && (
            <li className="text-xs text-muted-foreground">还有 {items.length - 4} 项</li>
          )}
        </ul>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

function IssueList({
  issues,
  chapters,
  severityFilter,
  expandedChapters,
  fixing,
  onToggleChapter,
  onFixChapter,
}: {
  issues: ActionableIssue[];
  chapters: Record<number, ChapterQCEntry>;
  severityFilter: SeverityFilter;
  expandedChapters: Set<number>;
  fixing: number | 'all' | null;
  onToggleChapter: (idx: number) => void;
  onFixChapter: (idx: number) => void;
}) {
  const filtered = issues.filter((issue) => {
    if (issue.fixed) return false;
    if (severityFilter !== 'all' && issue.severity !== severityFilter) return false;
    return true;
  });

  const byChapter = new Map<number, ActionableIssue[]>();
  for (const issue of filtered) {
    const chapterIssues = byChapter.get(issue.chapterIndex) ?? [];
    chapterIssues.push(issue);
    byChapter.set(issue.chapterIndex, chapterIssues);
  }

  const sortedChapters = [...byChapter.keys()].sort((left, right) => left - right);

  return (
    <div className="divide-y divide-border/70">
      {sortedChapters.map((chapterIndex) => {
        const chapterIssues = byChapter.get(chapterIndex) ?? [];
        const chapterEntry = chapters[chapterIndex];
        const expanded = expandedChapters.has(chapterIndex);
        const criticalCount = chapterIssues.filter((issue) => issue.severity === 'critical').length;
        const majorCount = chapterIssues.filter((issue) => issue.severity === 'major').length;

        return (
          <div key={chapterIndex}>
            <div className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => onToggleChapter(chapterIndex)}
              >
                {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">第 {chapterIndex} 章</span>
                    {chapterEntry?.score !== undefined && (
                      <span className={`text-xs ${chapterEntry.score >= 80 ? 'text-emerald-500' : chapterEntry.score >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                        {chapterEntry.score} 分
                      </span>
                    )}
                    {criticalCount > 0 && <Badge variant="destructive" className="text-[10px]">{criticalCount} 严重</Badge>}
                    {majorCount > 0 && <Badge variant="secondary" className="text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">{majorCount} 重要</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{chapterIssues.length} 个待处理问题</p>
                </div>
              </button>

              <Button
                variant="ghost"
                size="sm"
                disabled={fixing !== null}
                onClick={() => onFixChapter(chapterIndex)}
              >
                <Wrench className="h-4 w-4" />
                <span className="hidden sm:inline">{fixing === chapterIndex ? '修复中...' : '修复'}</span>
              </Button>
            </div>

            {expanded && (
              <div className="space-y-2 border-t border-border/70 bg-muted/10 px-4 py-3">
                {chapterIssues.map((issue, index) => (
                  <div key={issue.issueId ?? `${chapterIndex}-${index}`} className="rounded-md border border-border/70 bg-background p-3">
                    <div className="flex items-start gap-2">
                      {issue.severity === 'critical' ? (
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                      ) : (
                        <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${severityTone(issue.severity)}`} />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm leading-6">{issue.description}</p>
                        {issue.suggestion && (
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{issue.suggestion}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {sortedChapters.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground">没有匹配的问题</div>
      )}
    </div>
  );
}
