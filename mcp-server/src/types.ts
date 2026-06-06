/**
 * Type declarations for cross-project imports.
 * We declare minimal types here to avoid coupling the MCP server's
 * tsconfig to the main project's module resolution.
 */

export interface AIConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface EnhancedWriteChapterParams {
  aiConfig: AIConfig;
  fallbackConfigs?: AIConfig[];
  bible: string;
  rollingSummary: string;
  openLoops: string[];
  lastChapters: string[];
  chapterIndex: number;
  totalChapters: number;
  minChapterWords?: number;
  chapterGoalHint?: string;
  chapterPromptProfile?: string;
  chapterPromptCustom?: string;
  enableFullQC?: boolean;
  enableAutoRepair?: boolean;
  enablePlanning?: boolean;
  enableSelfReview?: boolean;
  enableContextOptimization?: boolean;
}

export interface EnhancedWriteChapterResult {
  chapterText: string;
  updatedSummary: string;
  updatedOpenLoops: string[];
  wasRewritten: boolean;
  rewriteCount: number;
  generationDurationMs: number;
  qcResult?: {
    overallPass: boolean;
  };
}
