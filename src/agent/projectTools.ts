import { generateCharacterGraph } from '../generateCharacters.js';
import { writeOneChapter } from '../generateChapter.js';
import { runOutlineAgent } from './orchestrator.js';
import type { NovelOutline } from '../generateOutline.js';
import type { CharacterRelationGraph } from '../types/characters.js';
import { repairChapter } from '../qc/repairLoop.js';
import { runQuickQC } from '../qc/multiDimensionalQC.js';
import type {
  GeneratedChapterRecord,
  ProjectAgentState,
  ProjectToolContext,
  ProjectToolDefinition,
  ProjectToolName,
} from './projectTypes.js';

type OutlineLookup = {
  title?: string;
  goalHint?: string;
};

function findChapterFromOutline(outline: NovelOutline | undefined, chapterIndex: number): OutlineLookup {
  if (!outline) {
    return {};
  }
  for (const vol of outline.volumes || []) {
    const chapter = vol.chapters?.find((item) => item.index === chapterIndex);
    if (chapter) {
      return {
        title: chapter.title,
        goalHint: `【章节大纲】\n- 标题: ${chapter.title}\n- 目标: ${chapter.goal}\n- 章末钩子: ${chapter.hook}`,
      };
    }
  }
  return {};
}

function toTitle(chapterText: string, fallback: string): string {
  const titleMatch = chapterText.match(/^第?\d*[章回节]?\s*[：:.]?\s*(.+)/m);
  return titleMatch ? titleMatch[1] : fallback;
}

function makeChapterRecord(args: {
  chapterIndex: number;
  chapterText: string;
  fallbackTitle: string;
  repaired: boolean;
  qcScore?: number;
  issues?: string[];
}): GeneratedChapterRecord {
  return {
    chapterIndex: args.chapterIndex,
    title: toTitle(args.chapterText, args.fallbackTitle),
    wordCount: args.chapterText.length,
    repaired: args.repaired,
    qcScore: args.qcScore,
    issues: args.issues,
  };
}

class ProjectToolRegistry {
  private readonly tools = new Map<ProjectToolName, ProjectToolDefinition>();

  register(tool: ProjectToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Project tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: ProjectToolName): ProjectToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Project tool not found: ${name}`);
    }
    return tool;
  }
}

function estimateTargetWordCount(totalChapters: number): number {
  return Math.max(20, Math.ceil(totalChapters * 0.25));
}

async function persistOutline(db: D1Database, projectId: string, outline: NovelOutline): Promise<void> {
  await db
    .prepare(
      `
      INSERT OR REPLACE INTO outlines (project_id, outline_json) VALUES (?, ?)
    `
    )
    .bind(projectId, JSON.stringify(outline))
    .run();
}

async function persistCharacters(
  db: D1Database,
  projectId: string,
  characters: CharacterRelationGraph
): Promise<void> {
  await db
    .prepare(
      `
      INSERT INTO characters (project_id, characters_json) VALUES (?, ?)
      ON CONFLICT(project_id) DO UPDATE SET characters_json = excluded.characters_json, updated_at = CURRENT_TIMESTAMP
    `
    )
    .bind(projectId, JSON.stringify(characters))
    .run();
}

async function fetchLastChapters(db: D1Database, projectId: string, chapterIndex: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `
      SELECT content FROM chapters
      WHERE project_id = ? AND chapter_index >= ? AND deleted_at IS NULL
      ORDER BY chapter_index DESC LIMIT 2
    `
    )
    .bind(projectId, Math.max(1, chapterIndex - 2))
    .all();
  return (results || []).map((row: any) => row.content as string).reverse();
}

async function assertProjectStateVersion(args: {
  db: D1Database;
  projectId: string;
  expectedNextChapterIndex: number;
}): Promise<void> {
  const row = await args.db
    .prepare(
      `
      SELECT next_chapter_index FROM states WHERE project_id = ?
    `
    )
    .bind(args.projectId)
    .first() as { next_chapter_index: number } | null;

  if (!row) {
    throw new Error('Project state not found');
  }

  if (row.next_chapter_index !== args.expectedNextChapterIndex) {
    throw new Error(
      `状态已变化：期望 next_chapter_index=${args.expectedNextChapterIndex}，当前=${row.next_chapter_index}`
    );
  }
}

async function persistChapterQC(args: {
  db: D1Database;
  projectId: string;
  chapterIndex: number;
  qc: NonNullable<ProjectAgentState['pendingQC']>;
}): Promise<void> {
  await args.db
    .prepare(
      `
      INSERT INTO chapter_qc (project_id, chapter_index, qc_json, passed, score)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, chapter_index)
      DO UPDATE SET
        qc_json = excluded.qc_json,
        passed = excluded.passed,
        score = excluded.score,
        created_at = CURRENT_TIMESTAMP
    `
    )
    .bind(
      args.projectId,
      args.chapterIndex,
      JSON.stringify(args.qc),
      args.qc.passed ? 1 : 0,
      args.qc.score
    )
    .run();
}

export function createProjectToolRegistry(): ProjectToolRegistry {
  const registry = new ProjectToolRegistry();

  registry.register({
    name: 'ensure_outline',
    description: '确保项目已有大纲，缺失时自动生成',
    execute: async (state, context) => {
      if (state.outline) {
        return {
          summary: '已存在大纲，跳过生成',
        };
      }

      if (!context.autoGenerateOutline) {
        return {
          summary: '未开启自动大纲生成，无法继续',
        };
      }

      context.onStatus?.({
        type: 'tool_progress',
        message: '缺少大纲，正在自动生成...',
        data: { tool: 'ensure_outline' },
      });

      const outlineResult = await runOutlineAgent({
        aiConfig: state.aiConfig,
        bible: state.bible,
        targetChapters: state.totalChapters,
        targetWordCount: estimateTargetWordCount(state.totalChapters),
        maxRetries: 1,
        targetScore: 7.5,
        useLLMPlanner: context.useLLMPlanner,
      });

      await persistOutline(context.db, state.projectId, outlineResult.outline as NovelOutline);

      context.onStatus?.({
        type: 'tool_progress',
        message: `大纲生成完成，评分 ${outlineResult.evaluation.score}/10`,
        data: {
          tool: 'ensure_outline',
          score: outlineResult.evaluation.score,
          attempts: outlineResult.attempts,
        },
      });

      return {
        summary: `自动补齐大纲成功（评分 ${outlineResult.evaluation.score}/10）`,
        patch: {
          outline: outlineResult.outline as NovelOutline,
        },
      };
    },
  });

  registry.register({
    name: 'ensure_characters',
    description: '确保项目有人物关系图谱，缺失时自动生成',
    execute: async (state, context) => {
      if (state.characters) {
        return {
          summary: '已存在人物关系图，跳过生成',
        };
      }
      if (!state.outline) {
        throw new Error('Cannot generate characters without outline');
      }
      if (!context.autoGenerateCharacters) {
        return {
          summary: '未开启自动人物生成，无法继续',
        };
      }

      context.onStatus?.({
        type: 'tool_progress',
        message: '缺少人物关系图，正在自动生成...',
        data: { tool: 'ensure_characters' },
      });

      const characters = await generateCharacterGraph({
        aiConfig: state.aiConfig,
        bible: state.bible,
        outline: state.outline,
      });

      await persistCharacters(context.db, state.projectId, characters);

      const mainCount = (characters.protagonists?.length || 0) + (characters.mainCharacters?.length || 0);
      context.onStatus?.({
        type: 'tool_progress',
        message: `人物关系图生成完成，共 ${mainCount} 个关键角色`,
        data: { tool: 'ensure_characters', roleCount: mainCount },
      });

      return {
        summary: `自动补齐人物关系图成功（${mainCount} 角色）`,
        patch: {
          characters,
        },
      };
    },
  });

  registry.register({
    name: 'generate_chapter',
    description: '生成下一章候选内容（先不落库）',
    execute: async (state, context) => {
      const chapterIndex = state.currentChapterIndex;
      if (chapterIndex > state.endChapterIndex) {
        return {
          summary: `章节序号 ${chapterIndex} 超出上限 ${state.endChapterIndex}`,
        };
      }

      const { title, goalHint } = findChapterFromOutline(state.outline, chapterIndex);
      const lastChapters = await fetchLastChapters(context.db, state.projectId, chapterIndex);

      context.onStatus?.({
        type: 'tool_progress',
        message: `正在生成第 ${chapterIndex} 章...`,
        chapterIndex,
        data: { tool: 'generate_chapter' },
      });

      const chapterResult = await writeOneChapter({
        aiConfig: state.aiConfig,
        bible: state.bible,
        rollingSummary: state.rollingSummary,
        openLoops: state.openLoops,
        lastChapters,
        chapterIndex,
        totalChapters: state.totalChapters,
        chapterGoalHint: goalHint,
        chapterTitle: title,
        characters: state.characters,
        onProgress: (message, status) => {
          context.onStatus?.({
            type: 'tool_progress',
            message,
            chapterIndex,
            data: { tool: 'generate_chapter', status: status || 'generating' },
          });
        },
      });

      return {
        summary: `第 ${chapterIndex} 章候选内容生成完成`,
        patch: {
          pendingChapter: {
            chapterIndex,
            chapterText: chapterResult.chapterText,
            updatedSummary: chapterResult.updatedSummary,
            updatedOpenLoops: chapterResult.updatedOpenLoops,
            outlineTitle: title,
            outlineGoal: goalHint,
            wasRewritten: chapterResult.wasRewritten,
            rewriteCount: chapterResult.rewriteCount,
            repairCount: 0,
          },
          pendingQC: undefined,
        },
      };
    },
  });

  registry.register({
    name: 'qc_chapter',
    description: '对候选章节执行快速 QC',
    execute: async (state, context) => {
      if (!state.pendingChapter) {
        throw new Error('No pending chapter for QC');
      }

      const qc = runQuickQC(
        state.pendingChapter.chapterText,
        state.pendingChapter.chapterIndex,
        state.totalChapters
      );

      context.onStatus?.({
        type: 'tool_progress',
        message: `第 ${state.pendingChapter.chapterIndex} 章 QC 评分 ${qc.score}/100`,
        chapterIndex: state.pendingChapter.chapterIndex,
        data: {
          tool: 'qc_chapter',
          score: qc.score,
          passed: qc.passed,
          issues: qc.issues.slice(0, 5).map((item) => item.description),
        },
      });

      return {
        summary: `第 ${state.pendingChapter.chapterIndex} 章 QC: ${qc.score}/100`,
        patch: {
          pendingQC: qc,
        },
      };
    },
  });

  registry.register({
    name: 'repair_chapter',
    description: '对未通过 QC 的章节进行修复',
    execute: async (state, context) => {
      if (!state.pendingChapter || !state.pendingQC) {
        throw new Error('No pending chapter/qc for repair');
      }

      const chapterIndex = state.pendingChapter.chapterIndex;
      context.onStatus?.({
        type: 'tool_progress',
        message: `第 ${chapterIndex} 章 QC 未通过，尝试修复...`,
        chapterIndex,
        data: { tool: 'repair_chapter' },
      });

      const repairResult = await repairChapter(
        state.aiConfig,
        state.pendingChapter.chapterText,
        state.pendingQC,
        chapterIndex,
        state.totalChapters,
        1
      );

      const nextPending = {
        ...state.pendingChapter,
        chapterText: repairResult.repairedChapter,
        repairCount: state.pendingChapter.repairCount + repairResult.attempts,
      };

      return {
        summary: `第 ${chapterIndex} 章修复完成，当前评分 ${repairResult.finalQC.score}/100`,
        patch: {
          pendingChapter: nextPending,
          pendingQC: repairResult.finalQC,
        },
      };
    },
  });

  registry.register({
    name: 'commit_chapter',
    description: '提交章节到数据库并更新状态',
    execute: async (state, context) => {
      if (!state.pendingChapter) {
        throw new Error('No pending chapter for commit');
      }

      const pending = state.pendingChapter;
      const chapterIndex = pending.chapterIndex;
      const fallbackTitle = pending.outlineTitle || `Chapter ${chapterIndex}`;
      const qc = state.pendingQC;

      await assertProjectStateVersion({
        db: context.db,
        projectId: state.projectId,
        expectedNextChapterIndex: chapterIndex,
      });

      await context.db
        .prepare(
          `
          INSERT OR REPLACE INTO chapters (project_id, chapter_index, content)
          VALUES (?, ?, ?)
        `
        )
        .bind(state.projectId, chapterIndex, pending.chapterText)
        .run();

      await context.db
        .prepare(
          `
          UPDATE states SET
            next_chapter_index = ?,
            rolling_summary = ?,
            open_loops = ?
          WHERE project_id = ?
        `
        )
        .bind(
          chapterIndex + 1,
          pending.updatedSummary,
          JSON.stringify(pending.updatedOpenLoops),
          state.projectId
        )
        .run();

      if (qc) {
        await persistChapterQC({
          db: context.db,
          projectId: state.projectId,
          chapterIndex,
          qc,
        });
      }

      const chapterRecord = makeChapterRecord({
        chapterIndex,
        chapterText: pending.chapterText,
        fallbackTitle,
        repaired: pending.repairCount > 0 || pending.wasRewritten,
        qcScore: qc?.score,
        issues: qc?.issues.slice(0, 4).map((item) => item.description),
      });

      context.onStatus?.({
        type: 'chapter_complete',
        message: `第 ${chapterIndex} 章已保存`,
        chapterIndex,
        data: {
          tool: 'commit_chapter',
          title: chapterRecord.title,
          wordCount: chapterRecord.wordCount,
          qcScore: chapterRecord.qcScore,
          repaired: chapterRecord.repaired,
        },
      });

      return {
        summary: `第 ${chapterIndex} 章已提交`,
        patch: {
          rollingSummary: pending.updatedSummary,
          openLoops: pending.updatedOpenLoops,
          currentChapterIndex: chapterIndex + 1,
          pendingChapter: undefined,
          pendingQC: undefined,
          generated: [...state.generated, chapterRecord],
        },
      };
    },
  });

  return registry;
}
