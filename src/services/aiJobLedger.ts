/**
 * AI Job Ledger — records every AI call so cost, tokens, duration and context
 * are always traceable. Backed by the `ai_job_ledger` table.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/db.js';
import type { Database } from 'better-sqlite3';

export type LedgerPhase =
  | 'planning' | 'drafting' | 'review' | 'repair'
  | 'summary' | 'extract' | 'qc' | 'other';

export type LedgerStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type LedgerJob = {
  id: string;
  projectId?: string;
  contextPackageId?: string;
  provider: string;
  model: string;
  phase: LedgerPhase;
  taskType?: string;
  chapterIndex?: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  toolReadTokens: number;
  estimatedCost: number;
  durationMs: number;
  status: LedgerStatus;
  errorMessage?: string;
  agentTurns: number;
  createdAt: number;
  updatedAt: number;
};

// Rough per-1K-token pricing in USD. Used only for estimates; real billing
// comes from provider usage headers.
const PRICE_PER_1K: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-sonnet': { input: 0.003, output: 0.015, cacheRead: 0.0003, cacheWrite: 0.00375 },
  'claude-opus': { input: 0.015, output: 0.075, cacheRead: 0.0015, cacheWrite: 0.01875 },
  'claude-haiku': { input: 0.0008, output: 0.004, cacheRead: 0.00008, cacheWrite: 0.001 },
  'gpt-4o': { input: 0.0025, output: 0.01, cacheRead: 0.00125, cacheWrite: 0 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006, cacheRead: 0.000075, cacheWrite: 0 },
  default: { input: 0.003, output: 0.015, cacheRead: 0.0003, cacheWrite: 0.00375 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheRead = 0,
  cacheCreation = 0,
): number {
  const key = Object.keys(PRICE_PER_1K).find((k) => model.toLowerCase().includes(k));
  const p = PRICE_PER_1K[key || 'default'];
  return (
    (inputTokens / 1000) * p.input +
    (outputTokens / 1000) * p.output +
    (cacheRead / 1000) * p.cacheRead +
    (cacheCreation / 1000) * p.cacheWrite
  );
}

function mapRow(row: any): LedgerJob {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    contextPackageId: row.context_package_id ?? undefined,
    provider: row.provider,
    model: row.model,
    phase: row.phase,
    taskType: row.task_type ?? undefined,
    chapterIndex: row.chapter_index ?? undefined,
    estimatedInputTokens: Number(row.estimated_input_tokens) || 0,
    estimatedOutputTokens: Number(row.estimated_output_tokens) || 0,
    cacheReadTokens: Number(row.cache_read_tokens) || 0,
    cacheCreationTokens: Number(row.cache_creation_tokens) || 0,
    toolReadTokens: Number(row.tool_read_tokens) || 0,
    estimatedCost: Number(row.estimated_cost) || 0,
    durationMs: Number(row.duration_ms) || 0,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    agentTurns: Number(row.agent_turns) || 0,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

/**
 * Start a ledger job. Returns the job id and a `finish()` callback that records
 * the final token/cost/duration when the AI work is done.
 */
export function startLedgerJob(params: {
  provider: string;
  model: string;
  phase: LedgerPhase;
  projectId?: string;
  contextPackageId?: string;
  taskType?: string;
  chapterIndex?: number;
  db?: Database;
}): { id: string; finish: (result: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  toolReadTokens?: number;
  durationMs?: number;
  status?: LedgerStatus;
  error?: string;
  agentTurns?: number;
}) => void } {
  const id = randomUUID();
  const now = Date.now();
  const db = params.db ?? safeGetDb();

  if (db) {
    try {
      db.prepare(`
        INSERT INTO ai_job_ledger (
          id, project_id, context_package_id, provider, model, phase, task_type, chapter_index,
          estimated_input_tokens, estimated_output_tokens, cache_read_tokens, cache_creation_tokens,
          tool_read_tokens, estimated_cost, duration_ms, status, error_message, agent_turns, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 'running', NULL, 0, ?, ?)
      `).run(
        id, params.projectId ?? null, params.contextPackageId ?? null,
        params.provider, params.model, params.phase, params.taskType ?? null, params.chapterIndex ?? null,
        now, now,
      );
    } catch (e) {
      // Ledger is best-effort; never block generation
      console.warn('[aiJobLedger] insert failed:', (e as Error).message);
    }
  }

  const finish = (result: {
    inputTokens?: number; outputTokens?: number;
    cacheReadTokens?: number; cacheCreationTokens?: number;
    toolReadTokens?: number; durationMs?: number;
    status?: LedgerStatus; error?: string; agentTurns?: number;
  }) => {
    if (!db) return;
    const inputTokens = result.inputTokens ?? 0;
    const outputTokens = result.outputTokens ?? 0;
    const cacheRead = result.cacheReadTokens ?? 0;
    const cacheCreation = result.cacheCreationTokens ?? 0;
    const cost = estimateCost(params.model, inputTokens, outputTokens, cacheRead, cacheCreation);
    const status = result.status ?? (result.error ? 'failed' : 'completed');
    try {
      db.prepare(`
        UPDATE ai_job_ledger SET
          estimated_input_tokens = ?, estimated_output_tokens = ?,
          cache_read_tokens = ?, cache_creation_tokens = ?, tool_read_tokens = ?,
          estimated_cost = ?, duration_ms = ?, status = ?, error_message = ?, agent_turns = ?, updated_at = ?
        WHERE id = ?
      `).run(
        inputTokens, outputTokens, cacheRead, cacheCreation, result.toolReadTokens ?? 0,
        cost, result.durationMs ?? 0, status, result.error ?? null, result.agentTurns ?? 0,
        Date.now(), id,
      );
    } catch (e) {
      console.warn('[aiJobLedger] update failed:', (e as Error).message);
    }
  };

  return { id, finish };
}

function safeGetDb(): Database | undefined {
  try { return getDb(); } catch { return undefined; }
}

export function listLedgerJobs(
  projectId?: string,
  options?: { phase?: LedgerPhase; limit?: number; db?: Database },
): LedgerJob[] {
  const db = options?.db ?? safeGetDb();
  if (!db) return [];
  const limit = Math.min(options?.limit ?? 50, 200);
  if (projectId) {
    return (db.prepare(`
      SELECT * FROM ai_job_ledger WHERE project_id = ?
      ${options?.phase ? 'AND phase = ?' : ''}
      ORDER BY created_at DESC LIMIT ?
    `).all(...(options?.phase ? [projectId, options.phase] : [projectId]), limit) as any[]).map(mapRow);
  }
  return (db.prepare(`
    SELECT * FROM ai_job_ledger
    ${options?.phase ? 'WHERE phase = ?' : ''}
    ORDER BY created_at DESC LIMIT ?
  `).all(...(options?.phase ? [options.phase] : []), limit) as any[]).map(mapRow);
}

export type LedgerSummary = {
  totalJobs: number;
  completed: number;
  failed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
  totalDurationMs: number;
  byPhase: Record<string, { count: number; cost: number; tokens: number }>;
  byModel: Record<string, { count: number; cost: number; tokens: number }>;
};

export function getLedgerSummary(projectId?: string): LedgerSummary {
  const db = safeGetDb();
  if (!db) return emptySummary();
  const rows = (projectId
    ? db.prepare(`SELECT * FROM ai_job_ledger WHERE project_id = ? ORDER BY created_at DESC LIMIT 500`).all(projectId)
    : db.prepare(`SELECT * FROM ai_job_ledger ORDER BY created_at DESC LIMIT 500`).all()
  ) as any[];

  const byPhase: Record<string, { count: number; cost: number; tokens: number }> = {};
  const byModel: Record<string, { count: number; cost: number; tokens: number }> = {};
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCost = 0, completed = 0, failed = 0, totalDur = 0;

  for (const r of rows) {
    const job = mapRow(r);
    totalInput += job.estimatedInputTokens;
    totalOutput += job.estimatedOutputTokens;
    totalCacheRead += job.cacheReadTokens;
    totalCost += job.estimatedCost;
    totalDur += job.durationMs;
    if (job.status === 'completed') completed++;
    if (job.status === 'failed') failed++;
    const ph = (byPhase[job.phase] ??= { count: 0, cost: 0, tokens: 0 });
    ph.count++; ph.cost += job.estimatedCost; ph.tokens += job.estimatedInputTokens + job.estimatedOutputTokens;
    const md = (byModel[job.model] ??= { count: 0, cost: 0, tokens: 0 });
    md.count++; md.cost += job.estimatedCost; md.tokens += job.estimatedInputTokens + job.estimatedOutputTokens;
  }

  return {
    totalJobs: rows.length, completed, failed,
    totalInputTokens: totalInput, totalOutputTokens: totalOutput,
    totalCacheReadTokens: totalCacheRead, totalCost, totalDurationMs: totalDur,
    byPhase, byModel,
  };
}

function emptySummary(): LedgerSummary {
  return { totalJobs: 0, completed: 0, failed: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCost: 0, totalDurationMs: 0, byPhase: {}, byModel: {} };
}
