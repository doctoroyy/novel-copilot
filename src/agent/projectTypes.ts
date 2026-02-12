import type { AIConfig } from '../services/aiClient.js';
import type { NovelOutline } from '../generateOutline.js';
import type { CharacterRelationGraph } from '../types/characters.js';
import type { QCResult } from '../qc/multiDimensionalQC.js';

export type ProjectToolName =
  | 'ensure_outline'
  | 'ensure_characters'
  | 'generate_chapter'
  | 'qc_chapter'
  | 'repair_chapter'
  | 'commit_chapter';

export type ProjectPlannerToolName = ProjectToolName | 'finish';

export type ProjectPlannerDecision = {
  tool: ProjectPlannerToolName;
  reason: string;
  input?: Record<string, unknown>;
};

export type ChapterGenerationOutput = {
  chapterIndex: number;
  chapterText: string;
  updatedSummary: string;
  updatedOpenLoops: string[];
  outlineTitle?: string;
  outlineGoal?: string;
  wasRewritten: boolean;
  rewriteCount: number;
  repairCount: number;
};

export type GeneratedChapterRecord = {
  chapterIndex: number;
  title: string;
  wordCount: number;
  qcScore?: number;
  repaired: boolean;
  issues?: string[];
};

export type ProjectAgentHistoryEntry = {
  iteration: number;
  timestamp: string;
  tool: ProjectPlannerToolName;
  reason: string;
  summary: string;
};

export type ProjectAgentState = {
  projectId: string;
  projectName: string;
  userId: string;
  aiConfig: AIConfig;
  goal: string;
  bible: string;
  totalChapters: number;
  targetChaptersToGenerate: number;
  startChapterIndex: number;
  currentChapterIndex: number;
  endChapterIndex: number;
  maxRepairAttempts: number;
  iteration: number;
  done: boolean;
  doneReason?: string;
  outline?: NovelOutline;
  characters?: CharacterRelationGraph;
  rollingSummary: string;
  openLoops: string[];
  pendingChapter?: ChapterGenerationOutput;
  pendingQC?: QCResult;
  generated: GeneratedChapterRecord[];
  failedChapters: number[];
  history: ProjectAgentHistoryEntry[];
};

export type ProjectToolContext = {
  db: D1Database;
  useLLMPlanner: boolean;
  autoGenerateOutline: boolean;
  autoGenerateCharacters: boolean;
  onStatus?: (payload: {
    type: string;
    message: string;
    chapterIndex?: number;
    data?: Record<string, unknown>;
  }) => void;
};

export type ProjectToolResult = {
  summary: string;
  patch?: Partial<ProjectAgentState>;
};

export type ProjectToolDefinition = {
  name: ProjectToolName;
  description: string;
  execute: (
    state: ProjectAgentState,
    context: ProjectToolContext,
    input: Record<string, unknown>
  ) => Promise<ProjectToolResult>;
};

export type ProjectAgentRunResult = {
  generated: GeneratedChapterRecord[];
  failedChapters: number[];
  attempts: number;
  doneReason: string;
  history: ProjectAgentHistoryEntry[];
};
