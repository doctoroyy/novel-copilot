/**
 * 多维度质量检测系统 - 入口模块
 *
 * 整合多个维度的质量检测：
 * 1. 提前完结检测 (现有)
 * 2. 人物一致性检测
 * 3. 节奏对齐检测
 * 4. 目标达成检测
 * 5. 结构完整性检测
 */

import type { AIConfig } from '../services/aiClient.js';
import type { CharacterStateRegistry } from '../types/characterState.js';
import type { NarrativeGuide, EnhancedChapterOutline } from '../types/narrative.js';
import { quickEndingHeuristic } from '../qc.js';
import { checkCharacterConsistency, type CharacterQCResult } from './characterConsistencyCheck.js';
import { checkPacingAlignment, type PacingQCResult } from './pacingCheck.js';
import { checkGoalAchievement, type GoalQCResult } from './goalCheck.js';

/**
 * QC 问题严重程度
 */
export type QCSeverity = 'critical' | 'major' | 'minor';

/**
 * QC 问题类型
 */
export type QCIssueType =
  | 'character'   // 人物一致性问题
  | 'plot'        // 剧情问题
  | 'pacing'      // 节奏问题
  | 'style'       // 文风问题
  | 'structure'   // 结构问题
  | 'ending';     // 提前完结问题

/**
 * 单个 QC 问题
 */
export type QCIssue = {
  /** 问题类型 */
  type: QCIssueType;

  /** 严重程度 */
  severity: QCSeverity;

  /** 问题描述 */
  description: string;

  /** 问题位置 (原文引用) */
  location?: string;

  /** 修复建议 */
  suggestion?: string;
};

/**
 * QC 检测结果
 */
export type QCResult = {
  /** 是否通过 (无 critical 问题) */
  passed: boolean;

  /** 综合评分 0-100 */
  score: number;

  /** 所有问题列表 */
  issues: QCIssue[];

  /** 修复建议 */
  suggestions: string[];

  /** 各维度得分 */
  dimensionScores: {
    ending: number;      // 提前完结检测得分
    character: number;   // 人物一致性得分
    pacing: number;      // 节奏对齐得分
    goal: number;        // 目标达成得分
    structure: number;   // 结构完整性得分
  };

  /** 检测时间戳 */
  timestamp: string;
};

/**
 * QC 检测参数
 */
export type QCParams = {
  /** AI 配置 */
  aiConfig: AIConfig;

  /** 章节文本 */
  chapterText: string;

  /** 章节序号 */
  chapterIndex: number;

  /** 总章数 */
  totalChapters: number;

  /** 角色状态注册表 (可选) */
  characterStates?: CharacterStateRegistry;

  /** 叙事指导 (可选) */
  narrativeGuide?: NarrativeGuide;

  /** 章节大纲 (可选) */
  chapterOutline?: EnhancedChapterOutline;

  /** 是否使用 AI 检测 (默认 true) */
  useAI?: boolean;
};

/**
 * 运行多维度 QC 检测
 */
export async function runMultiDimensionalQC(params: QCParams): Promise<QCResult> {
  const {
    aiConfig,
    chapterText,
    chapterIndex,
    totalChapters,
    characterStates,
    narrativeGuide,
    chapterOutline,
    useAI = true,
  } = params;

  const allIssues: QCIssue[] = [];
  const dimensionScores = {
    ending: 100,
    character: 100,
    pacing: 100,
    goal: 100,
    structure: 100,
  };

  // 1. 提前完结检测 (基于规则，快速)
  const endingResult = checkPrematureEnding(chapterText, chapterIndex, totalChapters);
  allIssues.push(...endingResult.issues);
  dimensionScores.ending = endingResult.score;

  // 2. 结构完整性检测 (基于规则，快速)
  const structureResult = checkStructuralIntegrity(chapterText, chapterIndex);
  allIssues.push(...structureResult.issues);
  dimensionScores.structure = structureResult.score;

  // 3. 人物一致性检测 (需要 AI)
  if (useAI && characterStates && Object.keys(characterStates.snapshots).length > 0) {
    try {
      const characterResult = await checkCharacterConsistency(
        aiConfig,
        chapterText,
        characterStates
      );
      allIssues.push(...characterResult.issues);
      dimensionScores.character = characterResult.score;
    } catch (error) {
      console.warn('Character consistency check failed:', error);
    }
  }

  // 4. 节奏对齐检测 (需要 AI)
  if (useAI && narrativeGuide) {
    try {
      const pacingResult = await checkPacingAlignment(
        aiConfig,
        chapterText,
        narrativeGuide
      );
      allIssues.push(...pacingResult.issues);
      dimensionScores.pacing = pacingResult.score;
    } catch (error) {
      console.warn('Pacing alignment check failed:', error);
    }
  }

  // 5. 目标达成检测 (需要 AI)
  if (useAI && chapterOutline) {
    try {
      const goalResult = await checkGoalAchievement(
        aiConfig,
        chapterText,
        chapterOutline
      );
      allIssues.push(...goalResult.issues);
      dimensionScores.goal = goalResult.score;
    } catch (error) {
      console.warn('Goal achievement check failed:', error);
    }
  }

  // 计算综合评分
  const weights = {
    ending: 0.25,
    character: 0.25,
    pacing: 0.2,
    goal: 0.2,
    structure: 0.1,
  };

  const score = Math.round(
    dimensionScores.ending * weights.ending +
    dimensionScores.character * weights.character +
    dimensionScores.pacing * weights.pacing +
    dimensionScores.goal * weights.goal +
    dimensionScores.structure * weights.structure
  );

  // 生成修复建议
  const suggestions = generateSuggestions(allIssues);

  // 判断是否通过
  const hasCritical = allIssues.some((i) => i.severity === 'critical');

  return {
    passed: !hasCritical,
    score,
    issues: allIssues,
    suggestions,
    dimensionScores,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 检测提前完结
 */
function checkPrematureEnding(
  chapterText: string,
  chapterIndex: number,
  totalChapters: number
): { score: number; issues: QCIssue[] } {
  // 最终章不检测
  if (chapterIndex === totalChapters) {
    return { score: 100, issues: [] };
  }

  const result = quickEndingHeuristic(chapterText);
  const issues: QCIssue[] = [];

  if (result.hit) {
    issues.push({
      type: 'ending',
      severity: 'critical',
      description: `检测到提前完结信号：${result.reasons.join('; ')}`,
      suggestion: '请重写章节，移除完结相关的表达，保持剧情张力和悬念',
    });
  }

  return {
    score: result.hit ? 0 : 100,
    issues,
  };
}

/**
 * 检测结构完整性
 */
function checkStructuralIntegrity(
  chapterText: string,
  chapterIndex: number
): { score: number; issues: QCIssue[] } {
  const issues: QCIssue[] = [];
  let score = 100;

  // 检查字数
  const charCount = chapterText.length;
  if (charCount < 1500) {
    issues.push({
      type: 'structure',
      severity: 'major',
      description: `章节字数过少 (${charCount}字)，建议 2500-3500 字`,
      suggestion: '请扩充章节内容，增加场景描写或角色互动',
    });
    score -= 30;
  } else if (charCount > 5000) {
    issues.push({
      type: 'structure',
      severity: 'minor',
      description: `章节字数过多 (${charCount}字)，可能影响阅读节奏`,
      suggestion: '考虑拆分为两章或精简冗余描写',
    });
    score -= 10;
  }

  // 检查是否有章节标题
  const hasTitle = /^第[一二三四五六七八九十百千\d]+章/.test(chapterText.trim());
  if (!hasTitle) {
    issues.push({
      type: 'structure',
      severity: 'minor',
      description: '章节缺少标题',
      suggestion: '请在章节开头添加"第X章 标题"格式的标题',
    });
    score -= 5;
  }

  // 检查是否有对话 (大部分章节应该有对话)
  const dialogueCount = (chapterText.match(/["「『"]/g) || []).length;
  if (dialogueCount < 4) {
    issues.push({
      type: 'structure',
      severity: 'minor',
      description: '章节对话过少，可能显得沉闷',
      suggestion: '考虑增加角色对话以增强可读性',
    });
    score -= 10;
  }

  // 检查是否有明显的场景切换或段落分隔
  const paragraphCount = chapterText.split(/\n\s*\n/).length;
  if (paragraphCount < 3) {
    issues.push({
      type: 'structure',
      severity: 'minor',
      description: '章节段落划分过少，可能影响阅读体验',
      suggestion: '请适当分段，让阅读更加流畅',
    });
    score -= 5;
  }

  return { score: Math.max(0, score), issues };
}

/**
 * 根据问题生成修复建议
 */
function generateSuggestions(issues: QCIssue[]): string[] {
  const suggestions: string[] = [];

  // 按严重程度分组
  const criticalIssues = issues.filter((i) => i.severity === 'critical');
  const majorIssues = issues.filter((i) => i.severity === 'major');

  if (criticalIssues.length > 0) {
    suggestions.push('【紧急修复】以下问题必须修复：');
    criticalIssues.forEach((issue, i) => {
      suggestions.push(`  ${i + 1}. ${issue.description}`);
      if (issue.suggestion) {
        suggestions.push(`     建议：${issue.suggestion}`);
      }
    });
  }

  if (majorIssues.length > 0) {
    suggestions.push('【重要改进】以下问题建议修复：');
    majorIssues.forEach((issue, i) => {
      suggestions.push(`  ${i + 1}. ${issue.description}`);
      if (issue.suggestion) {
        suggestions.push(`     建议：${issue.suggestion}`);
      }
    });
  }

  return suggestions;
}

/**
 * 快速 QC (仅基于规则，不使用 AI)
 */
export function runQuickQC(
  chapterText: string,
  chapterIndex: number,
  totalChapters: number
): QCResult {
  const allIssues: QCIssue[] = [];

  const endingResult = checkPrematureEnding(chapterText, chapterIndex, totalChapters);
  allIssues.push(...endingResult.issues);

  const structureResult = checkStructuralIntegrity(chapterText, chapterIndex);
  allIssues.push(...structureResult.issues);

  const score = Math.round((endingResult.score + structureResult.score) / 2);
  const hasCritical = allIssues.some((i) => i.severity === 'critical');

  return {
    passed: !hasCritical,
    score,
    issues: allIssues,
    suggestions: generateSuggestions(allIssues),
    dimensionScores: {
      ending: endingResult.score,
      character: 100,
      pacing: 100,
      goal: 100,
      structure: structureResult.score,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * 格式化 QC 结果为可读字符串
 */
export function formatQCResult(result: QCResult): string {
  const parts: string[] = [];

  parts.push(`质量检测结果: ${result.passed ? '✅ 通过' : '❌ 未通过'}`);
  parts.push(`综合评分: ${result.score}/100`);
  parts.push('');
  parts.push('各维度评分:');
  parts.push(`  - 提前完结: ${result.dimensionScores.ending}/100`);
  parts.push(`  - 人物一致: ${result.dimensionScores.character}/100`);
  parts.push(`  - 节奏对齐: ${result.dimensionScores.pacing}/100`);
  parts.push(`  - 目标达成: ${result.dimensionScores.goal}/100`);
  parts.push(`  - 结构完整: ${result.dimensionScores.structure}/100`);

  if (result.issues.length > 0) {
    parts.push('');
    parts.push(`发现 ${result.issues.length} 个问题:`);
    result.issues.forEach((issue, i) => {
      const severityIcon =
        issue.severity === 'critical' ? '🔴' :
        issue.severity === 'major' ? '🟠' : '🟡';
      parts.push(`  ${i + 1}. ${severityIcon} [${issue.type}] ${issue.description}`);
    });
  }

  if (result.suggestions.length > 0) {
    parts.push('');
    parts.push('修复建议:');
    result.suggestions.forEach((s) => parts.push(s));
  }

  return parts.join('\n');
}
