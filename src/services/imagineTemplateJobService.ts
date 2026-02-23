import {
  refreshImagineTemplatesForDate,
  toChinaDateKey,
  type ImagineTemplateEnv,
} from './imagineTemplateService.js';

export type ImagineTemplateJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ImagineTemplateRefreshJob {
  id: string;
  snapshotDate: string;
  force: boolean;
  source: string;
  requestedByUserId: string | null;
  requestedByRole: string;
  sourceUrls: string[];
  maxTemplates: number | null;
  status: ImagineTemplateJobStatus;
  message: string | null;
  errorMessage: string | null;
  resultTemplateCount: number;
  resultHotCount: number;
  skipped: boolean;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  updatedAt: number;
}

export interface ImagineTemplateJobEnv extends ImagineTemplateEnv {
  GENERATION_QUEUE?: Queue<any>;
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeSnapshotDate(raw: unknown): string {
  const value = cleanText(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return toChinaDateKey();
}

function parseSourceUrls(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((entry) => cleanText(entry)).filter(Boolean);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => cleanText(entry)).filter(Boolean);
      }
    } catch {
      // ignore json parse failure
    }
    return raw
      .split('\n')
      .map((entry) => cleanText(entry))
      .filter(Boolean);
  }
  return [];
}

function parseJobRow(row: any): ImagineTemplateRefreshJob | null {
  if (!row) return null;

  return {
    id: cleanText(row.id),
    snapshotDate: normalizeSnapshotDate(row.snapshot_date),
    force: Number(row.force || 0) === 1,
    source: cleanText(row.source || 'manual') || 'manual',
    requestedByUserId: row.requested_by_user_id ? String(row.requested_by_user_id) : null,
    requestedByRole: cleanText(row.requested_by_role || 'user') || 'user',
    sourceUrls: parseSourceUrls(row.source_urls_json),
    maxTemplates:
      row.max_templates === null || row.max_templates === undefined
        ? null
        : Number.parseInt(String(row.max_templates), 10) || null,
    status: ['queued', 'running', 'completed', 'failed'].includes(String(row.status))
      ? (String(row.status) as ImagineTemplateJobStatus)
      : 'queued',
    message: row.message ? String(row.message) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    resultTemplateCount: Number(row.result_template_count || 0),
    resultHotCount: Number(row.result_hot_count || 0),
    skipped: Number(row.skipped || 0) === 1,
    createdAt: Number(row.created_at || 0),
    startedAt: row.started_at === null || row.started_at === undefined ? null : Number(row.started_at),
    finishedAt: row.finished_at === null || row.finished_at === undefined ? null : Number(row.finished_at),
    updatedAt: Number(row.updated_at || 0),
  };
}

export async function getImagineTemplateRefreshJob(
  db: D1Database,
  jobId: string
): Promise<ImagineTemplateRefreshJob | null> {
  const row = await db.prepare(`
    SELECT *
    FROM ai_imagine_template_jobs
    WHERE id = ?
    LIMIT 1
  `).bind(cleanText(jobId)).first();

  return parseJobRow(row);
}

export async function listImagineTemplateRefreshJobs(
  db: D1Database,
  options?: {
    limit?: number;
    requestedByUserId?: string;
    status?: ImagineTemplateJobStatus;
    snapshotDate?: string;
  }
): Promise<ImagineTemplateRefreshJob[]> {
  const limit = Math.max(1, Math.min(200, options?.limit ?? 20));
  const where: string[] = [];
  const binds: unknown[] = [];

  if (options?.requestedByUserId) {
    where.push('requested_by_user_id = ?');
    binds.push(options.requestedByUserId);
  }
  if (options?.status) {
    where.push('status = ?');
    binds.push(options.status);
  }
  if (options?.snapshotDate) {
    where.push('snapshot_date = ?');
    binds.push(normalizeSnapshotDate(options.snapshotDate));
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT *
    FROM ai_imagine_template_jobs
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ?
  `;

  const rows = await db.prepare(sql).bind(...binds, limit).all();
  return ((rows.results || []) as any[])
    .map((row) => parseJobRow(row))
    .filter(Boolean) as ImagineTemplateRefreshJob[];
}

export async function createImagineTemplateRefreshJob(
  db: D1Database,
  options?: {
    snapshotDate?: string;
    force?: boolean;
    requestedByUserId?: string | null;
    requestedByRole?: string;
    source?: string;
    sourceUrls?: string[];
    maxTemplates?: number;
    dedupeActive?: boolean;
  }
): Promise<{ job: ImagineTemplateRefreshJob; created: boolean }> {
  const now = Date.now();
  const staleRunningBefore = now - 20 * 60 * 1000;

  await db.prepare(`
    UPDATE ai_imagine_template_jobs
    SET
      status = 'failed',
      message = '任务执行超时，已自动结束',
      error_message = COALESCE(error_message, '任务执行超时，请重试'),
      finished_at = COALESCE(finished_at, ?),
      updated_at = ?
    WHERE status = 'running'
    AND started_at IS NOT NULL
    AND started_at < ?
  `).bind(now, now, staleRunningBefore).run();

  const snapshotDate = normalizeSnapshotDate(options?.snapshotDate);
  const force = options?.force === undefined ? true : Boolean(options.force);
  const requestedByUserId = options?.requestedByUserId ? cleanText(options.requestedByUserId) : null;
  const requestedByRole = cleanText(options?.requestedByRole || 'user') || 'user';
  const source = cleanText(options?.source || 'manual') || 'manual';
  const sourceUrls = (options?.sourceUrls || []).map((url) => cleanText(url)).filter(Boolean);
  const maxTemplates = options?.maxTemplates && Number.isFinite(options.maxTemplates)
    ? Math.max(1, Math.min(50, Math.trunc(options.maxTemplates)))
    : null;
  const dedupeActive = options?.dedupeActive !== false;

  if (dedupeActive) {
    const existingRow = await db.prepare(`
      SELECT *
      FROM ai_imagine_template_jobs
      WHERE snapshot_date = ?
      AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(snapshotDate).first();

    const existing = parseJobRow(existingRow);
    if (existing) {
      return { job: existing, created: false };
    }
  }

  const id = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO ai_imagine_template_jobs (
      id,
      snapshot_date,
      force,
      source,
      requested_by_user_id,
      requested_by_role,
      source_urls_json,
      max_templates,
      status,
      message,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
  `).bind(
    id,
    snapshotDate,
    force ? 1 : 0,
    source,
    requestedByUserId,
    requestedByRole,
    sourceUrls.length ? JSON.stringify(sourceUrls) : null,
    maxTemplates,
    '任务已创建，等待队列执行',
    now,
    now
  ).run();

  const job = await getImagineTemplateRefreshJob(db, id);
  if (!job) {
    throw new Error('Failed to create imagine template refresh job');
  }

  return { job, created: true };
}

export async function enqueueImagineTemplateRefreshJob(params: {
  env: ImagineTemplateJobEnv;
  jobId: string;
  executionCtx?: ExecutionContext;
}): Promise<void> {
  const { env, jobId, executionCtx } = params;
  const payload = {
    taskType: 'imagine_templates',
    jobId,
  };

  if (env.GENERATION_QUEUE) {
    await env.GENERATION_QUEUE.send(payload);
    return;
  }

  if (executionCtx) {
    executionCtx.waitUntil(runImagineTemplateRefreshJob(env, jobId));
    return;
  }

  await runImagineTemplateRefreshJob(env, jobId);
}

export async function runImagineTemplateRefreshJob(
  env: ImagineTemplateEnv,
  jobId: string
): Promise<ImagineTemplateRefreshJob | null> {
  const current = await getImagineTemplateRefreshJob(env.DB, jobId);
  if (!current) {
    throw new Error(`Imagine template refresh job not found: ${jobId}`);
  }

  if (current.status === 'completed' || current.status === 'failed') {
    return current;
  }

  const startedAt = Date.now();
  await env.DB.prepare(`
    UPDATE ai_imagine_template_jobs
    SET
      status = 'running',
      message = ?,
      started_at = COALESCE(started_at, ?),
      updated_at = ?
    WHERE id = ?
    AND status IN ('queued', 'running')
  `).bind('正在抓取榜单并生成模板...', startedAt, startedAt, current.id).run();

  try {
    const result = await refreshImagineTemplatesForDate(env, {
      snapshotDate: current.snapshotDate,
      force: current.force,
      sourceUrls: current.sourceUrls.length > 0 ? current.sourceUrls : undefined,
      maxTemplates: current.maxTemplates || undefined,
    });

    const finishedAt = Date.now();
    if (result.status === 'error') {
      await env.DB.prepare(`
        UPDATE ai_imagine_template_jobs
        SET
          status = 'failed',
          message = ?,
          error_message = ?,
          result_template_count = ?,
          result_hot_count = ?,
          skipped = ?,
          finished_at = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        '模板生成失败',
        result.errorMessage || 'Unknown error',
        result.templateCount,
        result.hotCount,
        result.skipped ? 1 : 0,
        finishedAt,
        finishedAt,
        current.id
      ).run();
    } else {
      await env.DB.prepare(`
        UPDATE ai_imagine_template_jobs
        SET
          status = 'completed',
          message = ?,
          error_message = NULL,
          result_template_count = ?,
          result_hot_count = ?,
          skipped = ?,
          finished_at = ?,
          updated_at = ?
        WHERE id = ?
      `).bind(
        result.skipped ? '已存在可用模板，无需重复生成' : '模板生成完成',
        result.templateCount,
        result.hotCount,
        result.skipped ? 1 : 0,
        finishedAt,
        finishedAt,
        current.id
      ).run();
    }
  } catch (error) {
    const finishedAt = Date.now();
    const errorMessage = (error as Error).message || 'Unknown error';

    await env.DB.prepare(`
      UPDATE ai_imagine_template_jobs
      SET
        status = 'failed',
        message = ?,
        error_message = ?,
        finished_at = ?,
        updated_at = ?
      WHERE id = ?
    `).bind('模板生成失败', errorMessage, finishedAt, finishedAt, current.id).run();
  }

  return getImagineTemplateRefreshJob(env.DB, current.id);
}
