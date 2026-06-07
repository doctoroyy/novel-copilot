/**
 * 节奏控制桥接 — 计算章节应有的节奏目标
 *
 * 来源: src/narrative/pacingController.ts + src/types/narrative.ts
 * 使用三幕结构规划卷级节奏曲线，为每章计算紧张度目标和叙事类型。
 */

export type PacingType =
  | 'action'
  | 'tension'
  | 'revelation'
  | 'emotional'
  | 'transition'
  | 'climax';

export type VolumePacingCurve = {
  volumeIndex: number;
  startChapter: number;
  endChapter: number;
  pacingCurve: number[];
  volumeClimaxOffset: number;
};

/**
 * 基于三幕结构规划卷级节奏曲线。
 * 返回每章的目标紧张度 (1-10)。
 */
export function planVolumePacingCurve(
  volumeIndex: number,
  startChapter: number,
  endChapter: number,
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
      const progress = i / (act1End || 1);
      curve.push(2 + progress * 3);
    } else if (i < act2End) {
      const progress = (i - act1End) / ((act2End - act1End) || 1);
      const base = 4 + progress * 4;
      const wave = Math.sin(progress * Math.PI * 3) * 1.5;
      curve.push(Math.max(4, Math.min(8, base + wave)));
    } else {
      const progress = (i - act2End) / ((chapterCount - act2End) || 1);
      if (progress < 0.7) {
        curve.push(8 + progress * 2.5);
      } else {
        const fallProgress = (progress - 0.7) / 0.3;
        curve.push(10 - fallProgress * 4);
      }
    }
  }

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
 * 从紧张度数值推导叙事类型。
 */
export function getPacingTypeFromLevel(level: number): PacingType {
  if (level >= 9) return 'climax';
  if (level >= 7) return 'action';
  if (level >= 5) return 'tension';
  if (level >= 3.5) return 'revelation';
  if (level >= 2) return 'emotional';
  return 'transition';
}

/**
 * 获取叙事类型的中文描述。
 */
export function getPacingTypeLabel(type: PacingType): string {
  const labels: Record<PacingType, string> = {
    action: '动作/战斗',
    tension: '紧张铺垫',
    revelation: '揭示/信息',
    emotional: '情感/关系',
    transition: '过渡/喘息',
    climax: '高潮',
  };
  return labels[type];
}

export type ChapterPacingGuidance = {
  chapterIndex: number;
  pacingTarget: number;
  pacingType: PacingType;
  pacingTypeLabel: string;
  volumePosition: string;  // e.g. "Act 1 - 铺垫期"
  isClimaxChapter: boolean;
  wordCountRange: [number, number];
  guidance: string;
};

/**
 * 为指定章节计算完整的节奏指导。
 *
 * @param chapterIndex 要写的章节索引 (1-based)
 * @param volumeStart 该章所属卷的起始章节
 * @param volumeEnd 该章所属卷的结束章节
 * @param minWords 最低字数要求
 */
export function getChapterPacingGuidance(
  chapterIndex: number,
  volumeStart: number,
  volumeEnd: number,
  minWords: number = 2500,
): ChapterPacingGuidance {
  const volumeIndex = 0; // 单卷计算
  const curve = planVolumePacingCurve(volumeIndex, volumeStart, volumeEnd);

  const offsetInVolume = chapterIndex - volumeStart;
  const pacingTarget = curve.pacingCurve[offsetInVolume] ?? 5;
  const pacingType = getPacingTypeFromLevel(pacingTarget);
  const isClimaxChapter = offsetInVolume === curve.volumeClimaxOffset;

  // 根据紧张度调整字数区间
  const baseMax = Math.round(minWords * 1.6);
  let wordMin = minWords;
  let wordMax = baseMax;
  if (pacingType === 'climax' || pacingType === 'action') {
    wordMin = Math.round(minWords * 1.1);
    wordMax = Math.round(baseMax * 1.2);
  } else if (pacingType === 'transition') {
    wordMax = Math.round(baseMax * 0.85);
  }

  // 判断所在幕
  const chapterCount = volumeEnd - volumeStart + 1;
  const progress = offsetInVolume / (chapterCount || 1);
  let volumePosition: string;
  if (progress < 0.25) {
    volumePosition = 'Act 1 - 铺垫期：建立冲突，积累期待';
  } else if (progress < 0.75) {
    volumePosition = 'Act 2 - 发展期：冲突升级，波动推进';
  } else {
    volumePosition = 'Act 3 - 高潮收尾：集中爆发，收束悬念';
  }

  // 生成指导文本
  const lines: string[] = [];
  lines.push(`紧张度目标: ${pacingTarget.toFixed(1)}/10`);
  lines.push(`叙事类型: ${getPacingTypeLabel(pacingType)}（${pacingType}）`);
  lines.push(`卷内位置: ${volumePosition}`);
  lines.push(`建议字数: ${wordMin}~${wordMax} 字`);
  if (isClimaxChapter) {
    lines.push(`⚡ 这是本卷高潮章节！伏笔集中触发，爆点最大化。`);
  }

  return {
    chapterIndex,
    pacingTarget: Math.round(pacingTarget * 10) / 10,
    pacingType,
    pacingTypeLabel: getPacingTypeLabel(pacingType),
    volumePosition,
    isClimaxChapter,
    wordCountRange: [wordMin, wordMax],
    guidance: lines.join('\n'),
  };
}
