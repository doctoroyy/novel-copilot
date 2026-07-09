/**
 * Project Health Service — aggregates QC, Story Vault, and generation state
 * into author-understandable health dimensions.
 *
 * Phase 3: turns QC from a "report page" into a daily writing safety net.
 */

import { getDb } from '../db/db.js';
import type { Database } from 'better-sqlite3';
import { resolveProjectForUser } from './storyVaultService.js';

export type HealthDimension = {
  key: string;
  label: string;
  status: 'healthy' | 'warning' | 'critical';
  score: number; // 0-100
  summary: string;
  details: Array<{ label: string; value: string; severity?: 'info' | 'warning' | 'critical' }>;
};

export type ProjectHealth = {
  projectId: string;
  projectName: string;
  overallScore: number;
  overallStatus: 'healthy' | 'warning' | 'critical';
  dimensions: HealthDimension[];
  recentQcIssues: Array<{
    chapterIndex: number;
    type: string;
    severity: string;
    description: string;
    suggestion?: string;
  }>;
  foreshadowInventory: {
    total: number;
    open: number;
    resolved: number;
    overdue: number;
    items: Array<{ name: string; status: string; kind: string; summary: string }>;
  };
  generatedAt: number;
};

function parseArr(raw: string | null | undefined): any[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function getProjectHealth(
  projectRef: string,
  userId: string,
): Promise<ProjectHealth> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');

  const state = db.prepare(`SELECT * FROM states WHERE project_id = ?`).get(project.id) as any;
  const openLoops = parseArr(state?.open_loops).map(String);
  const nextChapter = Number(state?.next_chapter_index || 1);
  const totalChapters = Number(state?.total_chapters || 0);
  const generatedChapters = Math.max(0, nextChapter - 1);

  // QC data
  const qcRows = db.prepare(`
    SELECT chapter_index, passed, score, qc_json FROM chapter_qc
    WHERE project_id = ? ORDER BY chapter_index ASC
  `).all(project.id) as any[];

  const qcPassed = qcRows.filter((r) => r.passed === 1).length;
  const qcFailed = qcRows.length - qcPassed;
  const avgScore = qcRows.length > 0
    ? Math.round(qcRows.reduce((sum, r) => sum + Number(r.score || 0), 0) / qcRows.length)
    : 0;

  // Story Vault threads (foreshadow inventory)
  const threads = db.prepare(`
    SELECT name, kind, status, summary, first_chapter, last_chapter
    FROM story_threads WHERE project_id = ? ORDER BY updated_at DESC
  `).all(project.id) as any[];

  const openThreads = threads.filter((t) => t.status === 'open' || t.status === 'active');
  const resolvedThreads = threads.filter((t) => t.status === 'resolved');
  const overdueThreads = openThreads.filter((t) => {
    if (t.last_chapter && t.last_chapter < generatedChapters) return true;
    if (t.first_chapter && t.first_chapter < generatedChapters - 15) return true;
    return false;
  });

  // Story Vault entities
  const entityCount = (db.prepare(`SELECT COUNT(*) as c FROM story_entities WHERE project_id = ?`).get(project.id) as any)?.c || 0;
  const characterCount = (db.prepare(`SELECT COUNT(*) as c FROM story_entities WHERE project_id = ? AND type = 'character'`).get(project.id) as any)?.c || 0;

  // Ledger cost data
  const ledgerRow = db.prepare(`
    SELECT COUNT(*) as jobs, COALESCE(SUM(estimated_cost), 0) as cost,
           COALESCE(SUM(estimated_input_tokens), 0) as input_tokens,
           COALESCE(SUM(estimated_output_tokens), 0) as output_tokens
    FROM ai_job_ledger WHERE project_id = ?
  `).get(project.id) as any;

  // Recent QC issues
  const recentIssues: ProjectHealth['recentQcIssues'] = [];
  for (const row of qcRows.slice(-5)) {
    try {
      const qc = JSON.parse(row.qc_json);
      for (const issue of (qc.issues || []).slice(0, 3)) {
        recentIssues.push({
          chapterIndex: row.chapter_index,
          type: issue.type || 'unknown',
          severity: issue.severity || 'minor',
          description: issue.description || '',
          suggestion: issue.suggestion,
        });
      }
    } catch { /* ignore */ }
  }

  // Build dimensions
  const dimensions: HealthDimension[] = [];

  // 1. 设定冲突 (consistency)
  const consistencyIssues = recentIssues.filter((i) => i.type === 'character');
  dimensions.push({
    key: 'consistency',
    label: '设定一致性',
    status: consistencyIssues.some((i) => i.severity === 'critical') ? 'critical'
      : consistencyIssues.length > 0 ? 'warning' : 'healthy',
    score: avgScore,
    summary: consistencyIssues.length === 0 ? '无设定冲突' : `${consistencyIssues.length} 个一致性问题`,
    details: [
      { label: '已检章节', value: `${qcRows.length} / ${generatedChapters}` },
      { label: '通过率', value: qcRows.length > 0 ? `${Math.round((qcPassed / qcRows.length) * 100)}%` : 'N/A' },
      { label: '角色实体', value: String(characterCount) },
    ],
  });

  // 2. 伏笔库存 (foreshadow inventory)
  const foreshadowScore = threads.length === 0 ? 100
    : Math.round(((resolvedThreads.length + (openThreads.length - overdueThreads.length)) / threads.length) * 100);
  dimensions.push({
    key: 'foreshadow',
    label: '伏笔库存',
    status: overdueThreads.length > 3 ? 'critical' : overdueThreads.length > 0 ? 'warning' : 'healthy',
    score: foreshadowScore,
    summary: `${openThreads.length} 条开放, ${overdueThreads.length} 条逾期, ${resolvedThreads.length} 条已回收`,
    details: [
      { label: '总线索', value: String(threads.length) },
      { label: '开放', value: String(openThreads.length), severity: openThreads.length > 10 ? 'warning' : 'info' },
      { label: '逾期', value: String(overdueThreads.length), severity: overdueThreads.length > 0 ? 'critical' : 'info' },
      { label: '已回收', value: String(resolvedThreads.length) },
    ],
  });

  // 3. 节奏 (pacing)
  const pacingIssues = recentIssues.filter((i) => i.type === 'pacing');
  dimensions.push({
    key: 'pacing',
    label: '节奏与爽点',
    status: pacingIssues.some((i) => i.severity === 'critical') ? 'critical'
      : pacingIssues.length > 2 ? 'warning' : 'healthy',
    score: avgScore,
    summary: pacingIssues.length === 0 ? '节奏正常' : `${pacingIssues.length} 个节奏问题`,
    details: [
      { label: '已生成', value: `${generatedChapters} / ${totalChapters} 章` },
      { label: '进度', value: totalChapters > 0 ? `${Math.round((generatedChapters / totalChapters) * 100)}%` : 'N/A' },
    ],
  });

  // 4. 人物弧线 (character arc)
  dimensions.push({
    key: 'character_arc',
    label: '人物弧线',
    status: characterCount === 0 ? 'warning' : 'healthy',
    score: characterCount === 0 ? 0 : Math.min(100, 50 + characterCount * 10),
    summary: characterCount === 0 ? '尚无角色设定' : `${characterCount} 个角色在资料库中`,
    details: [
      { label: '角色数', value: String(characterCount) },
      { label: '开放线索', value: String(openLoops.length) },
    ],
  });

  // 5. 成本 (cost)
  const totalCost = Number(ledgerRow?.cost || 0);
  const totalTokens = Number(ledgerRow?.input_tokens || 0) + Number(ledgerRow?.output_tokens || 0);
  dimensions.push({
    key: 'cost',
    label: 'AI 成本',
    status: totalCost > 10 ? 'warning' : 'healthy',
    score: Math.max(0, 100 - Math.round(totalCost * 5)),
    summary: `$${totalCost.toFixed(4)} (${totalTokens.toLocaleString()} tokens, ${ledgerRow?.jobs || 0} 次调用)`,
    details: [
      { label: '总调用', value: String(ledgerRow?.jobs || 0) },
      { label: '估算成本', value: `$${totalCost.toFixed(4)}` },
      { label: 'Token 用量', value: totalTokens.toLocaleString() },
    ],
  });

  const overallScore = dimensions.length > 0
    ? Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length)
    : 0;
  const overallStatus: ProjectHealth['overallStatus'] =
    dimensions.some((d) => d.status === 'critical') ? 'critical'
    : dimensions.some((d) => d.status === 'warning') ? 'warning'
    : 'healthy';

  return {
    projectId: project.id,
    projectName: project.name,
    overallScore,
    overallStatus,
    dimensions,
    recentQcIssues: recentIssues.slice(0, 15),
    foreshadowInventory: {
      total: threads.length,
      open: openThreads.length,
      resolved: resolvedThreads.length,
      overdue: overdueThreads.length,
      items: openThreads.slice(0, 20).map((t) => ({
        name: t.name, status: t.status, kind: t.kind, summary: t.summary || '',
      })),
    },
    generatedAt: Date.now(),
  };
}
