/**
 * 节奏控制器
 *
 * 负责：
 * 1. 规划卷级和章级的节奏曲线
 * 2. 生成章节的叙事指导
 * 3. 动态调整节奏以保持阅读体验
 */

import type { VolumeOutline, ChapterOutline } from '../generateOutline.js';
import {
  type NarrativeArc,
  type NarrativeGuide,
  type VolumePacingCurve,
  type PacingType,
  type SceneRequirement,
  PACING_PROFILES,
  getEmotionalTone,
  getPacingTypeFromLevel,
  createEmptyNarrativeArc,
  formatNarrativeGuideForPrompt,
} from '../types/narrative.js';

/**
 * 基于三幕结构规划卷级节奏曲线
 */
export function planVolumePacingCurve(
  volumeIndex: number,
  startChapter: number,
  endChapter: number
): VolumePacingCurve {
  const chapterCount = endChapter - startChapter + 1;
  const curve: number[] = [];

  // 三幕结构
  // Act 1 (25%): 铺垫，紧张度 2->5
  // Act 2 (50%): 发展，紧张度波动 4->7->5->8
  // Act 3 (25%): 高潮+收尾，紧张度 8->10->6

  const act1End = Math.floor(chapterCount * 0.25);
  const act2End = Math.floor(chapterCount * 0.75);

  for (let i = 0; i < chapterCount; i++) {
    if (i < act1End) {
      // Act 1: 线性上升
      const progress = i / act1End;
      curve.push(2 + progress * 3);
    } else if (i < act2End) {
      // Act 2: 波动上升
      const progress = (i - act1End) / (act2End - act1End);
      const base = 4 + progress * 4;
      // 添加波动
      const wave = Math.sin(progress * Math.PI * 3) * 1.5;
      curve.push(Math.max(4, Math.min(8, base + wave)));
    } else {
      // Act 3: 高潮 + 收尾
      const progress = (i - act2End) / (chapterCount - act2End);
      if (progress < 0.7) {
        // 高潮攀升
        curve.push(8 + progress * 2.5);
      } else {
        // 收尾回落
        const fallProgress = (progress - 0.7) / 0.3;
        curve.push(10 - fallProgress * 4);
      }
    }
  }

  // 找到卷高潮位置
  const volumeClimaxOffset = curve.indexOf(Math.max(...curve));

  return {
    volumeIndex,
    startChapter,
    endChapter,
    pacingCurve: curve.map((v) => Math.round(v * 10) / 10),
    volumeClimaxOffset,
  };
}

/**
 * 为整本书生成叙事弧线
 */
export function generateNarrativeArc(
  volumes: VolumeOutline[],
  totalChapters: number
): NarrativeArc {
  const arc = createEmptyNarrativeArc(totalChapters);

  // 为每卷生成节奏曲线
  volumes.forEach((volume, index) => {
    const volumeCurve = planVolumePacingCurve(
      index,
      volume.startChapter,
      volume.endChapter
    );
    arc.volumePacing.push(volumeCurve);

    // 记录高潮章节
    const climaxChapter = volume.startChapter + volumeCurve.volumeClimaxOffset;
    arc.climaxChapters.push(climaxChapter);
  });

  // 识别过渡章节 (低节奏章节)
  for (const volumeCurve of arc.volumePacing) {
    volumeCurve.pacingCurve.forEach((pacing, i) => {
      if (pacing <= 3) {
        arc.transitionChapters.push(volumeCurve.startChapter + i);
      }
    });
  }

  return arc;
}

/**
 * 获取章节的目标节奏
 */
export function getChapterPacingTarget(
  arc: NarrativeArc,
  chapterIndex: number,
  previousPacing?: number
): number {
  // 找到对应的卷
  const volumeCurve = arc.volumePacing.find(
    (v) => chapterIndex >= v.startChapter && chapterIndex <= v.endChapter
  );

  if (!volumeCurve) {
    return 5; // 默认中等节奏
  }

  const localIndex = chapterIndex - volumeCurve.startChapter;
  let targetPacing = volumeCurve.pacingCurve[localIndex] ?? 5;

  // 平滑处理：避免节奏跳跃过大
  if (previousPacing !== undefined) {
    const maxDelta = 2.5;
    if (Math.abs(targetPacing - previousPacing) > maxDelta) {
      targetPacing =
        previousPacing + Math.sign(targetPacing - previousPacing) * maxDelta;
    }
  }

  return Math.round(targetPacing * 10) / 10;
}

/**
 * 生成章节的叙事指导
 */
export function generateNarrativeGuide(
  arc: NarrativeArc,
  chapterIndex: number,
  totalChapters: number,
  chapterOutline?: ChapterOutline,
  previousPacing?: number
): NarrativeGuide {
  const pacingTarget = getChapterPacingTarget(arc, chapterIndex, previousPacing);
  const pacingType = getPacingTypeFromLevel(pacingTarget);
  const profile = PACING_PROFILES[pacingType];

  // 生成场景要求
  const sceneRequirements = generateSceneRequirements(
    chapterOutline,
    pacingType
  );

  // 生成禁止事项
  const prohibitions = generateProhibitions(
    chapterIndex,
    totalChapters,
    pacingTarget
  );

  // 生成节奏说明
  const pacingGuidance = generatePacingGuidance(pacingType, pacingTarget);

  return {
    chapterIndex,
    pacingTarget,
    pacingType,
    emotionalTone: getEmotionalTone(pacingTarget),
    sceneRequirements,
    prohibitions,
    wordCountRange: profile.wordCountRange,
    pacingGuidance,
  };
}

/**
 * 生成场景要求
 */
function generateSceneRequirements(
  chapterOutline?: ChapterOutline,
  pacingType?: PacingType
): SceneRequirement[] {
  const scenes: SceneRequirement[] = [];

  // 基于大纲目标推断场景结构
  const goal = chapterOutline?.goal?.toLowerCase() ?? '';

  if (goal.includes('战斗') || goal.includes('冲突') || goal.includes('对决')) {
    scenes.push(
      { order: 1, type: 'setup', purpose: '战前铺垫和局势交代' },
      { order: 2, type: 'confrontation', purpose: '正面冲突爆发' },
      { order: 3, type: 'confrontation', purpose: '冲突升级或转折' },
      { order: 4, type: 'resolution', purpose: '结果展示和悬念留置' }
    );
  } else if (goal.includes('揭秘') || goal.includes('发现') || goal.includes('真相')) {
    scenes.push(
      { order: 1, type: 'setup', purpose: '线索发现或疑点出现' },
      { order: 2, type: 'transition', purpose: '调查/回忆/分析' },
      { order: 3, type: 'revelation', purpose: '真相揭露' },
      { order: 4, type: 'resolution', purpose: '情绪反应和后续铺垫' }
    );
  } else if (goal.includes('情感') || goal.includes('关系') || goal.includes('心理')) {
    scenes.push(
      { order: 1, type: 'setup', purpose: '情境建立' },
      { order: 2, type: 'confrontation', purpose: '情感冲突或交流' },
      { order: 3, type: 'resolution', purpose: '关系变化或决定' }
    );
  } else {
    // 默认结构
    scenes.push(
      { order: 1, type: 'setup', purpose: '场景建立和背景交代' },
      { order: 2, type: 'confrontation', purpose: '主要事件展开' },
      { order: 3, type: 'transition', purpose: '角色互动和反应' },
      { order: 4, type: 'resolution', purpose: '悬念留置' }
    );
  }

  return scenes;
}

/**
 * 生成禁止事项
 */
function generateProhibitions(
  chapterIndex: number,
  totalChapters: number,
  pacingTarget: number
): string[] {
  const prohibitions: string[] = [];

  // 非终章禁止
  if (chapterIndex < totalChapters) {
    prohibitions.push('禁止出现完结/终章/尾声/后记等词汇');
    prohibitions.push('禁止一次性解决所有伏笔');
    prohibitions.push('禁止总结性的人生回顾');
  }

  // 高节奏禁止
  if (pacingTarget >= 7) {
    prohibitions.push('禁止冗长的心理独白（超过200字）');
    prohibitions.push('禁止无关的日常对话');
    prohibitions.push('禁止节奏放缓的过渡段落');
    prohibitions.push('禁止大段景物描写');
  }

  // 低节奏禁止
  if (pacingTarget <= 3) {
    prohibitions.push('禁止突发的生死危机');
    prohibitions.push('禁止大规模战斗场景');
    prohibitions.push('禁止情节急转直下');
    prohibitions.push('禁止过于激烈的冲突');
  }

  // 中等节奏
  if (pacingTarget > 3 && pacingTarget < 7) {
    prohibitions.push('禁止节奏过于平淡，需保持适度张力');
  }

  return prohibitions;
}

/**
 * 生成节奏说明
 */
function generatePacingGuidance(pacingType: PacingType, pacingTarget: number): string {
  const guidanceMap: Record<PacingType, string> = {
    action: `本章是动作/冲突章节（紧张度${pacingTarget}/10）。请使用短句、快速场景切换、动作描写为主。对话简短有力，避免冗长的心理活动。每个段落都要推动冲突发展。`,

    tension: `本章是紧张铺垫章节（紧张度${pacingTarget}/10）。请营造压迫感和危机感，使用暗示和伏笔。对话可以有潜台词和试探，让读者感受到即将到来的风暴。`,

    revelation: `本章是揭示/发现章节（紧张度${pacingTarget}/10）。信息密度较高，请有节奏地释放关键信息。角色的反应要真实，给读者消化信息的时间，但保持适度悬念。`,

    emotional: `本章是情感章节（紧张度${pacingTarget}/10）。请注重角色内心描写和关系发展。对话可以更细腻，描写可以更具体。这是读者的喘息章节，但仍需有微妙张力。`,

    transition: `本章是过渡章节（紧张度${pacingTarget}/10）。用于调整节奏、补充设定、发展角色关系。虽然紧张度低，但要埋下后续剧情的种子，不能纯粹的日常流水账。`,

    climax: `本章是高潮章节（紧张度${pacingTarget}/10）。情感和冲突都要达到峰值。使用强烈的对比、出人意料的转折、命运的抉择。这是最关键的章节，要让读者难以释卷。`,
  };

  return guidanceMap[pacingType];
}

/**
 * 获取章节的节奏配置
 */
export function getChapterPacingProfile(pacingType: PacingType) {
  return PACING_PROFILES[pacingType];
}

/**
 * 检查节奏是否平衡（避免连续多章相同节奏）
 */
export function checkPacingBalance(
  recentPacingTypes: PacingType[],
  currentType: PacingType
): { balanced: boolean; suggestion?: string } {
  if (recentPacingTypes.length < 3) {
    return { balanced: true };
  }

  const last3 = recentPacingTypes.slice(-3);

  // 检查是否连续3章相同类型
  if (last3.every((t) => t === currentType)) {
    return {
      balanced: false,
      suggestion: `连续4章都是${currentType}类型，建议调整节奏以避免读者疲劳`,
    };
  }

  // 检查是否连续3章都是高紧张度
  const highTensionTypes: PacingType[] = ['action', 'climax', 'tension'];
  if (
    last3.every((t) => highTensionTypes.includes(t)) &&
    highTensionTypes.includes(currentType)
  ) {
    return {
      balanced: false,
      suggestion: '连续多章高紧张度，建议插入一章过渡或情感章节',
    };
  }

  // 检查是否连续3章都是低紧张度
  const lowTensionTypes: PacingType[] = ['emotional', 'transition'];
  if (
    last3.every((t) => lowTensionTypes.includes(t)) &&
    lowTensionTypes.includes(currentType)
  ) {
    return {
      balanced: false,
      suggestion: '连续多章低紧张度，节奏可能过于拖沓，建议提升张力',
    };
  }

  return { balanced: true };
}

/**
 * 生成用于章节生成的叙事上下文
 */
export function buildNarrativeContext(
  guide: NarrativeGuide,
  includeScenes: boolean = true
): string {
  return formatNarrativeGuideForPrompt(guide);
}

/**
 * 调整节奏曲线（用于人工微调）
 */
export function adjustPacingCurve(
  arc: NarrativeArc,
  chapterIndex: number,
  newPacing: number
): NarrativeArc {
  const updated = { ...arc, volumePacing: [...arc.volumePacing] };

  for (let i = 0; i < updated.volumePacing.length; i++) {
    const volumeCurve = updated.volumePacing[i];
    if (
      chapterIndex >= volumeCurve.startChapter &&
      chapterIndex <= volumeCurve.endChapter
    ) {
      const localIndex = chapterIndex - volumeCurve.startChapter;
      const newCurve = [...volumeCurve.pacingCurve];
      newCurve[localIndex] = newPacing;
      updated.volumePacing[i] = {
        ...volumeCurve,
        pacingCurve: newCurve,
      };
      break;
    }
  }

  return updated;
}

/**
 * 获取节奏曲线的可视化数据
 */
export function getPacingCurveData(arc: NarrativeArc): {
  chapters: number[];
  pacing: number[];
  climaxPoints: number[];
  transitionPoints: number[];
} {
  const chapters: number[] = [];
  const pacing: number[] = [];

  for (const volumeCurve of arc.volumePacing) {
    volumeCurve.pacingCurve.forEach((p, i) => {
      chapters.push(volumeCurve.startChapter + i);
      pacing.push(p);
    });
  }

  return {
    chapters,
    pacing,
    climaxPoints: arc.climaxChapters,
    transitionPoints: arc.transitionChapters,
  };
}
