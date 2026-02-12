import type {
  OutlineAgentHistoryEntry,
  OutlineAgentState,
  OutlineToolResult,
  PlannerDecision,
} from './types.js';

export function createInitialOutlineState(args: {
  goal: string;
  targetChapters: number;
  targetWordCount: number;
  targetScore: number;
  maxRetries: number;
}): OutlineAgentState {
  return {
    goal: args.goal,
    targetChapters: args.targetChapters,
    targetWordCount: args.targetWordCount,
    targetScore: args.targetScore,
    maxRetries: args.maxRetries,
    iteration: 0,
    outlineVersion: 0,
    history: [],
    done: false,
  };
}

function appendHistory(
  state: OutlineAgentState,
  entry: OutlineAgentHistoryEntry
): OutlineAgentHistoryEntry[] {
  return [...state.history, entry];
}

function shouldUpdateBest(
  currentBest: OutlineAgentState['bestEvaluation'],
  candidate: NonNullable<OutlineAgentState['latestEvaluation']>
): boolean {
  if (!currentBest) {
    return true;
  }
  return candidate.score > currentBest.score;
}

export function applyToolResult(
  state: OutlineAgentState,
  decision: PlannerDecision,
  result: OutlineToolResult
): OutlineAgentState {
  const nextIteration = state.iteration + 1;

  if (result.kind === 'generated_outline') {
    return {
      ...state,
      iteration: nextIteration,
      outlineVersion: state.outlineVersion + 1,
      latestOutline: result.outline,
      latestEvaluation: undefined,
      history: appendHistory(state, {
        iteration: nextIteration,
        timestamp: new Date().toISOString(),
        tool: decision.tool,
        reason: decision.reason,
        summary: result.summary,
      }),
    };
  }

  const nextState: OutlineAgentState = {
    ...state,
    iteration: nextIteration,
    latestEvaluation: result.evaluation,
    history: appendHistory(state, {
      iteration: nextIteration,
      timestamp: new Date().toISOString(),
      tool: decision.tool,
      reason: decision.reason,
      summary: result.summary,
      score: result.evaluation.score,
    }),
  };

  if (nextState.latestOutline && shouldUpdateBest(nextState.bestEvaluation, result.evaluation)) {
    nextState.bestOutline = nextState.latestOutline;
    nextState.bestEvaluation = result.evaluation;
  }

  return nextState;
}

export function markDone(state: OutlineAgentState, reason: string): OutlineAgentState {
  if (state.done) {
    return state;
  }
  return {
    ...state,
    done: true,
    doneReason: reason,
    history: appendHistory(state, {
      iteration: state.iteration + 1,
      timestamp: new Date().toISOString(),
      tool: 'finish',
      reason,
      summary: reason,
      score: state.latestEvaluation?.score ?? state.bestEvaluation?.score,
    }),
  };
}
