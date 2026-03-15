type ContinuationChapterLike = {
  index?: number | null;
  title?: string | null;
  goal?: string | null;
  hook?: string | null;
};

type ContinuationVolumeLike = {
  title?: string | null;
  startChapter?: number | null;
  endChapter?: number | null;
  goal?: string | null;
  conflict?: string | null;
  climax?: string | null;
  volumeEndState?: string | null;
  volume_end_state?: string | null;
  chapters?: ContinuationChapterLike[] | null;
};

type CurrentVolumeLike = {
  title?: string | null;
  startChapter?: number | null;
  endChapter?: number | null;
  goal?: string | null;
  conflict?: string | null;
  climax?: string | null;
  volumeEndState?: string | null;
  volume_end_state?: string | null;
};

export const VOLUME_BRIDGE_CHAPTER_COUNT = 2;

export const TIMELINE_RESET_PATTERN = /(重置(?:了)?时间线|时间线(?:被)?重置|新的轮回|重新轮回|轮回重启|回到(?:故事)?开始|回到.*(?:过去|最初|起点|开端)|时光倒流|逆转时间|世界线改写|改写世界线|回档|读档重来|重来一次|从头再来)/;

function pickText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function describeChapterForContinuation(chapter: ContinuationChapterLike | null | undefined): string | null {
  if (!chapter) return null;

  const index = Number(chapter.index);
  const title = pickText(chapter.title);
  const goal = pickText(chapter.goal);
  const hook = pickText(chapter.hook);
  const chapterNo = Number.isFinite(index) && index > 0 ? `第${index}章` : '章节';
  const parts = [title ? `${chapterNo}「${title}」` : chapterNo];

  if (goal) parts.push(goal);
  if (hook) parts.push(`钩子: ${hook}`);

  return parts.join(' | ');
}

export function buildVolumeContinuationSummary(
  volume: ContinuationVolumeLike | null | undefined,
): string {
  if (!volume) return '';

  const volumeEndState = pickText(volume.volumeEndState, volume.volume_end_state);
  const parts: string[] = [];

  if (pickText(volume.title)) parts.push(`卷名: ${pickText(volume.title)}`);
  if (Number(volume.startChapter) > 0 && Number(volume.endChapter) > 0) {
    parts.push(`章节范围: 第${Number(volume.startChapter)}-${Number(volume.endChapter)}章`);
  }
  if (pickText(volume.goal)) parts.push(`本卷目标: ${pickText(volume.goal)}`);
  if (pickText(volume.conflict)) parts.push(`核心冲突: ${pickText(volume.conflict)}`);
  if (pickText(volume.climax)) parts.push(`卷末高潮: ${pickText(volume.climax)}`);
  if (volumeEndState) parts.push(`卷末状态: ${volumeEndState}`);

  const tailChapters = Array.isArray(volume.chapters)
    ? volume.chapters
        .slice()
        .sort((left, right) => Number(left?.index || 0) - Number(right?.index || 0))
        .slice(-3)
        .map(describeChapterForContinuation)
        .filter((item): item is string => Boolean(item))
    : [];

  if (tailChapters.length > 0) {
    parts.push(`最后关键章节:\n- ${tailChapters.join('\n- ')}`);
  }

  const combined = parts.join('\n');
  if (TIMELINE_RESET_PATTERN.test(combined)) {
    parts.push('时间线规则: 上一卷已出现时间线重置/轮回重启信号，续写必须以重置后的世界状态为新的基线，不得直接沿用重置前已被覆盖的主冲突。');
  }

  return parts.join('\n');
}

export function isVolumeBridgeChapter(
  chapterIndex: number,
  volumeStartChapter: number,
  bridgeChapterCount: number = VOLUME_BRIDGE_CHAPTER_COUNT,
): boolean {
  if (!Number.isInteger(chapterIndex) || !Number.isInteger(volumeStartChapter)) {
    return false;
  }
  return chapterIndex >= volumeStartChapter && chapterIndex < volumeStartChapter + bridgeChapterCount;
}

export function buildVolumeBridgeNotes(args: {
  chapterOffset: number;
  bridgeChapterCount?: number;
  isTimelineReset?: boolean;
}): string[] {
  const {
    chapterOffset,
    bridgeChapterCount = VOLUME_BRIDGE_CHAPTER_COUNT,
    isTimelineReset = false,
  } = args;

  const notes: string[] = [];

  if (chapterOffset === 0) {
    notes.push(`本章属于新卷开场前 ${bridgeChapterCount} 章的桥接段，第 1 章必须直接承接上一卷结局，先处理卷末直接后果，再允许展开本卷新矛盾。`);
  } else {
    notes.push(`本章仍属于新卷开场前 ${bridgeChapterCount} 章的桥接段，第 ${chapterOffset + 1} 章必须延续上一卷余波和上一章已开启的后果，不能像卷切换没发生过一样直接换题。`);
  }

  notes.push('桥接未完成前，不得跳过上卷最后一幕带来的身份、关系、伤势、地点、权力或敌我格局变化。');

  if (isTimelineReset) {
    notes.push('上一卷涉及时间线重置/轮回重启，本章必须完全以重置后的身份、关系、情报和敌我格局为基线。');
  }

  return notes;
}

export function buildVolumeBridgeContext(args: {
  previousVolume?: ContinuationVolumeLike | null;
  previousVolumeSummary?: string;
  actualStorySummary?: string;
  currentVolume?: CurrentVolumeLike | null;
  bridgeChapterCount?: number;
}): string | undefined {
  const {
    previousVolume,
    previousVolumeSummary,
    actualStorySummary,
    currentVolume,
    bridgeChapterCount = VOLUME_BRIDGE_CHAPTER_COUNT,
  } = args;

  const precisePreviousSummary = previousVolumeSummary?.trim() || buildVolumeContinuationSummary(previousVolume);
  const normalizedActualSummary = actualStorySummary?.trim() || '';

  if (!precisePreviousSummary && !normalizedActualSummary) {
    return undefined;
  }

  const parts: string[] = [];

  if (precisePreviousSummary) {
    parts.push(`【上一卷精确结尾】\n${precisePreviousSummary}`);
  }

  if (normalizedActualSummary) {
    parts.push(`【实际剧情摘要（用于校准，不可覆盖精确结尾）】\n${normalizedActualSummary}`);
  }

  const currentVolumeTitle = pickText(currentVolume?.title);
  const currentVolumeGoal = pickText(currentVolume?.goal);
  const currentVolumeConflict = pickText(currentVolume?.conflict);
  if (currentVolumeTitle || currentVolumeGoal || currentVolumeConflict) {
    const currentParts = [
      currentVolumeTitle ? `卷名: ${currentVolumeTitle}` : '',
      currentVolumeGoal ? `开场目标: ${currentVolumeGoal}` : '',
      currentVolumeConflict ? `核心冲突: ${currentVolumeConflict}` : '',
    ].filter(Boolean);
    if (currentParts.length > 0) {
      parts.push(`【当前卷开场任务】\n${currentParts.join('\n')}`);
    }
  }

  const combined = [precisePreviousSummary, normalizedActualSummary].filter(Boolean).join('\n');
  const isTimelineReset = TIMELINE_RESET_PATTERN.test(combined);
  parts.push(`【卷切换强衔接要求】
- 新卷前 ${bridgeChapterCount} 章必须先处理上一卷最后一幕造成的直接后果，再展开新矛盾
- 第 1 章必须把上一卷卷末状态落地到当前场景，至少兑现一个直接后果
${bridgeChapterCount >= 2 ? '- 第 2 章必须继续消化该后果，让代价/新处境发酵后，再打开本卷主线\n' : ''}- 如果精确结尾与滚动摘要冲突，以“上一卷精确结尾”为准`);

  if (isTimelineReset) {
    parts.push('【时间线重置特别规则】\n前两章一律按重置后的世界状态展开，不得直接沿用旧时间线已终结或已被覆盖的主冲突。');
  }

  return parts.join('\n\n');
}
