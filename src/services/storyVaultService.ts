/**
 * Story Vault service — structured story assets for local-first workspace.
 * Backfills from legacy bible / characters / plot_graphs on first access.
 */

import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../db/db.js';

export type StoryEntityType =
  | 'premise'
  | 'style'
  | 'world'
  | 'character'
  | 'location'
  | 'item'
  | 'faction'
  | 'rule'
  | 'thread'
  | 'market'
  | 'note';

export type StoryEntity = {
  id: string;
  projectId: string;
  type: StoryEntityType;
  name: string;
  aliases: string[];
  content: string;
  status: Record<string, unknown>;
  triggerTerms: string[];
  importance: number;
  lastReferencedChapter: number | null;
  sourceRefs: Array<Record<string, unknown>>;
  createdAt: number;
  updatedAt: number;
};

export type StoryThread = {
  id: string;
  projectId: string;
  name: string;
  kind: 'main' | 'sub' | 'foreshadow' | 'romance' | 'mystery' | 'other';
  status: 'open' | 'active' | 'paused' | 'resolved' | 'abandoned';
  summary: string;
  stakes: string;
  relatedEntityIds: string[];
  firstChapter: number | null;
  lastChapter: number | null;
  createdAt: number;
  updatedAt: number;
};

export type StoryNote = {
  id: string;
  projectId: string;
  title: string;
  content: string;
  tags: string[];
  source: 'manual' | 'extract' | 'import' | 'agent';
  createdAt: number;
  updatedAt: number;
};

export type StoryExtractProposal = {
  id: string;
  projectId: string;
  sourceType: 'chapter' | 'bible' | 'chat' | 'manual';
  sourceRef: string | null;
  summary: string;
  entities: Array<Partial<StoryEntity> & { type: StoryEntityType; name: string; content?: string }>;
  threads: Array<Partial<StoryThread> & { name: string }>;
  notes: Array<Partial<StoryNote> & { content: string }>;
  status: 'pending' | 'accepted' | 'rejected' | 'partial';
  createdAt: number;
  updatedAt: number;
};

export type StoryVaultSnapshot = {
  projectId: string;
  projectName: string;
  bibleRaw: string;
  entities: StoryEntity[];
  threads: StoryThread[];
  notes: StoryNote[];
  counts: Record<string, number>;
  health: {
    entityCount: number;
    openThreadCount: number;
    openLoopCount: number;
    generatedChapters: number;
    totalChapters: number;
    hasBible: boolean;
    hasOutline: boolean;
  };
  migrated: boolean;
};

type ProjectRow = {
  id: string;
  name: string;
  bible: string | null;
  user_id: string;
};

function nowMs() {
  return Date.now();
}

function parseJsonArray(raw: string | null | undefined): any[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function mapEntity(row: any): StoryEntity {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    name: row.name,
    aliases: parseJsonArray(row.aliases_json).map(String),
    content: row.content || '',
    status: parseJsonObject(row.status_json),
    triggerTerms: parseJsonArray(row.trigger_terms_json).map(String),
    importance: Number(row.importance) || 3,
    lastReferencedChapter: row.last_referenced_chapter ?? null,
    sourceRefs: parseJsonArray(row.source_refs_json) as Array<Record<string, unknown>>,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function mapThread(row: any): StoryThread {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    summary: row.summary || '',
    stakes: row.stakes || '',
    relatedEntityIds: parseJsonArray(row.related_entity_ids_json).map(String),
    firstChapter: row.first_chapter ?? null,
    lastChapter: row.last_chapter ?? null,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function mapNote(row: any): StoryNote {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title || '',
    content: row.content || '',
    tags: parseJsonArray(row.tags_json).map(String),
    source: row.source,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function mapProposal(row: any): StoryExtractProposal {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    summary: row.summary || '',
    entities: parseJsonArray(row.entities_json),
    threads: parseJsonArray(row.threads_json),
    notes: parseJsonArray(row.notes_json),
    status: row.status,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export async function resolveProjectForUser(
  db: Database,
  projectRef: string,
  userId: string,
): Promise<ProjectRow | null> {
  return db.prepare(`
    SELECT id, name, bible, user_id
    FROM projects
    WHERE (id = ? OR name = ?) AND deleted_at IS NULL AND user_id = ?
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at DESC
    LIMIT 1
  `).get(projectRef, projectRef, userId, projectRef) as ProjectRow | null;
}

function countEntities(db: Database, projectId: string): number {
  const row = db.prepare(`SELECT COUNT(*) as c FROM story_entities WHERE project_id = ?`).get(projectId) as { c: number };
  return Number(row?.c || 0);
}

function extractHeadingSections(markdown: string): Array<{ title: string; body: string }> {
  const lines = (markdown || '').split('\n');
  const sections: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string[] } | null = null;

  for (const line of lines) {
    const m = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (m) {
      if (current) sections.push({ title: current.title, body: current.body.join('\n').trim() });
      current = { title: m[2].replace(/\*/g, '').trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push({ title: current.title, body: current.body.join('\n').trim() });
  return sections.filter((s) => s.title);
}

function guessEntityType(title: string): StoryEntityType {
  const t = title.toLowerCase();
  if (/人设|角色|主角|配角|人物/.test(title) || /character/.test(t)) return 'character';
  if (/地点|地理|地图|城市|宗门驻地/.test(title) || /location|place/.test(t)) return 'location';
  if (/势力|门派|组织|帝国|王朝|公司/.test(title) || /faction|org/.test(t)) return 'faction';
  if (/规则|体系|力量|功法|系统|设定/.test(title) || /rule|system|power/.test(t)) return 'rule';
  if (/文风|风格|叙事|视角/.test(title) || /style/.test(t)) return 'style';
  if (/卖点|一句话|梗概|简介|premise/.test(title) || /premise|hook/.test(t)) return 'premise';
  if (/世界|背景|时代/.test(title) || /world/.test(t)) return 'world';
  if (/物品|法宝|道具|装备/.test(title) || /item/.test(t)) return 'item';
  return 'world';
}

function insertEntity(
  db: Database,
  projectId: string,
  input: {
    type: StoryEntityType;
    name: string;
    content?: string;
    aliases?: string[];
    triggerTerms?: string[];
    importance?: number;
    sourceRefs?: Array<Record<string, unknown>>;
    status?: Record<string, unknown>;
  },
): StoryEntity {
  const id = randomUUID();
  const ts = nowMs();
  db.prepare(`
    INSERT INTO story_entities (
      id, project_id, type, name, aliases_json, content, status_json,
      trigger_terms_json, importance, source_refs_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    input.type,
    input.name.trim(),
    JSON.stringify(input.aliases || []),
    input.content || '',
    JSON.stringify(input.status || {}),
    JSON.stringify(input.triggerTerms || [input.name.trim()].filter(Boolean)),
    input.importance ?? 3,
    JSON.stringify(input.sourceRefs || []),
    ts,
    ts,
  );
  return mapEntity(db.prepare(`SELECT * FROM story_entities WHERE id = ?`).get(id));
}

function insertThread(
  db: Database,
  projectId: string,
  input: {
    name: string;
    kind?: StoryThread['kind'];
    status?: StoryThread['status'];
    summary?: string;
    stakes?: string;
    relatedEntityIds?: string[];
    firstChapter?: number | null;
    lastChapter?: number | null;
  },
): StoryThread {
  const id = randomUUID();
  const ts = nowMs();
  db.prepare(`
    INSERT INTO story_threads (
      id, project_id, name, kind, status, summary, stakes,
      related_entity_ids_json, first_chapter, last_chapter, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    input.name.trim(),
    input.kind || 'main',
    input.status || 'open',
    input.summary || '',
    input.stakes || '',
    JSON.stringify(input.relatedEntityIds || []),
    input.firstChapter ?? null,
    input.lastChapter ?? null,
    ts,
    ts,
  );
  return mapThread(db.prepare(`SELECT * FROM story_threads WHERE id = ?`).get(id));
}

function insertNote(
  db: Database,
  projectId: string,
  input: { title?: string; content: string; tags?: string[]; source?: StoryNote['source'] },
): StoryNote {
  const id = randomUUID();
  const ts = nowMs();
  db.prepare(`
    INSERT INTO story_notes (id, project_id, title, content, tags_json, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    input.title || '',
    input.content || '',
    JSON.stringify(input.tags || []),
    input.source || 'manual',
    ts,
    ts,
  );
  return mapNote(db.prepare(`SELECT * FROM story_notes WHERE id = ?`).get(id));
}

/**
 * One-time backfill from legacy tables into Story Vault.
 */
export function migrateLegacyStoryAssets(db: Database, project: ProjectRow): boolean {
  if (countEntities(db, project.id) > 0) return false;

  let migrated = false;
  const bible = (project.bible || '').trim();
  if (bible) {
    insertEntity(db, project.id, {
      type: 'world',
      name: '完整设定（原始 Bible）',
      content: bible,
      importance: 5,
      sourceRefs: [{ source: 'projects.bible' }],
      triggerTerms: ['bible', '设定'],
    });

    const sections = extractHeadingSections(bible).slice(0, 40);
    for (const section of sections) {
      if (!section.body || section.body.length < 8) continue;
      insertEntity(db, project.id, {
        type: guessEntityType(section.title),
        name: section.title.slice(0, 80),
        content: section.body.slice(0, 8000),
        importance: 3,
        sourceRefs: [{ source: 'bible_heading', title: section.title }],
        triggerTerms: [section.title],
      });
    }
    migrated = true;
  }

  // characters_json graph
  const charRow = db.prepare(`SELECT characters_json FROM characters WHERE project_id = ?`).get(project.id) as
    | { characters_json: string }
    | undefined;
  if (charRow?.characters_json) {
    try {
      const graph = JSON.parse(charRow.characters_json);
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes : Array.isArray(graph?.characters) ? graph.characters : [];
      for (const node of nodes.slice(0, 80)) {
        const name = String(node.name || node.label || node.id || '').trim();
        if (!name) continue;
        const content = [
          node.description,
          node.role,
          node.personality,
          node.background,
          node.goal,
        ].filter(Boolean).join('\n');
        insertEntity(db, project.id, {
          type: 'character',
          name,
          content: content || JSON.stringify(node).slice(0, 2000),
          importance: node.importance ? Number(node.importance) : 3,
          sourceRefs: [{ source: 'characters_json', id: node.id }],
          status: {
            role: node.role || null,
            location: node.location || null,
          },
          triggerTerms: [name, ...(Array.isArray(node.aliases) ? node.aliases.map(String) : [])],
          aliases: Array.isArray(node.aliases) ? node.aliases.map(String) : [],
        });
        migrated = true;
      }
    } catch {
      // ignore bad json
    }
  }

  // plot graph foreshadowing -> threads
  const plotRow = db.prepare(`SELECT graph_json FROM plot_graphs WHERE project_id = ?`).get(project.id) as
    | { graph_json: string }
    | undefined;
  if (plotRow?.graph_json) {
    try {
      const graph = JSON.parse(plotRow.graph_json);
      const fores = Array.isArray(graph?.pendingForeshadowing) ? graph.pendingForeshadowing : [];
      for (const f of fores.slice(0, 50)) {
        insertThread(db, project.id, {
          name: String(f.summary || f.id || '未命名伏笔').slice(0, 80),
          kind: 'foreshadow',
          status: 'open',
          summary: String(f.summary || ''),
          stakes: `urgency=${f.urgency || 'medium'}`,
          firstChapter: Array.isArray(f.suggestedResolutionRange) ? f.suggestedResolutionRange[0] : null,
          lastChapter: Array.isArray(f.suggestedResolutionRange) ? f.suggestedResolutionRange[1] : null,
        });
        migrated = true;
      }
      const mainPlots = Array.isArray(graph?.activeMainPlots) ? graph.activeMainPlots : [];
      const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
      for (const id of mainPlots.slice(0, 20)) {
        const node = nodes.find((n: any) => n.id === id);
        if (!node) continue;
        insertThread(db, project.id, {
          name: String(node.content || node.id).slice(0, 80),
          kind: 'main',
          status: node.status === 'resolved' ? 'resolved' : 'active',
          summary: String(node.content || ''),
        });
        migrated = true;
      }
    } catch {
      // ignore
    }
  }

  // open loops from states
  const stateRow = db.prepare(`SELECT open_loops FROM states WHERE project_id = ?`).get(project.id) as
    | { open_loops: string }
    | undefined;
  if (stateRow?.open_loops) {
    const loops = parseJsonArray(stateRow.open_loops);
    for (const loop of loops.slice(0, 30)) {
      const text = String(loop || '').trim();
      if (!text) continue;
      insertThread(db, project.id, {
        name: text.slice(0, 80),
        kind: 'mystery',
        status: 'open',
        summary: text,
      });
      migrated = true;
    }
  }

  return migrated;
}

export async function getStoryVault(
  dbInput: Database | any,
  projectRef: string,
  userId: string,
): Promise<StoryVaultSnapshot> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');

  const migrated = migrateLegacyStoryAssets(db, project);

  const entities = (db.prepare(`
    SELECT * FROM story_entities WHERE project_id = ? ORDER BY importance DESC, updated_at DESC
  `).all(project.id) as any[]).map(mapEntity);

  const threads = (db.prepare(`
    SELECT * FROM story_threads WHERE project_id = ? ORDER BY updated_at DESC
  `).all(project.id) as any[]).map(mapThread);

  const notes = (db.prepare(`
    SELECT * FROM story_notes WHERE project_id = ? ORDER BY updated_at DESC
  `).all(project.id) as any[]).map(mapNote);

  const counts: Record<string, number> = {};
  for (const e of entities) counts[e.type] = (counts[e.type] || 0) + 1;

  const state = db.prepare(`
    SELECT total_chapters, next_chapter_index, open_loops FROM states WHERE project_id = ?
  `).get(project.id) as any;
  const outline = db.prepare(`SELECT outline_json FROM outlines WHERE project_id = ?`).get(project.id) as any;
  const openLoops = parseJsonArray(state?.open_loops);

  return {
    projectId: project.id,
    projectName: project.name,
    bibleRaw: project.bible || '',
    entities,
    threads,
    notes,
    counts,
    health: {
      entityCount: entities.length,
      openThreadCount: threads.filter((t) => t.status === 'open' || t.status === 'active').length,
      openLoopCount: openLoops.length,
      generatedChapters: Math.max(0, Number(state?.next_chapter_index || 1) - 1),
      totalChapters: Number(state?.total_chapters || 0),
      hasBible: Boolean((project.bible || '').trim()),
      hasOutline: Boolean(outline?.outline_json),
    },
    migrated,
  };
}

export async function createStoryEntity(
  projectRef: string,
  userId: string,
  input: {
    type: StoryEntityType;
    name: string;
    content?: string;
    aliases?: string[];
    triggerTerms?: string[];
    importance?: number;
    status?: Record<string, unknown>;
  },
): Promise<StoryEntity> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  if (!input.name?.trim()) throw new Error('Name is required');
  if (!input.type) throw new Error('Type is required');
  return insertEntity(db, project.id, {
    ...input,
    sourceRefs: [{ source: 'manual' }],
  });
}

export async function updateStoryEntity(
  projectRef: string,
  userId: string,
  entityId: string,
  patch: Partial<{
    type: StoryEntityType;
    name: string;
    content: string;
    aliases: string[];
    triggerTerms: string[];
    importance: number;
    status: Record<string, unknown>;
    lastReferencedChapter: number | null;
  }>,
): Promise<StoryEntity> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  const existing = db.prepare(`SELECT * FROM story_entities WHERE id = ? AND project_id = ?`).get(entityId, project.id) as any;
  if (!existing) throw new Error('Entity not found');

  const next = {
    type: patch.type || existing.type,
    name: patch.name?.trim() || existing.name,
    content: patch.content ?? existing.content,
    aliases_json: JSON.stringify(patch.aliases ?? parseJsonArray(existing.aliases_json)),
    trigger_terms_json: JSON.stringify(patch.triggerTerms ?? parseJsonArray(existing.trigger_terms_json)),
    importance: patch.importance ?? existing.importance,
    status_json: JSON.stringify(patch.status ?? parseJsonObject(existing.status_json)),
    last_referenced_chapter: patch.lastReferencedChapter === undefined
      ? existing.last_referenced_chapter
      : patch.lastReferencedChapter,
  };

  db.prepare(`
    UPDATE story_entities
    SET type = ?, name = ?, content = ?, aliases_json = ?, trigger_terms_json = ?,
        importance = ?, status_json = ?, last_referenced_chapter = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(
    next.type,
    next.name,
    next.content,
    next.aliases_json,
    next.trigger_terms_json,
    next.importance,
    next.status_json,
    next.last_referenced_chapter,
    nowMs(),
    entityId,
    project.id,
  );

  return mapEntity(db.prepare(`SELECT * FROM story_entities WHERE id = ?`).get(entityId));
}

export async function deleteStoryEntity(projectRef: string, userId: string, entityId: string): Promise<void> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  const result = db.prepare(`DELETE FROM story_entities WHERE id = ? AND project_id = ?`).run(entityId, project.id);
  if (result.changes === 0) throw new Error('Entity not found');
}

export async function createStoryThread(
  projectRef: string,
  userId: string,
  input: {
    name: string;
    kind?: StoryThread['kind'];
    status?: StoryThread['status'];
    summary?: string;
    stakes?: string;
  },
): Promise<StoryThread> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  if (!input.name?.trim()) throw new Error('Name is required');
  return insertThread(db, project.id, input);
}

export async function updateStoryThread(
  projectRef: string,
  userId: string,
  threadId: string,
  patch: Partial<{
    name: string;
    kind: StoryThread['kind'];
    status: StoryThread['status'];
    summary: string;
    stakes: string;
  }>,
): Promise<StoryThread> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  const existing = db.prepare(`SELECT * FROM story_threads WHERE id = ? AND project_id = ?`).get(threadId, project.id) as any;
  if (!existing) throw new Error('Thread not found');

  db.prepare(`
    UPDATE story_threads
    SET name = ?, kind = ?, status = ?, summary = ?, stakes = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(
    patch.name?.trim() || existing.name,
    patch.kind || existing.kind,
    patch.status || existing.status,
    patch.summary ?? existing.summary,
    patch.stakes ?? existing.stakes,
    nowMs(),
    threadId,
    project.id,
  );
  return mapThread(db.prepare(`SELECT * FROM story_threads WHERE id = ?`).get(threadId));
}

export async function deleteStoryThread(projectRef: string, userId: string, threadId: string): Promise<void> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  const result = db.prepare(`DELETE FROM story_threads WHERE id = ? AND project_id = ?`).run(threadId, project.id);
  if (result.changes === 0) throw new Error('Thread not found');
}

function extractCandidatesFromText(text: string): {
  entities: Array<{ type: StoryEntityType; name: string; content: string; importance: number }>;
  threads: Array<{ name: string; kind: StoryThread['kind']; summary: string; status: StoryThread['status'] }>;
  notes: Array<{ title: string; content: string }>;
} {
  const entities: Array<{ type: StoryEntityType; name: string; content: string; importance: number }> = [];
  const threads: Array<{ name: string; kind: StoryThread['kind']; summary: string; status: StoryThread['status'] }> = [];
  const notes: Array<{ title: string; content: string }> = [];

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Pattern: 【角色】张三：... or 角色：张三
  for (const line of lines) {
    let m = /^(?:【)?(角色|人物|主角|配角)(?:】)?[:：\s]+(.+)$/.exec(line);
    if (m) {
      const rest = m[2];
      const name = rest.split(/[，,：:\s]/)[0].slice(0, 40);
      if (name) entities.push({ type: 'character', name, content: rest, importance: 3 });
      continue;
    }
    m = /^(?:【)?(地点|场景|位置)(?:】)?[:：\s]+(.+)$/.exec(line);
    if (m) {
      const rest = m[2];
      const name = rest.split(/[，,：:\s]/)[0].slice(0, 40);
      if (name) entities.push({ type: 'location', name, content: rest, importance: 2 });
      continue;
    }
    m = /^(?:【)?(势力|门派|组织|家族)(?:】)?[:：\s]+(.+)$/.exec(line);
    if (m) {
      const rest = m[2];
      const name = rest.split(/[，,：:\s]/)[0].slice(0, 40);
      if (name) entities.push({ type: 'faction', name, content: rest, importance: 3 });
      continue;
    }
    m = /^(?:【)?(伏笔|悬念|未解|线索)(?:】)?[:：\s]+(.+)$/.exec(line);
    if (m) {
      threads.push({ name: m[2].slice(0, 80), kind: 'foreshadow', summary: m[2], status: 'open' });
      continue;
    }
  }

  // Fallback: names with honorifics / common CN novel patterns
  const nameHits = text.match(/[一-鿿]{2,4}(?=道|说|笑|冷哼|皱眉|心想|看向)/g) || [];
  const freq = new Map<string, number>();
  for (const n of nameHits) freq.set(n, (freq.get(n) || 0) + 1);
  for (const [name, count] of [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    if (entities.some((e) => e.name === name)) continue;
    if (count < 2) continue;
    entities.push({
      type: 'character',
      name,
      content: `从正文中识别到高频出场角色（约 ${count} 次）。`,
      importance: Math.min(5, 1 + count),
    });
  }

  // Open questions as threads
  const questionLines = lines.filter((l) => /[？?]/.test(l) || /究竟|到底|秘密|真相/.test(l));
  for (const q of questionLines.slice(0, 5)) {
    threads.push({
      name: q.slice(0, 80),
      kind: 'mystery',
      summary: q,
      status: 'open',
    });
  }

  if (entities.length === 0 && threads.length === 0) {
    notes.push({
      title: '原文摘录',
      content: text.slice(0, 1200),
    });
  }

  // de-dupe
  const uniqEntities = new Map(entities.map((e) => [e.name, e]));
  const uniqThreads = new Map(threads.map((t) => [t.name, t]));

  return {
    entities: [...uniqEntities.values()],
    threads: [...uniqThreads.values()],
    notes,
  };
}

export async function extractFromText(
  projectRef: string,
  userId: string,
  input: {
    text: string;
    sourceType?: StoryExtractProposal['sourceType'];
    sourceRef?: string;
  },
): Promise<StoryExtractProposal> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  const text = (input.text || '').trim();
  if (!text) throw new Error('Text is required');

  const extracted = extractCandidatesFromText(text);
  const id = randomUUID();
  const ts = nowMs();
  const summary = `提取到 ${extracted.entities.length} 个实体、${extracted.threads.length} 条线索、${extracted.notes.length} 条笔记`;

  db.prepare(`
    INSERT INTO story_extract_proposals (
      id, project_id, source_type, source_ref, summary,
      entities_json, threads_json, notes_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    project.id,
    input.sourceType || 'manual',
    input.sourceRef || null,
    summary,
    JSON.stringify(extracted.entities),
    JSON.stringify(extracted.threads),
    JSON.stringify(extracted.notes),
    ts,
    ts,
  );

  return mapProposal(db.prepare(`SELECT * FROM story_extract_proposals WHERE id = ?`).get(id));
}

export async function acceptExtractProposal(
  projectRef: string,
  userId: string,
  proposalId: string,
  options?: { entityIndexes?: number[]; threadIndexes?: number[]; noteIndexes?: number[] },
): Promise<{ entities: StoryEntity[]; threads: StoryThread[]; notes: StoryNote[]; proposal: StoryExtractProposal }> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  const row = db.prepare(`
    SELECT * FROM story_extract_proposals WHERE id = ? AND project_id = ?
  `).get(proposalId, project.id) as any;
  if (!row) throw new Error('Proposal not found');
  if (row.status === 'accepted') throw new Error('Proposal already accepted');

  const proposal = mapProposal(row);
  const pick = <T,>(arr: T[], indexes?: number[]) => {
    if (!indexes) return arr;
    return indexes.map((i) => arr[i]).filter(Boolean);
  };

  const createdEntities: StoryEntity[] = [];
  const createdThreads: StoryThread[] = [];
  const createdNotes: StoryNote[] = [];

  for (const e of pick(proposal.entities, options?.entityIndexes)) {
    createdEntities.push(insertEntity(db, project.id, {
      type: e.type,
      name: e.name,
      content: e.content || '',
      importance: e.importance || 3,
      sourceRefs: [{ source: 'extract', proposalId }],
    }));
  }
  for (const t of pick(proposal.threads, options?.threadIndexes)) {
    createdThreads.push(insertThread(db, project.id, {
      name: t.name,
      kind: t.kind || 'other',
      status: t.status || 'open',
      summary: t.summary || '',
      stakes: t.stakes || '',
    }));
  }
  for (const n of pick(proposal.notes, options?.noteIndexes)) {
    createdNotes.push(insertNote(db, project.id, {
      title: n.title || '',
      content: n.content || '',
      source: 'extract',
    }));
  }

  const status = (
    createdEntities.length + createdThreads.length + createdNotes.length
  ) === (proposal.entities.length + proposal.threads.length + proposal.notes.length)
    ? 'accepted'
    : 'partial';

  db.prepare(`
    UPDATE story_extract_proposals SET status = ?, updated_at = ? WHERE id = ?
  `).run(status, nowMs(), proposalId);

  return {
    entities: createdEntities,
    threads: createdThreads,
    notes: createdNotes,
    proposal: mapProposal(db.prepare(`SELECT * FROM story_extract_proposals WHERE id = ?`).get(proposalId)),
  };
}

/**
 * LLM-powered extract: uses a single AI call to identify entities, threads and
 * notes from text, returning a structured proposal. Falls back to the rule-based
 * extractor if the AI call fails.
 */
export async function extractFromTextWithLLM(
  projectRef: string,
  userId: string,
  input: {
    text: string;
    sourceType?: StoryExtractProposal['sourceType'];
    sourceRef?: string;
  },
  aiConfig: import('../services/aiClient.js').AIConfig,
): Promise<StoryExtractProposal> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  const text = (input.text || '').trim();
  if (!text) throw new Error('Text is required');

  const system = `你是小说设定提取助手。从给定的章节文本中提取结构化故事资产。
只输出严格的 JSON，不要有任何其他文字。

输出格式：
{
  "entities": [
    { "type": "character|location|item|faction|rule|world", "name": "名称", "content": "简短设定描述", "importance": 1-5 }
  ],
  "threads": [
    { "name": "线索名", "kind": "main|sub|foreshadow|mystery", "summary": "简述", "status": "open|active" }
  ],
  "notes": [
    { "title": "笔记标题", "content": "笔记内容" }
  ]
}

规则：
- 只提取文本中明确出现的内容，不要编造。
- 角色名要准确，包含别名。
- 伏笔/悬念标记为 foreshadow。
- importance: 主角=5, 重要配角=4, 次要=3, 背景=2。
- 如果文本太短或没有可提取内容，返回空数组。`.trim();

  const prompt = `【待提取文本】\n${text.slice(0, 8000)}`.trim();

  let extracted: { entities: any[]; threads: any[]; notes: any[] };

  try {
    const { generateTextWithRetry } = await import('../services/aiClient.js');
    const raw = await generateTextWithRetry(
      aiConfig,
      { system, prompt, temperature: 0.2, maxTokens: 2000 },
      1,
      { phase: 'other' },
    );
    // Extract JSON from the response (handle markdown code fences)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM 未返回有效 JSON');
    extracted = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn('[extractLLM] falling back to rule-based:', (e as Error).message);
    extracted = extractCandidatesFromText(text);
  }

  const id = randomUUID();
  const ts = nowMs();
  const summary = `[LLM] 提取到 ${extracted.entities.length} 个实体、${extracted.threads.length} 条线索、${extracted.notes.length} 条笔记`;

  db.prepare(`
    INSERT INTO story_extract_proposals (
      id, project_id, source_type, source_ref, summary,
      entities_json, threads_json, notes_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id, project.id, input.sourceType || 'chapter', input.sourceRef || null, summary,
    JSON.stringify(extracted.entities), JSON.stringify(extracted.threads), JSON.stringify(extracted.notes),
    ts, ts,
  );

  return mapProposal(db.prepare(`SELECT * FROM story_extract_proposals WHERE id = ?`).get(id));
}

export async function listExtractProposals(projectRef: string, userId: string): Promise<StoryExtractProposal[]> {
  const db = getDb();
  const project = await resolveProjectForUser(db, projectRef, userId);
  if (!project) throw new Error('Project not found');
  return (db.prepare(`
    SELECT * FROM story_extract_proposals
    WHERE project_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(project.id) as any[]).map(mapProposal);
}
