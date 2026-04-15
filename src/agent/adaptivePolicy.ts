export type ComplexityLevel = 'low' | 'medium' | 'high';

export type ChapterComplexityInput = {
  chapterIndex: number;
  totalChapters: number;
  openLoopsCount: number;
  hasNarrativeArc: boolean;
  hasEnhancedOutline: boolean;
  timelineEventCount: number;
  previousChapterLength: number;
  hasBridgeGoalHint: boolean;
};

export type AgentExecutionPlan = {
  complexity: {
    score: number;
    level: ComplexityLevel;
  };
  agent: {
    maxTurns: number;
    maxAICalls: number;
    maxToolCallsPerTurn: number;
  };
  context: {
    mode: 'focused' | 'balanced';
    targetTokens: number;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function assessChapterComplexity(input: ChapterComplexityInput): {
  score: number;
  level: ComplexityLevel;
} {
  const progress = input.totalChapters > 0
    ? input.chapterIndex / input.totalChapters
    : 0;

  let score = 0;

  score += Math.min(30, Math.max(0, input.openLoopsCount) * 4);

  if (progress >= 0.75) score += 15;
  if (progress >= 0.9) score += 8;

  if (input.hasNarrativeArc) score += 10;
  if (input.hasEnhancedOutline) score += 8;
  if (input.hasBridgeGoalHint) score += 12;

  if (input.timelineEventCount >= 80) score += 10;
  else if (input.timelineEventCount >= 25) score += 5;

  if (input.previousChapterLength >= 7000) score += 10;
  else if (input.previousChapterLength >= 5000) score += 7;
  else if (input.previousChapterLength >= 3500) score += 4;

  score = clamp(score, 0, 100);

  const level: ComplexityLevel = score >= 70
    ? 'high'
    : score >= 35
      ? 'medium'
      : 'low';

  return { score, level };
}

export type FastPathInput = {
  complexityLevel: ComplexityLevel;
  hasPlotGraph: boolean;
  hasPendingCriticalForeshadowing: boolean;
  agentMaxTurnsOverride: number | undefined;
};

export function shouldUseFastPath(input: FastPathInput): boolean {
  if (input.complexityLevel !== 'low') return false;
  if (input.agentMaxTurnsOverride != null) return false;
  if (input.hasPendingCriticalForeshadowing) return false;
  return true;
}

export function deriveAgentExecutionPlan(
  input: ChapterComplexityInput,
  options?: { minChapterWords?: number }
): AgentExecutionPlan {
  const complexity = assessChapterComplexity(input);
  const minChapterWords = Math.max(1200, Number(options?.minChapterWords) || 2500);

  if (complexity.level === 'low') {
    return {
      complexity,
      agent: {
        maxTurns: 3,
        maxAICalls: 4,
        maxToolCallsPerTurn: 2,
      },
      context: {
        mode: 'focused',
        targetTokens: clamp(Math.round(minChapterWords * 2.8), 6000, 9000),
      },
    };
  }

  if (complexity.level === 'high') {
    return {
      complexity,
      agent: {
        maxTurns: minChapterWords >= 3200 ? 6 : 5,
        maxAICalls: minChapterWords >= 3200 ? 10 : 8,
        maxToolCallsPerTurn: 2,
      },
      context: {
        mode: 'balanced',
        targetTokens: clamp(Math.round(minChapterWords * 4.2), 12000, 18000),
      },
    };
  }

  return {
    complexity,
    agent: {
      maxTurns: 4,
      maxAICalls: 6,
      maxToolCallsPerTurn: 2,
    },
    context: {
      mode: 'balanced',
      targetTokens: clamp(Math.round(minChapterWords * 3.6), 10000, 14000),
    },
  };
}
