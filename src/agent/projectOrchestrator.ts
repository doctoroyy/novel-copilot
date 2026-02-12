import { applyProjectToolResult, markProjectDone } from './projectMemory.js';
import { planProjectNextAction } from './projectPlanner.js';
import { createProjectToolRegistry } from './projectTools.js';
import type {
  ProjectAgentRunResult,
  ProjectAgentState,
  ProjectPlannerDecision,
  ProjectToolContext,
} from './projectTypes.js';

function computeHardLimit(targetChapters: number): number {
  // 每章理论最多 4 步：generate -> qc -> repair -> commit，另加缓冲
  return Math.max(12, targetChapters * 5 + 8);
}

function isGoalReached(state: ProjectAgentState): boolean {
  return (
    state.generated.length >= state.targetChaptersToGenerate ||
    state.currentChapterIndex > state.endChapterIndex
  );
}

function doneReasonByState(state: ProjectAgentState): string {
  if (state.generated.length >= state.targetChaptersToGenerate) {
    return `目标完成：已生成 ${state.generated.length}/${state.targetChaptersToGenerate} 章`;
  }
  if (state.currentChapterIndex > state.endChapterIndex) {
    return `达到总章数上限：next=${state.currentChapterIndex}, total=${state.endChapterIndex}`;
  }
  return '执行结束';
}

function shouldContinueAfterError(decision: ProjectPlannerDecision): boolean {
  return ['generate_chapter', 'qc_chapter', 'repair_chapter'].includes(decision.tool);
}

function recoverFromToolError(
  state: ProjectAgentState,
  decision: ProjectPlannerDecision,
  error: Error
): ProjectAgentState {
  const chapterIndex = state.pendingChapter?.chapterIndex ?? state.currentChapterIndex;
  const failedSet = new Set<number>(state.failedChapters);
  failedSet.add(chapterIndex);

  const nextIteration = state.iteration + 1;
  return {
    ...state,
    iteration: nextIteration,
    currentChapterIndex: chapterIndex + 1,
    pendingChapter: undefined,
    pendingQC: undefined,
    failedChapters: [...failedSet].sort((a, b) => a - b),
    history: [
      ...state.history,
      {
        iteration: nextIteration,
        timestamp: new Date().toISOString(),
        tool: decision.tool,
        reason: decision.reason,
        summary: `第 ${chapterIndex} 章执行失败，已跳过: ${error.message}`,
      },
    ],
  };
}

export async function runProjectAgent(params: {
  initialState: ProjectAgentState;
  context: ProjectToolContext;
  shouldContinue?: () => Promise<boolean> | boolean;
  onDecision?: (payload: {
    iteration: number;
    decision: ProjectPlannerDecision;
    state: ProjectAgentState;
  }) => void;
}): Promise<ProjectAgentRunResult> {
  const { context, onDecision, shouldContinue } = params;
  let state = params.initialState;
  const tools = createProjectToolRegistry();
  const hardLimit = computeHardLimit(state.targetChaptersToGenerate);

  while (!state.done && state.iteration < hardLimit) {
    if (shouldContinue) {
      const keepRunning = await shouldContinue();
      if (!keepRunning) {
        state = markProjectDone(state, '任务已被用户暂停或停止');
        break;
      }
    }

    if (isGoalReached(state)) {
      state = markProjectDone(state, doneReasonByState(state));
      break;
    }

    const decision = await planProjectNextAction({
      state,
      context: {
        autoGenerateOutline: context.autoGenerateOutline,
        autoGenerateCharacters: context.autoGenerateCharacters,
      },
      useLLMPlanner: context.useLLMPlanner,
    });

    onDecision?.({
      iteration: state.iteration + 1,
      decision,
      state,
    });

    if (decision.tool === 'finish') {
      state = markProjectDone(state, decision.reason);
      break;
    }

    const tool = tools.get(decision.tool);
    try {
      const result = await tool.execute(state, context, decision.input || {});
      state = applyProjectToolResult(state, decision, result);
    } catch (error) {
      const err = error as Error;
      context.onStatus?.({
        type: 'chapter_error',
        message: `Tool ${decision.tool} 执行失败: ${err.message}`,
        chapterIndex: state.pendingChapter?.chapterIndex ?? state.currentChapterIndex,
        data: { tool: decision.tool },
      });

      if (!shouldContinueAfterError(decision)) {
        throw err;
      }

      state = recoverFromToolError(state, decision, err);
    }
  }

  if (!state.done) {
    state = markProjectDone(state, `达到安全迭代上限 ${hardLimit}，提前停止`);
  }

  return {
    generated: state.generated,
    failedChapters: state.failedChapters,
    attempts: state.iteration,
    doneReason: state.doneReason || '完成',
    history: state.history,
  };
}
