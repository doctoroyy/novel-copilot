import type { AIConfig } from '../services/aiClient.js';
import { applyToolResult, createInitialOutlineState, markDone } from './memory.js';
import { createOutlineToolRegistry } from './outlineTools.js';
import { planOutlineNextAction } from './planner.js';
import type { OutlineAgentCallbacks, OutlineAgentRunResult, OutlineAgentState } from './types.js';

function computeHardIterationLimit(maxRetries: number): number {
  // 每次尝试最多两步（generate + critic），再留 2 步缓冲
  return (maxRetries + 1) * 2 + 2;
}

export async function runOutlineAgent(params: {
  aiConfig: AIConfig;
  bible: string;
  targetChapters: number;
  targetWordCount: number;
  maxRetries?: number;
  targetScore?: number;
  goal?: string;
  useLLMPlanner?: boolean;
  callbacks?: OutlineAgentCallbacks;
}): Promise<OutlineAgentRunResult> {
  const {
    aiConfig,
    bible,
    targetChapters,
    targetWordCount,
    maxRetries = 2,
    targetScore = 8,
    goal = '完成一个结构完整、覆盖目标章数的小说大纲',
    useLLMPlanner = true,
    callbacks,
  } = params;

  let state: OutlineAgentState = createInitialOutlineState({
    goal,
    targetChapters,
    targetWordCount,
    targetScore,
    maxRetries,
  });

  const maxAttempts = maxRetries + 1;
  const hardLimit = computeHardIterationLimit(maxRetries);
  const registry = createOutlineToolRegistry({
    aiConfig,
    bible,
    targetChapters,
    targetWordCount,
    targetScore,
    callbacks,
  });

  while (!state.done && state.iteration < hardLimit) {
    const decision = await planOutlineNextAction({ aiConfig, state, useLLMPlanner });

    if (decision.tool === 'finish') {
      state = markDone(state, decision.reason);
      break;
    }

    if (decision.tool === 'generate_outline') {
      callbacks?.onAttemptStart?.({
        attempt: state.outlineVersion + 1,
        maxAttempts,
        reason: decision.reason,
      });
    }

    const tool = registry.get(decision.tool);
    const result = await tool.execute(state, decision.input ?? {});
    state = applyToolResult(state, decision, result);

    const latestEval = state.latestEvaluation;
    if (latestEval?.passed) {
      state = markDone(state, `评分达到目标阈值（${latestEval.score} / ${targetScore}）`);
      break;
    }

    if (latestEval && state.outlineVersion >= maxAttempts && !latestEval.passed) {
      state = markDone(
        state,
        `达到最大尝试次数 ${maxAttempts}，当前最佳评分 ${latestEval.score} / ${targetScore}`
      );
      break;
    }
  }

  if (!state.done) {
    state = markDone(state, `达到安全迭代上限 ${hardLimit}，提前停止`);
  }

  const finalOutline = state.bestOutline ?? state.latestOutline;
  const finalEvaluation = state.bestEvaluation ?? state.latestEvaluation;

  if (!finalOutline) {
    throw new Error('Agent stopped without producing an outline');
  }
  if (!finalEvaluation) {
    throw new Error('Agent stopped without quality evaluation');
  }

  return {
    outline: finalOutline,
    evaluation: finalEvaluation,
    attempts: state.outlineVersion,
    history: state.history,
    doneReason: state.doneReason || '完成',
  };
}
