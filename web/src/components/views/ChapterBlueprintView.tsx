/**
 * ChapterBlueprintView — Phase 2 main workspace for per-chapter planning.
 *
 * Combines:
 *  - Chapter Blueprint editor (goal, conflict, hook, scene beats, criteria)
 *  - Context Inspector ("what will the AI see") — builds a context package
 *    from the Story Vault and shows selected entities/threads with reasons
 *  - AI Job Ledger summary (cost / token traceability for this project)
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ClipboardList,
  Eye,
  Plus,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Loader2,
  DollarSign,
  Clock,
  Cpu,
} from 'lucide-react';
import {
  fetchBlueprint,
  saveBlueprint,
  setBlueprintStatus,
  buildContextPackage,
  fetchLedgerSummary,
  type ChapterBlueprint,
  type SceneBeat,
  type ContextPackage,
  type LedgerSummary,
} from '@/lib/api';

interface Props {
  projectId: string;
  projectName: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  ready: '就绪',
  generating: '生成中',
  drafted: '已起草',
  reviewing: '审阅中',
  committed: '已提交',
  archived: '已归档',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  ready: 'bg-blue-500/15 text-blue-600',
  generating: 'bg-amber-500/15 text-amber-600',
  drafted: 'bg-purple-500/15 text-purple-600',
  reviewing: 'bg-orange-500/15 text-orange-600',
  committed: 'bg-green-500/15 text-green-600',
  archived: 'bg-muted text-muted-foreground',
};

export function ChapterBlueprintView({ projectId: _projectId, projectName }: Props) {
  const [chapterIndex, setChapterIndex] = useState(1);
  const [blueprint, setBlueprint] = useState<ChapterBlueprint | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contextPkg, setContextPkg] = useState<{ package: ContextPackage; serialized: string } | null>(null);
  const [buildingContext, setBuildingContext] = useState(false);
  const [ledger, setLedger] = useState<LedgerSummary | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [showLedger, setShowLedger] = useState(false);

  // Local editable form state
  const [title, setTitle] = useState('');
  const [goalPrimary, setGoalPrimary] = useState('');
  const [conflict, setConflict] = useState('');
  const [hook, setHook] = useState('');
  const [authorNotes, setAuthorNotes] = useState('');
  const [sceneBeats, setSceneBeats] = useState<SceneBeat[]>([]);
  const [criteria, setCriteria] = useState<string[]>([]);

  const loadBlueprint = useCallback(async (chapter: number) => {
    setLoading(true);
    setContextPkg(null);
    try {
      const bp = await fetchBlueprint(projectName, chapter);
      setBlueprint(bp);
      if (bp) {
        setTitle(bp.title || `第 ${chapter} 章`);
        setGoalPrimary(bp.goal?.primary || '');
        setConflict(bp.conflict || '');
        setHook(bp.hook || '');
        setAuthorNotes(bp.authorNotes || '');
        setSceneBeats(bp.sceneBeats || []);
        setCriteria(bp.acceptanceCriteria || []);
      } else {
        setTitle(`第 ${chapter} 章`);
        setGoalPrimary('');
        setConflict('');
        setHook('');
        setAuthorNotes('');
        setSceneBeats([]);
        setCriteria([]);
      }
    } catch (e) {
      console.error('Failed to load blueprint', e);
    } finally {
      setLoading(false);
    }
  }, [projectName]);

  useEffect(() => {
    loadBlueprint(chapterIndex);
  }, [chapterIndex, loadBlueprint]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const bp = await saveBlueprint(projectName, chapterIndex, {
        title,
        goal: { primary: goalPrimary },
        conflict,
        hook,
        authorNotes,
        sceneBeats,
        acceptanceCriteria: criteria,
      });
      setBlueprint(bp);
    } catch (e) {
      console.error('Failed to save blueprint', e);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (status: ChapterBlueprint['status']) => {
    try {
      const bp = await setBlueprintStatus(projectName, chapterIndex, status);
      setBlueprint(bp);
    } catch (e) {
      console.error('Failed to update status', e);
    }
  };

  const handleBuildContext = async () => {
    setBuildingContext(true);
    try {
      const result = await buildContextPackage(projectName, {
        chapterIndex,
        taskType: 'chapter_draft',
        blueprint: goalPrimary ? JSON.stringify({ goal: { primary: goalPrimary }, conflict, hook, sceneBeats }) : undefined,
        goalHint: goalPrimary,
      });
      setContextPkg(result);
      setShowContext(true);
    } catch (e) {
      console.error('Failed to build context', e);
    } finally {
      setBuildingContext(false);
    }
  };

  const loadLedger = async () => {
    try {
      const summary = await fetchLedgerSummary(projectName);
      setLedger(summary);
      setShowLedger(true);
    } catch (e) {
      console.error('Failed to load ledger', e);
    }
  };

  // Scene beat helpers
  const addBeat = () => {
    setSceneBeats((prev) => [...prev, { id: `beat-${prev.length + 1}-${Date.now()}`, summary: '', action: '', emotion: '', infoReveal: '', characters: [] }]);
  };
  const updateBeat = (id: string, field: keyof SceneBeat, value: any) => {
    setSceneBeats((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  };
  const removeBeat = (id: string) => setSceneBeats((prev) => prev.filter((b) => b.id !== id));
  const moveBeat = (idx: number, dir: -1 | 1) => {
    setSceneBeats((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const addCriterion = () => setCriteria((prev) => [...prev, '']);
  const updateCriterion = (idx: number, value: string) => setCriteria((prev) => prev.map((c, i) => (i === idx ? value : c)));
  const removeCriterion = (idx: number) => setCriteria((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {/* Chapter selector + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm">章节</Label>
          <Input
            type="number"
            min={1}
            value={chapterIndex}
            onChange={(e) => setChapterIndex(Math.max(1, Number(e.target.value)))}
            className="w-20"
          />
        </div>
        {blueprint && (
          <Badge className={STATUS_COLORS[blueprint.status] || STATUS_COLORS.draft}>
            {STATUS_LABELS[blueprint.status] || blueprint.status}
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={handleBuildContext} disabled={buildingContext}>
            {buildingContext ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            上下文预览
          </Button>
          <Button variant="outline" size="sm" onClick={loadLedger}>
            <DollarSign className="h-4 w-4" />
            成本面板
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存蓝图
          </Button>
        </div>
      </div>

      {/* Blueprint editor */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            章节蓝图 — 第 {chapterIndex} 章
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label className="text-sm">标题</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="章节标题" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm">本章主目标</Label>
            <Textarea value={goalPrimary} onChange={(e) => setGoalPrimary(e.target.value)} placeholder="这一章要推进什么？主角的核心冲突是什么？" rows={2} />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label className="text-sm">冲突</Label>
              <Textarea value={conflict} onChange={(e) => setConflict(e.target.value)} placeholder="本章的核心矛盾冲突" rows={2} />
            </div>
            <div className="grid gap-2">
              <Label className="text-sm">钩子 (Hook)</Label>
              <Textarea value={hook} onChange={(e) => setHook(e.target.value)} placeholder="章末钩子，吸引读者继续看下一章" rows={2} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label className="text-sm">作者备注 / 本章禁忌</Label>
            <Textarea value={authorNotes} onChange={(e) => setAuthorNotes(e.target.value)} placeholder="不要出现…、必须包含…、文风要求…" rows={2} />
          </div>

          {/* Scene Beats */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">场景节拍 (Scene Beats)</Label>
              <Button variant="outline" size="sm" onClick={addBeat}>
                <Plus className="h-3 w-3" /> 添加节拍
              </Button>
            </div>
            {sceneBeats.length === 0 && (
              <p className="text-xs text-muted-foreground">暂无场景节拍。把这一章拆成几个场景：行动、情绪、信息揭示。</p>
            )}
            {sceneBeats.map((beat, idx) => (
              <div key={beat.id} className="rounded-lg border border-border p-3 space-y-2 bg-card/50">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium text-muted-foreground">节拍 {idx + 1}</span>
                  <div className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => moveBeat(idx, -1)} disabled={idx === 0}>
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => moveBeat(idx, 1)} disabled={idx === sceneBeats.length - 1}>
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeBeat(beat.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <Input
                  value={beat.summary}
                  onChange={(e) => updateBeat(beat.id, 'summary', e.target.value)}
                  placeholder="场景概述（一句话）"
                  className="text-sm"
                />
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <Input value={beat.action} onChange={(e) => updateBeat(beat.id, 'action', e.target.value)} placeholder="行动" className="text-xs" />
                  <Input value={beat.emotion} onChange={(e) => updateBeat(beat.id, 'emotion', e.target.value)} placeholder="情绪" className="text-xs" />
                  <Input value={beat.infoReveal} onChange={(e) => updateBeat(beat.id, 'infoReveal', e.target.value)} placeholder="信息揭示" className="text-xs" />
                </div>
              </div>
            ))}
          </div>

          {/* Acceptance Criteria */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">验收标准</Label>
              <Button variant="outline" size="sm" onClick={addCriterion}>
                <Plus className="h-3 w-3" /> 添加
              </Button>
            </div>
            {criteria.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input value={c} onChange={(e) => updateCriterion(idx, e.target.value)} placeholder={`验收条件 ${idx + 1}`} className="text-sm" />
                <Button variant="ghost" size="sm" onClick={() => removeCriterion(idx)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>

          {/* Status actions */}
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button variant="outline" size="sm" onClick={() => handleStatusChange('ready')}>标记就绪</Button>
            <Button variant="outline" size="sm" onClick={() => handleStatusChange('committed')}>标记已提交</Button>
          </div>
        </CardContent>
      </Card>

      {/* Context Inspector */}
      {showContext && contextPkg && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4" />
              上下文预览 (Context Inspector)
              <Badge variant="outline" className={contextPkg.package.tokenBudget.withinBudget ? 'text-green-600' : 'text-amber-600'}>
                {contextPkg.package.tokenBudget.estimatedTokens} / {contextPkg.package.tokenBudget.inputBudget} tokens
              </Badge>
              <Badge variant="outline" className="font-mono text-xs">
                {contextPkg.package.promptHash}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              AI 生成时将看到以下内容。每条都标注了选中理由，你可以回到资料库调整重要性或触发词来影响选择。
            </div>

            {/* Selected items with reasons */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">选中的设定与线索 ({contextPkg.package.selectedItems.length})</Label>
              {contextPkg.package.selectedItems.length === 0 && (
                <p className="text-xs text-muted-foreground">未选中任何 Story Vault 条目。请在资料库添加实体或触发词。</p>
              )}
              {contextPkg.package.selectedItems.map((item) => (
                <div key={`${item.kind}-${item.refId}`} className="rounded-md border border-border p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{item.kind === 'entity' ? item.type : item.kind}</Badge>
                    <span className="font-medium">{item.name}</span>
                    <span className="ml-auto text-muted-foreground">{item.tokenEstimate} tok</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    <span className="font-medium text-amber-600">理由:</span> {item.reasonDetail}
                  </div>
                  <div className="mt-1 line-clamp-2 text-muted-foreground/80">{item.snippet}</div>
                </div>
              ))}
            </div>

            {/* Essentials */}
            <details className="rounded-md border border-border p-2">
              <summary className="cursor-pointer text-xs font-medium">完整上下文序列化（system prompt 注入）</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
                {contextPkg.serialized}
              </pre>
            </details>
          </CardContent>
        </Card>
      )}

      {/* Ledger / Cost panel */}
      {showLedger && ledger && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4" />
              AI 调用成本与用量
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric icon={Cpu} label="总调用" value={String(ledger.totalJobs)} sub={`${ledger.completed} 成功 / ${ledger.failed} 失败`} />
              <Metric icon={DollarSign} label="总成本" value={`$${ledger.totalCost.toFixed(4)}`} sub="估算" />
              <Metric icon={Cpu} label="输入 tokens" value={ledger.totalInputTokens.toLocaleString()} sub={`输出 ${ledger.totalOutputTokens.toLocaleString()}`} />
              <Metric icon={Clock} label="总耗时" value={`${(ledger.totalDurationMs / 1000).toFixed(1)}s`} sub={`缓存命中 ${ledger.totalInputTokens > 0 ? ((ledger.totalCacheReadTokens / ledger.totalInputTokens) * 100).toFixed(0) : 0}%`} />
            </div>
            {Object.keys(ledger.byModel).length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">按模型</Label>
                {Object.entries(ledger.byModel).map(([model, stat]) => (
                  <div key={model} className="flex items-center justify-between text-xs">
                    <span className="font-mono">{model}</span>
                    <span className="text-muted-foreground">{stat.count} 次 · ${stat.cost.toFixed(4)} · {stat.tokens.toLocaleString()} tok</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
