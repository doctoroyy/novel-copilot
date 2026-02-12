export type OutlineChapter = {
  index: number;
  title: string;
  goal: string;
  hook: string;
};

export type OutlineVolume = {
  title: string;
  startChapter: number;
  endChapter: number;
  goal: string;
  conflict: string;
  climax: string;
  volumeEndState?: string;
  chapters: OutlineChapter[];
};

export type OutlineDocument = {
  totalChapters: number;
  targetWordCount: number;
  volumes: OutlineVolume[];
  mainGoal: string;
  milestones: string[];
};

export type OutlineQualityMetrics = {
  coverage: number;
  titleQuality: number;
  goalQuality: number;
  structure: number;
  milestoneQuality: number;
};

export type OutlineQualityEvaluation = {
  score: number;
  passed: boolean;
  issues: string[];
  metrics: OutlineQualityMetrics;
};

export type OutlineToolName = 'generate_outline' | 'critic_outline';
export type PlannerToolName = OutlineToolName | 'finish';

export type PlannerDecision = {
  tool: PlannerToolName;
  reason: string;
  input?: Record<string, unknown>;
};

export type OutlineAgentHistoryEntry = {
  iteration: number;
  timestamp: string;
  tool: PlannerToolName;
  reason: string;
  summary: string;
  score?: number;
};

export type OutlineAgentState = {
  goal: string;
  targetChapters: number;
  targetWordCount: number;
  targetScore: number;
  maxRetries: number;
  iteration: number;
  outlineVersion: number;
  latestOutline?: OutlineDocument;
  latestEvaluation?: OutlineQualityEvaluation;
  bestOutline?: OutlineDocument;
  bestEvaluation?: OutlineQualityEvaluation;
  history: OutlineAgentHistoryEntry[];
  done: boolean;
  doneReason?: string;
};

export type OutlineToolResult =
  | {
      kind: 'generated_outline';
      outline: OutlineDocument;
      summary: string;
    }
  | {
      kind: 'outline_critique';
      evaluation: OutlineQualityEvaluation;
      summary: string;
    };

export type OutlineToolDefinition = {
  name: OutlineToolName;
  description: string;
  execute: (
    state: OutlineAgentState,
    input: Record<string, unknown>
  ) => Promise<OutlineToolResult>;
};

export type OutlineAgentCallbacks = {
  onAttemptStart?: (payload: {
    attempt: number;
    maxAttempts: number;
    reason: string;
  }) => void;
  onMasterOutline?: (payload: {
    attempt: number;
    totalVolumes: number;
    mainGoal: string;
  }) => void;
  onVolumeStart?: (payload: {
    attempt: number;
    volumeIndex: number;
    totalVolumes: number;
    volumeTitle: string;
  }) => void;
  onVolumeComplete?: (payload: {
    attempt: number;
    volumeIndex: number;
    totalVolumes: number;
    volumeTitle: string;
    chapterCount: number;
  }) => void;
  onCritic?: (payload: {
    attempt: number;
    score: number;
    passed: boolean;
    issues: string[];
  }) => void;
};

export type OutlineAgentRunResult = {
  outline: OutlineDocument;
  evaluation: OutlineQualityEvaluation;
  attempts: number;
  history: OutlineAgentHistoryEntry[];
  doneReason: string;
};
