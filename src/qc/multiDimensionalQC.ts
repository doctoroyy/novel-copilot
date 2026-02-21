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

  /** 每章最少字数（正文，不含标题） */
  minChapterWords?: number;

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
    minChapterWords,
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
  const structureResult = checkStructuralIntegrity(chapterText, chapterIndex, minChapterWords);
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
  chapterIndex: number,
  minChapterWords: number = 1500
): { score: number; issues: QCIssue[] } {
  const issues: QCIssue[] = [];
  let score = 100;
  const normalizedMinWords = Math.max(500, Number.parseInt(String(minChapterWords || 1500), 10) || 1500);

  const trimmed = chapterText.trim();
  const looksLikeJsonPayload = (
    (/^```json/i.test(trimmed) && /"content"\s*:/.test(trimmed))
    || ((trimmed.startsWith('{') || trimmed.startsWith('[')) && /"content"\s*:/.test(trimmed) && /"title"\s*:/.test(trimmed))
  );
  if (looksLikeJsonPayload) {
    issues.push({
      type: 'structure',
      severity: 'critical',
      description: '章节内容是 JSON 结构而非正文文本',
      suggestion: '请仅输出章节正文（含标题），不要输出 JSON 或代码块',
    });
    return { score: 0, issues };
  }

  // 检查字数
  const charCount = chapterText.length;
  if (charCount < normalizedMinWords) {
    issues.push({
      type: 'structure',
      severity: 'major',
      description: `章节字数过少 (${charCount}字)，最低要求 ${normalizedMinWords} 字`,
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

  // ========== 新增：文学质量检测 ==========

  // 白开水检测：检查是否存在大段缺乏描写的文字
  const paragraphs = chapterText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  // 感官描写关键词
  const sensoryPattern = /看到|听到|听见|闻到|触感|温度|疼痛|灼热|冰冷|刺骨|芳香|恶臭|轰鸣|震颤|柔软|粗糙|明亮|昏暗|刺眼|微光|血腥|甘甜|苦涩|酸|辣|颤抖|麻痹|目光|眼神|瞳孔|嘴角|眉头|拳头|指尖|掌心|呼吸|心跳|脉搏|汗水|泪水|血液|伤口/;
  let blandParagraphs = 0;
  for (const p of paragraphs) {
    if (p.length > 200 && !sensoryPattern.test(p) && !/"/.test(p) && !/「/.test(p) && !/"/.test(p)) {
      blandParagraphs++;
    }
  }
  if (blandParagraphs >= 3) {
    issues.push({
      type: 'style',
      severity: 'major',
      description: `检测到 ${blandParagraphs} 段白开水文（超过200字但无感官描写或对话）`,
      suggestion: '增加具体的视觉、听觉、触觉等感官细节，让场景更有画面感',
    });
    score -= 15;
  }

  // 概述式写作检测
  const summaryPatterns = [
    /(?:接下来|之后|后来)(?:的|一)(?:几天|几日|几个月|一段时间|些日子)/,
    /(?:日子|时间|时光)(?:一天天|一天一天|就这样|就这么)(?:过去|流逝)/,
    /不知不觉.{0,5}(?:过去了|已经|便是)/,
    /(?:经过|花了|用了).{0,5}(?:几天|数日|半个月|一个月|数月).{0,10}(?:终于|总算|才)/,
  ];
  const summaryMatches: string[] = [];
  for (const pattern of summaryPatterns) {
    const match = chapterText.match(pattern);
    if (match) {
      summaryMatches.push(match[0]);
    }
  }
  if (summaryMatches.length >= 2) {
    issues.push({
      type: 'style',
      severity: 'major',
      description: `检测到概述式写作（${summaryMatches.join('；')}），缺少场景展开`,
      suggestion: '将时间跨度大的叙述替换为一个关键场景的详细展开',
    });
    score -= 15;
  }

  // 说教式结尾检测
  const lastChunk = chapterText.slice(-300);
  const didacticEndingPatterns = [
    /他(?:深深地?)?(?:知道|明白|清楚|意识到|感受到)/,
    /他(?:在心中|暗暗|默默)(?:发誓|下定决心|告诉自己)/,
    /这(?:一刻|一瞬|一天).*?(?:永远|终生|一辈子).*?(?:铭记|记住|忘不了)/,
    /(?:望着|看着|凝视).{0,10}(?:远方|天空|背影).{0,5}(?:他知道|心中)/,
  ];
  for (const pattern of didacticEndingPatterns) {
    if (pattern.test(lastChunk)) {
      issues.push({
        type: 'style',
        severity: 'minor',
        description: '章节以感悟/总结式语句结尾，缺少钩子',
        suggestion: '用悬念、反转或危机场景作为章节结尾，让读者想点下一章',
      });
      score -= 10;
      break;
    }
  }

  // 长段落检测
  const longParagraphs = paragraphs.filter(p => p.trim().length > 500);
  if (longParagraphs.length >= 2) {
    issues.push({
      type: 'structure',
      severity: 'minor',
      description: `存在 ${longParagraphs.length} 个超长段落（>500字），影响阅读节奏`,
      suggestion: '将超长段落拆分，穿插对话或短描写以调节节奏',
    });
    score -= 5;
  }

  // 对话质量检测：连续对话缺乏动作描写
  const lines = chapterText.split('\n');
  let consecutiveDialogue = 0;
  let maxConsecutiveDialogue = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^["「"『]/.test(trimmed) || /^[^\n]*?["「"『].*?["」"』]\s*$/.test(trimmed)) {
      consecutiveDialogue++;
      maxConsecutiveDialogue = Math.max(maxConsecutiveDialogue, consecutiveDialogue);
    } else if (trimmed.length > 0) {
      consecutiveDialogue = 0;
    }
  }
  if (maxConsecutiveDialogue >= 5) {
    issues.push({
      type: 'style',
      severity: 'minor',
      description: `存在连续 ${maxConsecutiveDialogue} 句纯对话缺乏动作/表情描写`,
      suggestion: '在对话间穿插角色的动作、表情、心理描写，避免"剧本化"',
    });
    score -= 10;
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
