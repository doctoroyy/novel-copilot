import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, ShieldCheck, ShieldAlert, Play, RefreshCw, Wrench,
  ChevronDown, ChevronRight, AlertTriangle, AlertCircle, Info,
  TrendingUp, Users, GitBranch, Swords, Filter, XCircle
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

export function QualityView({ project }: QualityViewProps) {
  const [report, setReport] = useState<QCReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState<number | 'all' | null>(null);
  const [activeBackendTaskId, setActiveBackendTaskId] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>('standard');
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const { startTask, completeTask: completeCtxTask, cancelTask: cancelCtxTask } = useGeneration();
  const fixTaskIdRef = useRef<string | null>(null);
  const scanTaskIdRef = useRef<string | null>(null);

  const loadReport = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);
      const r = await getQCReport(project.name);
      setReport(r);
      if (r?.status === 'running') {
        setScanning(true);
        if (r.taskId) setActiveBackendTaskId(r.taskId);
      } else if (r?.status === 'repairing') {
        setScanning(false);
        if (r.taskId) setActiveBackendTaskId(r.taskId);
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
    loadReport();
  }, [loadReport]);

  // Sync fixing state from report status (handles page refresh & completion)
  useEffect(() => {
    if (report?.status === 'repairing' && fixing === null) {
      setFixing('all'); // restore fixing indicator on page load
      // Also register in GenerationContext so floating ball shows it
      const tid = startTask('qc_fix', '质量修复中...', project.name);
      fixTaskIdRef.current = tid;
    } else if (report?.status !== 'repairing' && fixing !== null) {
      setFixing(null); // repair done
      if (fixTaskIdRef.current) {
        completeCtxTask(fixTaskIdRef.current, true);
        fixTaskIdRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.status]);

  // Poll while scanning (silent refresh, no loading flash)
  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(() => loadReport(false), 3000);
    return () => clearInterval(interval);
  }, [scanning, loadReport]);

  // Poll while fixing (same pattern as scanning)
  useEffect(() => {
    if (fixing === null) return;
    const interval = setInterval(() => loadReport(false), 3000);
    return () => clearInterval(interval);
  }, [fixing, loadReport]);

  const handleStartScan = async () => {
    try {
      setScanning(true);
      setError(null);
      const res = await startQCScan(project.name, scanMode);
      const tid = startTask('qc', '高质量扫描中...', project.name, undefined, res.taskId);
      scanTaskIdRef.current = tid;
      setTimeout(loadReport, 1000);
    } catch (err) {
      setError((err as Error).message);
      setScanning(false);
    }
  };

  const handleCancelScan = async () => {
    // console.log("Attempting to cancel scan...", { tid: scanTaskIdRef.current, activeBackendTaskId });
    setCancelling(true);
    const tid = scanTaskIdRef.current || fixTaskIdRef.current;
    
    try {
      if (tid) {
        // First try the context task to update floating ball UI
        await cancelCtxTask(tid).catch(e => console.warn("Context cancel failed:", e));
      }
      
      if (activeBackendTaskId) {
        // Always try direct numeric cancellation for robustness
        await cancelTaskById(activeBackendTaskId);
      } else {
        // Ultimate fallback: cancel everything for this project
        await cancelAllActiveTasks(project.name);
      }
      
      setScanning(false);
      setFixing(null);
      setActiveBackendTaskId(null);
      setTimeout(() => {
        loadReport(true);
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
      const res = await fixChapterIssues(project.name, chapterIndex, report.reportId);
      const tid = startTask('qc_fix', `修复第 ${chapterIndex} 章...`, project.name, undefined, res.taskId);
      fixTaskIdRef.current = tid;
      // Don't clear fixing here - polling will clear it when report status changes
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
      const res = await fixAllIssues(project.name, report.reportId);
      const tid = startTask('qc_fix', '批量质量修复中...', project.name, undefined, res.taskId);
      fixTaskIdRef.current = tid;
      // Don't clear fixing here - polling will clear it when report status changes
    } catch (err) {
      setError((err as Error).message);
      setFixing(null);
      if (fixTaskIdRef.current) {
        completeCtxTask(fixTaskIdRef.current, false);
        fixTaskIdRef.current = null;
      }
    }
  };

  const toggleChapter = (idx: number) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const reportData = report?.data;
  const hasChapters = project.chapters && project.chapters.length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 lg:p-6 max-w-6xl mx-auto">
      {error && (
        <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Header: Score + Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <ScoreRing score={report?.overallScore ?? 0} size={72} />
          <div>
            <h2 className="text-xl font-bold">质量报告</h2>
            {report && report.status === 'completed' && (
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  {report.criticalCount} 严重
                </span>
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                  {report.majorCount} 重要
                </span>
                <span className="flex items-center gap-1">
                  <Info className="h-3.5 w-3.5 text-yellow-500" />
                  {report.minorCount} 轻微
                </span>
              </div>
            )}
            {report?.status === 'running' && (
              <p className="text-sm text-muted-foreground mt-1">扫描进行中...</p>
            )}
            {!report && (
              <p className="text-sm text-muted-foreground mt-1">尚未进行质量扫描</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={scanMode} onValueChange={(v) => setScanMode(v as ScanMode)}>
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quick">快速扫描</SelectItem>
              <SelectItem value="standard">标准扫描</SelectItem>
              <SelectItem value="full">全量扫描</SelectItem>
            </SelectContent>
          </Select>
            {scanning || cancelling ? (
              <div className="flex items-center gap-3">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={handleCancelScan} 
                  disabled={cancelling}
                  className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title="取消扫描"
                >
                  {cancelling ? (
                    <RefreshCw className="h-5 w-5 animate-spin" />
                  ) : (
                    <XCircle className="h-5 w-5" />
                  )}
                </Button>
                <div className="flex items-center text-sm font-medium animate-pulse text-primary shrink-0">
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                  {cancelling ? '正在取消...' : '扫描中...'}
                </div>
              </div>
            ) : (
              <Button onClick={handleStartScan} disabled={scanning || !hasChapters} size="sm">
                <Play className="h-4 w-4 mr-1" />{report ? '重新扫描' : '开始扫描'}
              </Button>
            )}
        </div>
      </div>

      {!hasChapters && (
        <div className="text-center py-10 text-muted-foreground">
          <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>没有章节可扫描</p>
          <p className="text-sm mt-1">请先生成章节后再进行质量检测</p>
        </div>
      )}

      {/* Global Analysis Cards */}
      {reportData?.globalAnalysis && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <GlobalCard
            icon={TrendingUp}
            title="节奏曲线"
            score={reportData.globalAnalysis.pacingCurve?.score}
            items={reportData.globalAnalysis.pacingCurve?.deadSpots?.map(
              (d: any) => `第${d.from}-${d.to}章: ${d.reason}`
            ) || []}
            emptyText="未发现节奏问题"
          />
          <GlobalCard
            icon={Users}
            title="角色弧线"
            score={reportData.globalAnalysis.characterArcs?.score}
            items={reportData.globalAnalysis.characterArcs?.characters?.map(
              (c: any) => `${c.name}: ${c.arcComplete ? '完整' : '不完整'} - ${c.notes}`
            ) || []}
            emptyText="无角色数据"
          />
          <GlobalCard
            icon={GitBranch}
            title="伏笔回收"
            score={reportData.globalAnalysis.plotThreads?.score}
            items={reportData.globalAnalysis.plotThreads?.threads?.map(
              (t: any) => `第${t.introducedAt}章引入: ${t.description}`
            ) || []}
            emptyText="未发现未解决的伏笔"
            badge={reportData.globalAnalysis.plotThreads?.unresolvedCount > 0
              ? `${reportData.globalAnalysis.plotThreads.unresolvedCount} 未回收`
              : undefined
            }
          />
          <GlobalCard
            icon={Swords}
            title="冲突分布"
            score={reportData.globalAnalysis.conflictDensity?.score}
            items={reportData.globalAnalysis.conflictDensity?.distribution?.map(
              (d: any) => `${d.range}: 密度 ${d.density}`
            ) || []}
            emptyText="无冲突数据"
          />
        </div>
      )}

      {/* Chapter Issues List */}
      {reportData?.actionableIssues && reportData.actionableIssues.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              章节问题 ({reportData.actionableIssues.filter((i: any) => !i.fixed).length} 待修复)
            </h3>
            <div className="flex items-center gap-2">
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="w-[100px] h-8 text-xs">
                  <Filter className="h-3 w-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="critical">严重</SelectItem>
                  <SelectItem value="major">重要</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFixAll}
                disabled={fixing !== null || scanning}
              >
                <Wrench className="h-4 w-4 mr-1" />
                {fixing === 'all' ? '修复中...' : '修复全部'}
              </Button>
            </div>
          </div>

          <IssueList
            issues={reportData.actionableIssues}
            chapters={reportData.chapters}
            severityFilter={severityFilter}
            expandedChapters={expandedChapters}
            fixing={fixing}
            onToggleChapter={toggleChapter}
            onFixChapter={handleFixChapter}
          />
        </div>
      )}

      {report?.status === 'completed' && reportData?.actionableIssues?.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-500" />
          <p className="text-lg font-medium">所有章节通过质量检测</p>
          <p className="text-sm mt-1">整体评分 {report.overallScore}/100</p>
        </div>
      )}
    </div>
  );
}

// === Sub-components ===

function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke="currentColor" className="text-muted/20"
          strokeWidth={4} fill="none"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={color} strokeWidth={4} fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold">{score}</span>
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
  icon: any;
  title: string;
  score?: number;
  items: string[];
  emptyText: string;
  badge?: string;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">{title}</span>
          {badge && (
            <Badge variant="secondary" className="text-xs">{badge}</Badge>
          )}
        </div>
        {score !== undefined && (
          <span className={`text-sm font-bold ${
            score >= 80 ? 'text-green-500' : score >= 60 ? 'text-yellow-500' : 'text-red-500'
          }`}>
            {score}/100
          </span>
        )}
      </div>
      {items.length > 0 ? (
        <ul className="space-y-1 mt-2">
          {items.slice(0, 5).map((item, i) => (
            <li key={i} className="text-xs text-muted-foreground leading-relaxed">
              {item}
            </li>
          ))}
          {items.length > 5 && (
            <li className="text-xs text-muted-foreground">...还有 {items.length - 5} 项</li>
          )}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground mt-2">{emptyText}</p>
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
  issues: any[];
  chapters: Record<number, any>;
  severityFilter: string;
  expandedChapters: Set<number>;
  fixing: number | 'all' | null;
  onToggleChapter: (idx: number) => void;
  onFixChapter: (idx: number) => void;
}) {
  const filtered = issues.filter((i: any) => {
    if (i.fixed) return false;
    if (severityFilter !== 'all' && i.severity !== severityFilter) return false;
    return true;
  });

  // Group by chapter
  const byChapter = new Map<number, any[]>();
  for (const issue of filtered) {
    const arr = byChapter.get(issue.chapterIndex) || [];
    arr.push(issue);
    byChapter.set(issue.chapterIndex, arr);
  }

  const sortedChapters = [...byChapter.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-2">
      {sortedChapters.map(chIdx => {
        const chIssues = byChapter.get(chIdx)!;
        const chEntry = chapters[chIdx];
        const expanded = expandedChapters.has(chIdx);

        return (
          <div key={chIdx} className="border border-border rounded-lg bg-card overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
              onClick={() => onToggleChapter(chIdx)}
            >
              <div className="flex items-center gap-3">
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-medium text-sm">第 {chIdx} 章</span>
                {chEntry && (
                  <span className={`text-xs ${
                    chEntry.score >= 80 ? 'text-green-500' : chEntry.score >= 60 ? 'text-yellow-500' : 'text-red-500'
                  }`}>
                    {chEntry.score}分
                  </span>
                )}
                <div className="flex items-center gap-1.5">
                  {chIssues.filter((i: any) => i.severity === 'critical').length > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                      {chIssues.filter((i: any) => i.severity === 'critical').length} 严重
                    </Badge>
                  )}
                  {chIssues.filter((i: any) => i.severity === 'major').length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                      {chIssues.filter((i: any) => i.severity === 'major').length} 重要
                    </Badge>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                disabled={fixing !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  onFixChapter(chIdx);
                }}
              >
                <Wrench className="h-3.5 w-3.5 mr-1" />
                {fixing === chIdx ? '修复中...' : '修复'}
              </Button>
            </button>

            {expanded && (
              <div className="px-4 pb-3 space-y-2 border-t border-border pt-2">
                {chIssues.map((issue: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {issue.severity === 'critical' ? (
                      <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-foreground">{issue.description}</p>
                      {issue.suggestion && (
                        <p className="text-xs text-muted-foreground mt-0.5">{issue.suggestion}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {sortedChapters.length === 0 && (
        <div className="text-center py-6 text-muted-foreground text-sm">
          没有匹配的问题
        </div>
      )}
    </div>
  );
}
