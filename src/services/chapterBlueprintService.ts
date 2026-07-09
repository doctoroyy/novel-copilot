/**
 * Chapter Blueprint service — the editable plan for a single chapter before
 * drafting. Covers goal, conflict, hook, scene beats, state-delta plan,
 * acceptance criteria and author notes.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/db.js';
import type { Database } from 'better-sqlite3';
import { resolveProjectForUser } from './storyVaultService.js';

export type SceneBeat = {
  id: string;
  summary: string;
  action: string;
  emotion: string;
  infoReveal: string;
  characters: string[];
};

export type ChapterGoal = {
  primary: string;
  secondary?: string;
  emotional?: string;
};

export type ChapterBlueprint = {
  id: string;
  projectId: string;
  chapterIndex: number;
  title: string;
  goal: ChapterGoal;
  conflict: string;
  hook: string;
  sceneBeats: SceneBeat[];
  stateDeltaPlan: Array<{ target: string; change: string; reason: string }>;
  acceptanceCriteria: string[];
  authorNotes: string;
  status: 'draft' | 'ready' | 'generating' | 'drafted' | 'reviewing' | 'committed' | 'archived';
  createdAt: number;
  updatedAt: number;
};

function nowMs() { return Date.now(); }

function parseArr(raw: string | null | undefined): any[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}
function parseObj(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

function mapRow(row: any): ChapterBlueprint {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterIndex: Number(row.chapter_index),
    title: row.title || '',
    goal: parseObj(row.goal_json) as ChapterGoal,
    conflict: row.conflict || '',
    hook: row.hook || '',
    sceneBeats: parseArr(row.scene_beats_json) as SceneBeat[],
    stateDeltaPlan: parseArr(row.state_delta_plan_json),
    acceptanceCriteria: parseArr(row.acceptance_criteria_json).map(String),
    authorNotes: row.author_notes || '',
    status: row.status,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export async function getBlueprint(
  projectRef: string,
  userId: string,
  chapterIndex: number,
): Promise<ChapterBlueprint | null> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  const row = db.prepare(`
    SELECT * FROM chapter_blueprints WHERE project_id = ? AND chapter_index = ?
  `).get(project.id, chapterIndex) as any;
  return row ? mapRow(row) : null;
}

export async function listBlueprints(
  projectRef: string,
  userId: string,
): Promise<ChapterBlueprint[]> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  return (db.prepare(`
    SELECT * FROM chapter_blueprints WHERE project_id = ? ORDER BY chapter_index ASC
  `).all(project.id) as any[]).map(mapRow);
}

export async function upsertBlueprint(
  projectRef: string,
  userId: string,
  chapterIndex: number,
  input: Partial<Omit<ChapterBlueprint, 'id' | 'projectId' | 'chapterIndex' | 'createdAt' | 'updatedAt'>> & {
    title?: string; goal?: ChapterGoal; conflict?: string; hook?: string;
    sceneBeats?: SceneBeat[]; stateDeltaPlan?: Array<{ target: string; change: string; reason: string }>;
    acceptanceCriteria?: string[]; authorNotes?: string; status?: ChapterBlueprint['status'];
  },
): Promise<ChapterBlueprint> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');

  const existing = db.prepare(`
    SELECT * FROM chapter_blueprints WHERE project_id = ? AND chapter_index = ?
  `).get(project.id, chapterIndex) as any;

  const goal = input.goal ?? (existing ? parseObj(existing.goal_json) : {});
  const sceneBeats = (input.sceneBeats ?? (existing ? parseArr(existing.scene_beats_json) : []))
    .map((b: any, i: number) => ({ id: b.id || `beat-${i + 1}`, ...b }));
  const stateDelta = input.stateDeltaPlan ?? (existing ? parseArr(existing.state_delta_plan_json) : []);
  const criteria = input.acceptanceCriteria ?? (existing ? parseArr(existing.acceptance_criteria_json).map(String) : []);

  const fields = {
    title: input.title ?? existing?.title ?? `第 ${chapterIndex} 章`,
    goal_json: JSON.stringify(goal),
    conflict: input.conflict ?? existing?.conflict ?? '',
    hook: input.hook ?? existing?.hook ?? '',
    scene_beats_json: JSON.stringify(sceneBeats),
    state_delta_plan_json: JSON.stringify(stateDelta),
    acceptance_criteria_json: JSON.stringify(criteria),
    author_notes: input.authorNotes ?? existing?.author_notes ?? '',
    status: input.status ?? existing?.status ?? 'draft',
  };

  if (existing) {
    db.prepare(`
      UPDATE chapter_blueprints SET
        title = ?, goal_json = ?, conflict = ?, hook = ?, scene_beats_json = ?,
        state_delta_plan_json = ?, acceptance_criteria_json = ?, author_notes = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(fields.title, fields.goal_json, fields.conflict, fields.hook, fields.scene_beats_json,
      fields.state_delta_plan_json, fields.acceptance_criteria_json, fields.author_notes, fields.status,
      nowMs(), existing.id);
    return mapRow(db.prepare(`SELECT * FROM chapter_blueprints WHERE id = ?`).get(existing.id));
  }

  const id = randomUUID();
  const ts = nowMs();
  db.prepare(`
    INSERT INTO chapter_blueprints (
      id, project_id, chapter_index, title, goal_json, conflict, hook,
      scene_beats_json, state_delta_plan_json, acceptance_criteria_json, author_notes, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, project.id, chapterIndex, fields.title, fields.goal_json, fields.conflict, fields.hook,
    fields.scene_beats_json, fields.state_delta_plan_json, fields.acceptance_criteria_json, fields.author_notes,
    fields.status, ts, ts);
  return mapRow(db.prepare(`SELECT * FROM chapter_blueprints WHERE id = ?`).get(id));
}

export async function deleteBlueprint(
  projectRef: string,
  userId: string,
  chapterIndex: number,
): Promise<void> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  db.prepare(`DELETE FROM chapter_blueprints WHERE project_id = ? AND chapter_index = ?`).run(project.id, chapterIndex);
}

export async function setBlueprintStatus(
  projectRef: string,
  userId: string,
  chapterIndex: number,
  status: ChapterBlueprint['status'],
): Promise<ChapterBlueprint> {
  return upsertBlueprint(projectRef, userId, chapterIndex, { status });
}
