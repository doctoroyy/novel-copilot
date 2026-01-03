/**
 * Novel Copilot 上下文工程系统 - 统一导出
 *
 * 包含：
 * - Phase 1: 人物状态追踪
 * - Phase 2: 剧情图谱
 * - Phase 3: 叙事控制
 * - Phase 4: 多维度 QC
 */

// ==================== Phase 1: 人物状态追踪 ====================
export type {
  CharacterStateSnapshot,
  CharacterStateChange,
  CharacterStateRegistry,
  PendingStateUpdate,
  AIStateChangeAnalysis,
} from './types/characterState.js';

export {
  createEmptyRegistry,
  createInitialSnapshot,
  formatSnapshotForPrompt,
  getActiveCharacterSnapshots,
  applyChangesToSnapshot,
} from './types/characterState.js';

export {
  initializeRegistryFromGraph,
  analyzeChapterForStateChanges,
  updateRegistry,
  buildCharacterStateContext,
  getCharacterState,
  manualUpdateCharacterState,
  validateStateConsistency,
} from './context/characterStateManager.js';

// ==================== Phase 2: 剧情图谱 ====================
export type {
  PlotNodeType,
  PlotNodeStatus,
  PlotNode,
  PlotEdgeRelation,
  PlotEdge,
  ForeshadowingUrgency,
  PendingForeshadowing,
  PlotGraph,
  AIPlotAnalysis,
} from './types/plotGraph.js';

export {
  createEmptyPlotGraph,
  generateNodeId,
  generateEdgeId,
  calculateForeshadowingUrgency,
  calculateSuggestedResolutionRange,
  getActiveForeshadowing,
  updatePendingForeshadowing,
  formatForeshadowingReminder,
  formatActivePlotLines,
  addNodeToGraph,
  addEdgeToGraph,
  updateNodeStatus,
  getRelatedEdges,
  getCausalChain,
} from './types/plotGraph.js';

export {
  analyzeChapterForPlotChanges,
  applyPlotAnalysis,
  buildPlotContext,
  getGraphStats,
  manualAddForeshadowing,
  manualResolveForeshadowing,
} from './context/plotManager.js';

// ==================== Phase 3: 叙事控制 ====================
export type {
  PacingType,
  PacingProfile,
  NarrativeGuide,
  SceneRequirement,
  NarrativeArc,
  VolumePacingCurve,
  EmotionalTurningPoint,
  EnhancedChapterOutline,
  ChapterGoal,
  ChapterHook,
  SceneOutline,
  ForeshadowingOperation,
  CharacterArcProgress,
} from './types/narrative.js';

export {
  PACING_PROFILES,
  EMOTIONAL_TONE_MAP,
  getEmotionalTone,
  getPacingTypeFromLevel,
  createEmptyNarrativeArc,
  formatNarrativeGuideForPrompt,
} from './types/narrative.js';

export {
  planVolumePacingCurve,
  generateNarrativeArc,
  getChapterPacingTarget,
  generateNarrativeGuide,
  getChapterPacingProfile,
  checkPacingBalance,
  buildNarrativeContext,
  adjustPacingCurve,
  getPacingCurveData,
} from './narrative/pacingController.js';

// ==================== Phase 4: 多维度 QC ====================
export type {
  QCSeverity,
  QCIssueType,
  QCIssue,
  QCResult,
  QCParams,
} from './qc/multiDimensionalQC.js';

export {
  runMultiDimensionalQC,
  runQuickQC,
  formatQCResult,
} from './qc/multiDimensionalQC.js';

export type { CharacterQCResult } from './qc/characterConsistencyCheck.js';
export { checkCharacterConsistency } from './qc/characterConsistencyCheck.js';

export type { PacingQCResult } from './qc/pacingCheck.js';
export { checkPacingAlignment } from './qc/pacingCheck.js';

export type { GoalQCResult } from './qc/goalCheck.js';
export { checkGoalAchievement, quickGoalCheck } from './qc/goalCheck.js';

export type { RepairResult } from './qc/repairLoop.js';
export {
  repairChapter,
  batchRepairChapters,
  getRepairStats,
} from './qc/repairLoop.js';

// ==================== Phase 5: 语义缓存 ====================
export type {
  CacheEntryType,
  CacheEntry,
} from './context/semanticCache.js';

export {
  SemanticCache,
  globalSemanticCache,
  generateCacheKey,
  computeStateVersion,
  detectContextChanges,
  buildIncrementalContext,
  warmupCache,
} from './context/semanticCache.js';

// ==================== 上下文优化器 ====================
export {
  buildOptimizedContext,
  buildOptimizedContextWithCache,
  getContextStats,
  getCacheStats,
  clearProjectCache,
  invalidateCacheFromChapter,
  estimateTokens,
  adjustBudgetForPacing,
  compressBible,
  optimizeCharacterContext,
  optimizePlotContext,
  optimizeRollingSummary,
  optimizeLastChapters,
  DEFAULT_BUDGET,
  type ContextBudget,
} from './contextOptimizer.js';

// ==================== 增强版章节引擎 ====================
export type {
  EnhancedWriteChapterParams,
  EnhancedWriteChapterResult,
} from './enhancedChapterEngine.js';

export {
  writeEnhancedChapter,
  generateChapterBatch,
} from './enhancedChapterEngine.js';

// ==================== Phase 6: 时间线追踪 ====================
export type {
  TimelineEventType,
  TimelineEventStatus,
  TimelineEvent,
  TimelineState,
  AIEventAnalysis,
} from './types/timeline.js';

export {
  createEmptyTimelineState,
  generateEventId,
  addEventToTimeline,
  updateEventStatus,
  getCompletedEvents,
  getActiveEvents,
  getRecentlyCompletedEvents,
  detectEventDuplication,
  extractCharacterNamesFromGraph,
  extractCharacterNamesFromRegistry,
  findCharactersInText,
  formatTimelineContext,
  generateUniqueKey,
  inferEventType,
} from './types/timeline.js';

export {
  getCharacterNameMap,
  analyzeChapterForEvents,
  applyEventAnalysis,
  buildTimelineContext,
  checkEventDuplication,
  initializeTimelineFromOutline,
  getTimelineStats,
} from './context/timelineManager.js';
