import { z } from 'zod';
import { generateTextWithRetry } from '../services/aiClient.js';
import type { ProjectAgentState, ProjectPlannerDecision, ProjectToolContext } from './projectTypes.js';

const DecisionSchema = z.object({
  tool: z.enum([
    'ensure_outline',
    'ensure_characters',
    'generate_chapter',
    'qc_chapter',
    'repair_chapter',
    'commit_chapter',
    'finish',
  ]),
  reason: z.string().min(1),
  input: z.record(z.unknown()).optional(),
});

function stripFence(raw: string): string {
  return raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
}

function buildFallbackDecision(
  state: ProjectAgentState,
  context: Pick<ProjectToolContext, 'autoGenerateCharacters' | 'autoGenerateOutline'>
): ProjectPlannerDecision {
  if (state.generated.length >= state.targetChaptersToGenerate) {
    return {
      tool: 'finish',
      reason: `目标完成：已生成 ${state.generated.length}/${state.targetChaptersToGenerate} 章`,
    };
  }

  if (state.currentChapterIndex > state.endChapterIndex) {
    return {
      tool: 'finish',
      reason: `达到总章数上限：next=${state.currentChapterIndex}, total=${state.endChapterIndex}`,
    };
  }

  if (!state.outline) {
    if (context.autoGenerateOutline) {
      return {
        tool: 'ensure_outline',
        reason: '缺少大纲，先补齐大纲',
      };
    }
    return {
      tool: 'finish',
      reason: '缺少大纲且未开启自动补齐，停止',
    };
  }

  if (!state.characters) {
    if (context.autoGenerateCharacters) {
      return {
        tool: 'ensure_characters',
        reason: '缺少人物关系图，先补齐角色设定',
      };
    }
    return {
      tool: 'finish',
      reason: '缺少人物关系图且未开启自动补齐，停止',
    };
  }

  if (!state.pendingChapter) {
    return {
      tool: 'generate_chapter',
      reason: `开始生成第 ${state.currentChapterIndex} 章`,
    };
  }

  if (!state.pendingQC) {
    return {
      tool: 'qc_chapter',
      reason: `对第 ${state.pendingChapter.chapterIndex} 章执行快速 QC`,
    };
  }

  if (!state.pendingQC.passed && state.pendingChapter.repairCount < state.maxRepairAttempts) {
    return {
      tool: 'repair_chapter',
      reason: `第 ${state.pendingChapter.chapterIndex} 章 QC 未通过，尝试修复`,
    };
  }

  return {
    tool: 'commit_chapter',
    reason: `提交第 ${state.pendingChapter.chapterIndex} 章（QC: ${state.pendingQC.score}）`,
  };
}

function buildPlannerPrompt(
  state: ProjectAgentState,
  context: Pick<ProjectToolContext, 'autoGenerateCharacters' | 'autoGenerateOutline'>
): { system: string; prompt: string } {
  const system = `
你是小说项目级 Agent Planner。你每次只能选择一个动作。

可选动作：
- ensure_outline
- ensure_characters
- generate_chapter
- qc_chapter
- repair_chapter
- commit_chapter
- finish

输出严格 JSON：
{
  "tool": "...",
  "reason": "...",
  "input": {}
}
`.trim();

  const prompt = `
【目标】
${state.goal}

【进度】
- target_chapters_to_generate: ${state.targetChaptersToGenerate}
- generated_count: ${state.generated.length}
- current_chapter_index: ${state.currentChapterIndex}
- end_chapter_index: ${state.endChapterIndex}

【状态】
- has_outline: ${state.outline ? 'true' : 'false'}
- has_characters: ${state.characters ? 'true' : 'false'}
- has_pending_chapter: ${state.pendingChapter ? 'true' : 'false'}
- has_pending_qc: ${state.pendingQC ? 'true' : 'false'}
- pending_qc_passed: ${state.pendingQC?.passed ?? false}
- pending_qc_score: ${state.pendingQC?.score ?? 'null'}
- pending_repair_count: ${state.pendingChapter?.repairCount ?? 0}
- max_repair_attempts: ${state.maxRepairAttempts}

【配置】
- auto_generate_outline: ${context.autoGenerateOutline}
- auto_generate_characters: ${context.autoGenerateCharacters}

【最近历史】
${state.history.slice(-6).map((h) => `- [${h.tool}] ${h.summary}`).join('\n') || '- 无'}

【决策约束】
1. 缺大纲时只能 ensure_outline 或 finish
2. 缺人物图时只能 ensure_characters 或 finish
3. 有 pendingChapter 且无 pendingQC 时必须 qc_chapter
4. pendingQC 未通过且 repair 额度未耗尽时优先 repair_chapter
5. 只有 pendingChapter 存在时才能 commit_chapter
6. 完成目标章节数后必须 finish
`.trim();

  return { system, prompt };
}

function normalizeDecision(
  state: ProjectAgentState,
  context: Pick<ProjectToolContext, 'autoGenerateCharacters' | 'autoGenerateOutline'>,
  decision: ProjectPlannerDecision
): ProjectPlannerDecision {
  if (!state.outline && decision.tool !== 'ensure_outline' && decision.tool !== 'finish') {
    return buildFallbackDecision(state, context);
  }
  if (!state.characters && state.outline && decision.tool === 'generate_chapter') {
    return buildFallbackDecision(state, context);
  }
  if (!state.pendingChapter && ['qc_chapter', 'repair_chapter', 'commit_chapter'].includes(decision.tool)) {
    return buildFallbackDecision(state, context);
  }
  if (state.generated.length >= state.targetChaptersToGenerate && decision.tool !== 'finish') {
    return {
      tool: 'finish',
      reason: `目标已达成：${state.generated.length}/${state.targetChaptersToGenerate}`,
    };
  }
  return decision;
}

export async function planProjectNextAction(params: {
  state: ProjectAgentState;
  context: Pick<ProjectToolContext, 'autoGenerateCharacters' | 'autoGenerateOutline'>;
  useLLMPlanner: boolean;
}): Promise<ProjectPlannerDecision> {
  const { state, context, useLLMPlanner } = params;
  const fallback = buildFallbackDecision(state, context);

  if (!useLLMPlanner) {
    return fallback;
  }

  try {
    const { system, prompt } = buildPlannerPrompt(state, context);
    const raw = await generateTextWithRetry(
      state.aiConfig,
      {
        system,
        prompt,
        temperature: 0.1,
        maxTokens: 220,
      },
      2
    );
    const parsed = DecisionSchema.parse(JSON.parse(stripFence(raw)));
    return normalizeDecision(state, context, parsed);
  } catch (error) {
    console.warn('Project planner fallback to heuristic:', (error as Error).message);
    return fallback;
  }
}
