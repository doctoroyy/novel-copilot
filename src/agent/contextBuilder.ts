/**
 * ContextBuilder — the observable, testable context assembly layer.
 *
 * Replaces the scattered context-stitching that used to live inside
 * generation/contextOptimizer/agent. Every AI call now flows through here:
 *
 *   1. Rule-based selection of Story Vault entities/threads whose trigger terms
 *      or aliases appear in the chapter blueprint, rolling summary, or goal hint.
 *   2. Token-budget enforcement so we never dump the whole vault/book into context.
 *   3. Every selected item carries a `source` and `reason` so the author can see
 *      exactly what the AI "saw" (Context Inspector).
 *   4. The assembled package is persisted to `context_packages` and hash-stamped
 *      for reproducibility.
 */

import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type {
  StoryEntity,
  StoryThread,
} from '../services/storyVaultService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextItemReason = 'trigger_match' | 'high_importance' | 'open_thread' | 'style_rule' | 'premise' | 'recent_chapter';

export type SelectedContextItem = {
  kind: 'entity' | 'thread' | 'style' | 'summary' | 'blueprint';
  refId: string;
  name: string;
  type?: string;
  snippet: string;
  importance: number;
  reason: ContextItemReason;
  reasonDetail: string;
  tokenEstimate: number;
};

export type TokenBudget = {
  inputBudget: number;
  estimatedTokens: number;
  withinBudget: boolean;
};

export type ContextPackage = {
  id: string;
  taskId: string;
  projectId: string;
  chapterIndex: number;
  taskType: string;
  essentials: {
    rollingSummary: string;
    currentBlueprint?: string;
    writingStyleRules: string;
    goalHint?: string;
  };
  selectedItems: SelectedContextItem[];
  availableResources: {
    chapters: number[];
    vaultEntityCount: number;
    vaultThreadCount: number;
  };
  tokenBudget: TokenBudget;
  promptHash: string;
  createdAt: number;
};

// ---------------------------------------------------------------------------
// Token estimation (rough: Chinese ~1.5 chars/token, English ~4 chars/token;
// we use a conservative 2 chars/token blend for CN/EN mixed content)
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 2);
}

const TASK_BUDGETS: Record<string, number> = {
  blueprint: 12_000,
  chapter_draft: 40_000,
  repair: 12_000,
  summary: 8_000,
  qc: 15_000,
  extract: 10_000,
  other: 20_000,
};

export function budgetForTask(taskType: string): number {
  return TASK_BUDGETS[taskType] ?? TASK_BUDGETS.other;
}

// ---------------------------------------------------------------------------
// Rule-based selection
// ---------------------------------------------------------------------------

function normalizeTerms(terms: string[]): string[] {
  return terms.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean);
}

function textMentions(haystack: string, terms: string[]): string[] {
  if (!haystack || terms.length === 0) return [];
  const lower = haystack.toLowerCase();
  const hits: string[] = [];
  for (const term of terms) {
    if (term.length >= 2 && lower.includes(term)) hits.push(term);
  }
  return hits;
}

type VaultSlice = {
  entities: StoryEntity[];
  threads: StoryThread[];
};

function selectEntities(
  entities: StoryEntity[],
  corpus: string,
  budgetTokens: number,
  consumedTokens: number,
): { items: SelectedContextItem[]; tokens: number } {
  const items: SelectedContextItem[] = [];
  let tokens = consumedTokens;

  // Score every entity by trigger/alias matches + importance
  const scored = entities
    .map((e) => {
      const terms = normalizeTerms([...(e.triggerTerms || []), ...(e.aliases || []), e.name]);
      const hits = textMentions(corpus, terms);
      const score = hits.length * 10 + (e.importance || 3);
      return { e, hits, score };
    })
    .sort((a, b) => b.score - a.score);

  for (const { e, hits } of scored) {
    if (tokens >= budgetTokens) break;
    // Always include premise/style; otherwise require a match or importance >= 4
    const isAlwaysIn = e.type === 'premise' || e.type === 'style';
    if (!isAlwaysIn && hits.length === 0 && (e.importance || 3) < 4) continue;

    const snippet = (e.content || '').slice(0, 1200);
    const t = estimateTokens(snippet);
    if (tokens + t > budgetTokens) continue; // skip rather than truncate mid-entry

    const reason: ContextItemReason = isAlwaysIn
      ? (e.type === 'premise' ? 'premise' : 'style_rule')
      : hits.length > 0
        ? 'trigger_match'
        : 'high_importance';

    items.push({
      kind: 'entity',
      refId: e.id,
      name: e.name,
      type: e.type,
      snippet,
      importance: e.importance,
      reason,
      reasonDetail: hits.length > 0 ? `触发词命中: ${hits.slice(0, 5).join('、')}` : (isAlwaysIn ? `${e.type} 类基础设定` : `重要性 ${e.importance}`),
      tokenEstimate: t,
    });
    tokens += t;
  }
  return { items, tokens };
}

function selectThreads(
  threads: StoryThread[],
  corpus: string,
  budgetTokens: number,
  consumedTokens: number,
): { items: SelectedContextItem[]; tokens: number } {
  const items: SelectedContextItem[] = [];
  let tokens = consumedTokens;

  const openOrActive = threads.filter((t) => t.status === 'open' || t.status === 'active');
  const scored = openOrActive
    .map((t) => {
      const terms = normalizeTerms([t.name, ...(t.summary ? [t.summary.slice(0, 40)] : [])]);
      const hits = textMentions(corpus, terms);
      const score = hits.length * 10 + (t.status === 'active' ? 5 : 0);
      return { t, hits, score };
    })
    .sort((a, b) => b.score - a.score);

  for (const { t, hits } of scored) {
    if (tokens >= budgetTokens) break;
    // Include active/open threads relevant to the corpus, plus all active as a baseline cap
    if (hits.length === 0 && t.status !== 'active') continue;

    const snippet = [t.name, t.summary, t.stakes && ` stakes: ${t.stakes}`].filter(Boolean).join('\n').slice(0, 600);
    const tk = estimateTokens(snippet);
    if (tokens + tk > budgetTokens) continue;

    items.push({
      kind: 'thread',
      refId: t.id,
      name: t.name,
      type: t.kind,
      snippet,
      importance: t.status === 'active' ? 4 : 3,
      reason: hits.length > 0 ? 'trigger_match' : 'open_thread',
      reasonDetail: hits.length > 0 ? `命中: ${hits.slice(0, 3).join('、')}` : `开放线索 (${t.kind})`,
      tokenEstimate: tk,
    });
    tokens += tk;
  }
  return { items, tokens };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadVaultSlice(db: Database, projectId: string): VaultSlice {
  const entityRows = db.prepare(`
    SELECT * FROM story_entities WHERE project_id = ? ORDER BY importance DESC, updated_at DESC
  `).all(projectId) as any[];
  const threadRows = db.prepare(`
    SELECT * FROM story_threads WHERE project_id = ? ORDER BY updated_at DESC
  `).all(projectId) as any[];

  const parseArr = (raw: string | null | undefined): any[] => {
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const parseObj = (raw: string | null | undefined): Record<string, unknown> => {
    if (!raw) return {};
    try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  };

  const entities: StoryEntity[] = entityRows.map((r) => ({
    id: r.id, projectId: r.project_id, type: r.type, name: r.name,
    aliases: parseArr(r.aliases_json).map(String), content: r.content || '',
    status: parseObj(r.status_json), triggerTerms: parseArr(r.trigger_terms_json).map(String),
    importance: Number(r.importance) || 3, lastReferencedChapter: r.last_referenced_chapter ?? null,
    sourceRefs: parseArr(r.source_refs_json), createdAt: Number(r.created_at) || 0, updatedAt: Number(r.updated_at) || 0,
  }));
  const threads: StoryThread[] = threadRows.map((r) => ({
    id: r.id, projectId: r.project_id, name: r.name, kind: r.kind, status: r.status,
    summary: r.summary || '', stakes: r.stakes || '', relatedEntityIds: parseArr(r.related_entity_ids_json).map(String),
    firstChapter: r.first_chapter ?? null, lastChapter: r.last_chapter ?? null,
    createdAt: Number(r.created_at) || 0, updatedAt: Number(r.updated_at) || 0,
  }));

  return { entities, threads };
}

function persistPackage(db: Database, pkg: ContextPackage): void {
  const inputRefs = pkg.selectedItems.map((i) => ({
    kind: i.kind, refId: i.refId, name: i.name, reason: i.reason, reasonDetail: i.reasonDetail, tokens: i.tokenEstimate,
  }));
  db.prepare(`
    INSERT INTO context_packages (
      id, project_id, task_type, chapter_index, blueprint_id,
      input_refs_json, package_json, token_budget_json, estimated_tokens, prompt_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pkg.id, pkg.projectId, pkg.taskType, pkg.chapterIndex ?? null, null,
    JSON.stringify(inputRefs), JSON.stringify(pkg), JSON.stringify(pkg.tokenBudget),
    pkg.tokenBudget.estimatedTokens, pkg.promptHash, pkg.createdAt,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type BuildContextParams = {
  taskId: string;
  projectId: string;
  chapterIndex: number;
  taskType?: string;
  rollingSummary?: string;
  currentBlueprint?: string;
  goalHint?: string;
  writingStyleRules?: string;
  totalChapters?: number;
  recentChapterIndices?: number[];
  db?: Database;
  persist?: boolean;
};

export function buildContextPackage(params: BuildContextParams): ContextPackage {
  const taskType = params.taskType || 'chapter_draft';
  const budget = budgetForTask(taskType);

  const rollingSummary = params.rollingSummary || '';
  const blueprint = params.currentBlueprint || '';
  const goalHint = params.goalHint || '';
  const styleRules = params.writingStyleRules || '';

  // The corpus we match trigger terms against
  const corpus = [rollingSummary, blueprint, goalHint].join('\n');

  // Essentials always take precedence in the budget
  const summaryTokens = estimateTokens(rollingSummary);
  const blueprintTokens = estimateTokens(blueprint);
  const styleTokens = estimateTokens(styleRules);
  let consumed = summaryTokens + blueprintTokens + styleTokens;

  let selectedItems: SelectedContextItem[] = [];
  let vaultEntityCount = 0;
  let vaultThreadCount = 0;

  if (params.db) {
    const vault = loadVaultSlice(params.db, params.projectId);
    vaultEntityCount = vault.entities.length;
    vaultThreadCount = vault.threads.length;

    const entityRes = selectEntities(vault.entities, corpus, budget, consumed);
    consumed = entityRes.tokens;
    selectedItems.push(...entityRes.items);

    const threadRes = selectThreads(vault.threads, corpus, budget, consumed);
    consumed = threadRes.tokens;
    selectedItems.push(...threadRes.items);
  }

  const chapters = params.recentChapterIndices && params.recentChapterIndices.length > 0
    ? params.recentChapterIndices
    : Array.from({ length: Math.min(5, Math.max(0, (params.totalChapters || 0))) }, (_, i) => i + 1);

  const pkg: ContextPackage = {
    id: randomUUID(),
    taskId: params.taskId,
    projectId: params.projectId,
    chapterIndex: params.chapterIndex,
    taskType,
    essentials: {
      rollingSummary,
      currentBlueprint: blueprint || undefined,
      writingStyleRules: styleRules,
      goalHint: goalHint || undefined,
    },
    selectedItems,
    availableResources: {
      chapters,
      vaultEntityCount,
      vaultThreadCount,
    },
    tokenBudget: {
      inputBudget: budget,
      estimatedTokens: consumed,
      withinBudget: consumed <= budget,
    },
    promptHash: '',
    createdAt: Date.now(),
  };

  pkg.promptHash = hashPackage(pkg);

  if (params.db && params.persist !== false) {
    try { persistPackage(params.db, pkg); } catch (e) {
      // Persistence is best-effort; context assembly must not fail generation
      console.warn('[ContextBuilder] persist failed:', (e as Error).message);
    }
  }

  return pkg;
}

function hashPackage(pkg: ContextPackage): string {
  const payload = JSON.stringify({
    t: pkg.taskType,
    c: pkg.chapterIndex,
    e: pkg.essentials,
    s: pkg.selectedItems.map((i) => `${i.refId}:${i.snippet}`),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export function serializeContextPackage(pkg: ContextPackage): string {
  const entityLines = pkg.selectedItems
    .filter((i) => i.kind === 'entity')
    .map((i) => `### [${i.type}] ${i.name}\n理由: ${i.reasonDetail}\n${i.snippet}`)
    .join('\n\n');
  const threadLines = pkg.selectedItems
    .filter((i) => i.kind === 'thread')
    .map((i) => `### [线索/${i.type}] ${i.name}\n理由: ${i.reasonDetail}\n${i.snippet}`)
    .join('\n\n');

  return [
    `# 当前任务上下文 (Context Package)`,
    `Task ID: ${pkg.taskId}`,
    `Project: ${pkg.projectId}`,
    `Target Chapter: ${pkg.chapterIndex}`,
    `Task Type: ${pkg.taskType}`,
    `Token 预算: ${pkg.tokenBudget.estimatedTokens}/${pkg.tokenBudget.inputBudget} ${pkg.tokenBudget.withinBudget ? '✓' : '⚠ 超预算'}`,
    ``,
    `## 核心故事摘要 (Rolling Summary)`,
    pkg.essentials.rollingSummary || '无',
    ``,
    `## 写作风格与规则`,
    pkg.essentials.writingStyleRules || '无',
    pkg.essentials.currentBlueprint ? `\n## 本章蓝图 (Blueprint)\n${pkg.essentials.currentBlueprint}\n` : '',
    pkg.essentials.goalHint ? `\n## 本章目标提示\n${pkg.essentials.goalHint}\n` : '',
    entityLines ? `\n## 选中设定 (Story Vault Entities)\n${entityLines}\n` : '',
    threadLines ? `\n## 选中线索 (Story Threads)\n${threadLines}\n` : '',
    `\n## 可调用的资源目录 (用工具按需读取)`,
    `已存在章节: ${pkg.availableResources.chapters.length > 0 ? `第 ${Math.min(...pkg.availableResources.chapters)} - ${Math.max(...pkg.availableResources.chapters)} 章` : '无'}`,
    `Story Vault: ${pkg.availableResources.vaultEntityCount} 个实体, ${pkg.availableResources.vaultThreadCount} 条线索`,
  ].filter(Boolean).join('\n');
}

/**
 * Load a previously persisted context package by id (for the Context Inspector
 * and for reproducibility / ledger joins).
 */
export function loadContextPackage(db: Database, packageId: string): ContextPackage | null {
  const row = db.prepare(`SELECT * FROM context_packages WHERE id = ?`).get(packageId) as any;
  if (!row) return null;
  try {
    const pkg = JSON.parse(row.package_json) as ContextPackage;
    return pkg;
  } catch {
    return null;
  }
}

export function listContextPackages(
  db: Database,
  projectId: string,
  options?: { chapterIndex?: number; taskType?: string; limit?: number },
): Array<ContextPackage & { id: string; createdAt: number }> {
  const limit = Math.min(options?.limit ?? 30, 100);
  const where = [`project_id = ?`];
  const args: any[] = [projectId];
  if (options?.chapterIndex != null) { where.push(`chapter_index = ?`); args.push(options.chapterIndex); }
  if (options?.taskType) { where.push(`task_type = ?`); args.push(options.taskType); }
  const rows = db.prepare(`
    SELECT * FROM context_packages WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?
  `).all(...args, limit) as any[];
  return rows.map((r) => {
    try { return JSON.parse(r.package_json); } catch { return null; }
  }).filter(Boolean) as Array<ContextPackage & { id: string; createdAt: number }>;
}
