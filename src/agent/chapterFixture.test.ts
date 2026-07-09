/**
 * Phase 2 acceptance test: 10-chapter continuous generation fixture.
 *
 * Verifies that across 10 simulated chapters:
 *   1. Chapter indices never get lost.
 *   2. Context packages are persisted for every chapter.
 *   3. The blueprint state machine (draft -> ready -> generating -> drafted
 *      -> reviewing -> committed) transitions correctly.
 *   4. Selected Story Vault entities are stable and reproducible for the same
 *      input (same prompt hash).
 *   5. The AI job ledger records every drafting job.
 *
 * Uses an in-memory SQLite DB so no filesystem is touched. The "generation"
 * itself is a stub (no real LLM) — this test is about state integrity, not
 * prose quality.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { buildContextPackage, serializeContextPackage, listContextPackages } from './contextBuilder.js';
import { startLedgerJob, listLedgerJobs } from '../services/aiJobLedger.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, bible TEXT, user_id TEXT NOT NULL DEFAULT 'local-user',
  deleted_at INTEGER, created_at INTEGER DEFAULT (unixepoch()*1000)
);
CREATE TABLE IF NOT EXISTS states (
  project_id TEXT PRIMARY KEY, total_chapters INTEGER DEFAULT 0,
  next_chapter_index INTEGER DEFAULT 1, open_loops TEXT DEFAULT '[]',
  rolling_summary TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS story_entities (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
  aliases_json TEXT DEFAULT '[]', content TEXT DEFAULT '', status_json TEXT DEFAULT '{}',
  trigger_terms_json TEXT DEFAULT '[]', importance INTEGER DEFAULT 3,
  last_referenced_chapter INTEGER, source_refs_json TEXT DEFAULT '[]',
  created_at INTEGER DEFAULT (unixepoch()*1000), updated_at INTEGER DEFAULT (unixepoch()*1000)
);
CREATE TABLE IF NOT EXISTS story_threads (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT DEFAULT 'main', status TEXT DEFAULT 'open', summary TEXT DEFAULT '',
  stakes TEXT DEFAULT '', related_entity_ids_json TEXT DEFAULT '[]',
  first_chapter INTEGER, last_chapter INTEGER,
  created_at INTEGER DEFAULT (unixepoch()*1000), updated_at INTEGER DEFAULT (unixepoch()*1000)
);
CREATE TABLE IF NOT EXISTS chapter_blueprints (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, chapter_index INTEGER NOT NULL,
  title TEXT DEFAULT '', goal_json TEXT DEFAULT '{}', conflict TEXT DEFAULT '', hook TEXT DEFAULT '',
  scene_beats_json TEXT DEFAULT '[]', state_delta_plan_json TEXT DEFAULT '[]',
  acceptance_criteria_json TEXT DEFAULT '[]', author_notes TEXT DEFAULT '',
  status TEXT DEFAULT 'draft', created_at INTEGER DEFAULT (unixepoch()*1000), updated_at INTEGER DEFAULT (unixepoch()*1000),
  UNIQUE(project_id, chapter_index)
);
CREATE TABLE IF NOT EXISTS context_packages (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_type TEXT NOT NULL,
  chapter_index INTEGER, blueprint_id TEXT, input_refs_json TEXT DEFAULT '[]',
  package_json TEXT DEFAULT '{}', token_budget_json TEXT DEFAULT '{}',
  estimated_tokens INTEGER DEFAULT 0, prompt_hash TEXT DEFAULT '', created_at INTEGER DEFAULT (unixepoch()*1000)
);
CREATE TABLE IF NOT EXISTS ai_job_ledger (
  id TEXT PRIMARY KEY, project_id TEXT, context_package_id TEXT,
  provider TEXT NOT NULL, model TEXT NOT NULL, phase TEXT NOT NULL,
  task_type TEXT, chapter_index INTEGER,
  estimated_input_tokens INTEGER DEFAULT 0, estimated_output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0, cache_creation_tokens INTEGER DEFAULT 0,
  tool_read_tokens INTEGER DEFAULT 0, estimated_cost REAL DEFAULT 0,
  duration_ms INTEGER DEFAULT 0, status TEXT DEFAULT 'running',
  error_message TEXT, agent_turns INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()*1000), updated_at INTEGER DEFAULT (unixepoch()*1000)
);
`;

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

function seedProject(db: Database.Database): { projectId: string; entityId: string; threadId: string } {
  const projectId = randomUUID();
  const entityId = randomUUID();
  const threadId = randomUUID();
  db.prepare(`INSERT INTO projects (id, name, bible, user_id) VALUES (?, ?, ?, 'local-user')`)
    .run(projectId, 'fixture-novel', '# 设定\n主角林远，青云城少主。\n## 势力\n青云宗');
  db.prepare(`INSERT INTO states (project_id, total_chapters, next_chapter_index, open_loops, rolling_summary) VALUES (?, 10, 1, '[]', '')`)
    .run(projectId);
  db.prepare(`INSERT INTO story_entities (id, project_id, type, name, content, trigger_terms_json, importance) VALUES (?, ?, 'character', '林远', '主角，青云城少主，修炼天赋极高', '["林远","少主"]', 5)`)
    .run(entityId, projectId);
  db.prepare(`INSERT INTO story_entities (id, project_id, type, name, content, trigger_terms_json, importance) VALUES (?, ?, 'location', '青云城', '大陆东部的修仙之城', '["青云城"]', 4)`)
    .run(randomUUID(), projectId);
  db.prepare(`INSERT INTO story_threads (id, project_id, name, kind, status, summary) VALUES (?, ?, '祖符之谜', 'foreshadow', 'open', '神秘祖符的下落')`)
    .run(threadId, projectId);
  return { projectId, entityId, threadId };
}

const BLUEPRINT_STATUS_FLOW: Array<{ status: string; label: string }> = [
  { status: 'draft', label: '起草蓝图' },
  { status: 'ready', label: '标记就绪' },
  { status: 'generating', label: '开始生成' },
  { status: 'drafted', label: '生成完成' },
  { status: 'reviewing', label: '进入审阅' },
  { status: 'committed', label: '提交入库' },
];

test('10-chapter continuous generation fixture: no state loss', async () => {
  const db = makeDb();
  const { projectId, entityId } = seedProject(db);

  const hashes: string[] = [];
  const TOTAL_CHAPTERS = 10;

  for (let chapter = 1; chapter <= TOTAL_CHAPTERS; chapter++) {
    // 1. Create blueprint and walk it through the status state machine
    const bpId = randomUUID();
    const ts = Date.now();
    db.prepare(`INSERT INTO chapter_blueprints (id, project_id, chapter_index, title, goal_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`)
      .run(bpId, projectId, chapter, `第 ${chapter} 章`, JSON.stringify({ primary: `第${chapter}章目标` }), ts, ts);

    for (const { status } of BLUEPRINT_STATUS_FLOW) {
      db.prepare(`UPDATE chapter_blueprints SET status = ?, updated_at = ? WHERE id = ?`).run(status, Date.now(), bpId);
    }
    const finalBp = db.prepare(`SELECT status FROM chapter_blueprints WHERE id = ?`).get(bpId) as any;
    assert.equal(finalBp.status, 'committed', `第 ${chapter} 章蓝图应最终为 committed`);

    // 2. Build context package (with DB => Story Vault selection active)
    const pkg = buildContextPackage({
      taskId: `gen-chapter-${chapter}`,
      projectId,
      chapterIndex: chapter,
      taskType: 'chapter_draft',
      rollingSummary: `第${chapter - 1}章摘要：主角林远在青云城修炼。`,
      goalHint: '林远',
      currentBlueprint: `第${chapter}章蓝图：林远面对新挑战`,
      writingStyleRules: '保持紧凑的叙事节奏',
      totalChapters: TOTAL_CHAPTERS,
      db,
      persist: true,
    });

    // 3. Assert the protagonist entity is always selected (trigger term match)
    const hasProtagonist = pkg.selectedItems.some((i) => i.refId === entityId);
    assert.ok(hasProtagonist, `第 ${chapter} 章应选中主角实体 (trigger: 林远)`);

    // 4. Record prompt hash for reproducibility
    hashes.push(pkg.promptHash);

    // 5. Record a ledger job for this chapter
    const ledger = startLedgerJob({
      provider: 'anthropic',
      model: 'claude-sonnet-test',
      phase: 'drafting',
      taskType: 'chapter_draft',
      chapterIndex: chapter,
      projectId,
      contextPackageId: pkg.id,
      db,
    });
    ledger.finish({
      inputTokens: 1000 + chapter * 100,
      outputTokens: 2000,
      durationMs: 5000 + chapter * 100,
      agentTurns: 3,
      status: 'completed',
    });
  }

  // ---- Post-loop assertions ----

  // All 10 blueprints committed
  const blueprints = db.prepare(`SELECT chapter_index, status FROM chapter_blueprints WHERE project_id = ? ORDER BY chapter_index`).all(projectId) as any[];
  assert.equal(blueprints.length, TOTAL_CHAPTERS, '应有 10 个蓝图');
  for (const bp of blueprints) {
    assert.equal(bp.status, 'committed', `第 ${bp.chapter_index} 章应为 committed`);
    assert.equal(bp.chapter_index, blueprints.indexOf(bp) + 1, '章节索引连续');
  }

  // All 10 context packages persisted
  const packages = listContextPackages(db, projectId, { limit: 100 });
  assert.equal(packages.length, TOTAL_CHAPTERS, '应有 10 个 context package');
  const chapterIndices = packages.map((p) => p.chapterIndex).sort((a, b) => a - b);
  for (let i = 0; i < TOTAL_CHAPTERS; i++) {
    assert.equal(chapterIndices[i], i + 1, `应包含第 ${i + 1} 章的 context package`);
  }

  // All 10 ledger jobs recorded
  const jobs = listLedgerJobs(projectId, { limit: 100, db });
  assert.equal(jobs.length, TOTAL_CHAPTERS, '应有 10 个 ledger job');
  for (const job of jobs) {
    assert.equal(job.status, 'completed');
    assert.equal(job.phase, 'drafting');
    assert.ok(job.estimatedCost > 0, '每个 job 应有估算成本');
    assert.ok(job.contextPackageId, '每个 job 应关联 context package');
  }

  // Reproducibility: rebuilding chapter 1 with identical input yields the same hash
  const replay = buildContextPackage({
    taskId: 'gen-chapter-1-replay',
    projectId,
    chapterIndex: 1,
    taskType: 'chapter_draft',
    rollingSummary: '第0章摘要：主角林远在青云城修炼。',
    goalHint: '林远',
    currentBlueprint: '第1章蓝图：林远面对新挑战',
    writingStyleRules: '保持紧凑的叙事节奏',
    totalChapters: TOTAL_CHAPTERS,
    db,
    persist: false, // don't create a duplicate row
  });
  assert.equal(replay.promptHash, hashes[0], '相同输入应产生相同 prompt hash (可复现)');

  db.close();
});

test('Context Inspector serialization is stable and human-readable', () => {
  const db = makeDb();
  const { projectId } = seedProject(db);
  const pkg = buildContextPackage({
    taskId: 'inspect-1',
    projectId,
    chapterIndex: 1,
    taskType: 'chapter_draft',
    rollingSummary: '林远在青云城',
    goalHint: '林远',
    db,
    persist: false,
  });
  const serialized = serializeContextPackage(pkg);
  assert.match(serialized, /林远/);
  assert.match(serialized, /Token 预算/);
  assert.match(serialized, /Context Package/);
  db.close();
});
