import type {
  ProjectAgentHistoryEntry,
  ProjectAgentState,
  ProjectPlannerDecision,
  ProjectToolResult,
} from './projectTypes.js';

function appendHistory(
  state: ProjectAgentState,
  entry: ProjectAgentHistoryEntry
): ProjectAgentHistoryEntry[] {
  return [...state.history, entry];
}

export function applyProjectToolResult(
  state: ProjectAgentState,
  decision: ProjectPlannerDecision,
  result: ProjectToolResult
): ProjectAgentState {
  const nextIteration = state.iteration + 1;
  const merged: ProjectAgentState = {
    ...state,
    ...(result.patch || {}),
    iteration: nextIteration,
  };

  return {
    ...merged,
    history: appendHistory(state, {
      iteration: nextIteration,
      timestamp: new Date().toISOString(),
      tool: decision.tool,
      reason: decision.reason,
      summary: result.summary,
    }),
  };
}

export function markProjectDone(state: ProjectAgentState, reason: string): ProjectAgentState {
  if (state.done) {
    return state;
  }
  const nextIteration = state.iteration + 1;
  return {
    ...state,
    done: true,
    doneReason: reason,
    iteration: nextIteration,
    history: appendHistory(state, {
      iteration: nextIteration,
      timestamp: new Date().toISOString(),
      tool: 'finish',
      reason,
      summary: reason,
    }),
  };
}
