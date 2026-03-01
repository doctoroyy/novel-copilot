import { DEFAULT_CHAPTER_MEMORY_DIGEST_MAX_CHARS } from './aiModelHelpers.js';

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function clipSegment(text: string, maxChars: number, mode: 'head' | 'middle' | 'tail'): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 6) return clipText(normalized, maxChars);

  if (mode === 'tail') {
    return `...${normalized.slice(-(maxChars - 3)).trimStart()}`;
  }

  if (mode === 'middle') {
    const windowSize = maxChars - 6;
    const start = Math.max(0, Math.floor((normalized.length - windowSize) / 2));
    return `...${normalized.slice(start, start + windowSize).trim()}...`;
  }

  return clipText(normalized, maxChars);
}

function scoreParagraph(paragraph: string): number {
  let score = Math.min(paragraph.length, 240);

  if (/[“”"「」『』]/.test(paragraph)) score += 40;
  if (/[!?！？]/.test(paragraph)) score += 25;
  if (/(忽然|突然|终于|然而|却|原来|发现|决定|不得不|竟然|立刻|马上|随即|与此同时|没想到)/.test(paragraph)) {
    score += 35;
  }

  return score;
}

export function buildChapterMemoryDigest(
  chapterText: string,
  maxChars = DEFAULT_CHAPTER_MEMORY_DIGEST_MAX_CHARS
): string {
  const normalized = normalizeText(chapterText);
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;

  const lines = normalized.split('\n');
  const title = lines[0]?.trim() || '';
  const body = normalizeText(lines.slice(1).join('\n')) || normalized;
  let paragraphs = body
    .split(/\n{2,}/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    paragraphs = body
      .split('\n')
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }

  if (paragraphs.length === 0) {
    return clipText(normalized, maxChars);
  }

  const trailingStart = Math.max(0, paragraphs.length - 3);
  const endIndex = paragraphs
    .map((paragraph, index) => ({
      index,
      score: scoreParagraph(paragraph),
      density: scoreParagraph(paragraph) / Math.max(paragraph.length, 1),
    }))
    .filter((item) => item.index >= trailingStart)
    .sort((a, b) => b.density - a.density || b.score - a.score || b.index - a.index)[0]?.index
    ?? (paragraphs.length - 1);

  const anchorIndices = Array.from(new Set([
    0,
    Math.floor((paragraphs.length - 1) / 2),
    endIndex,
  ]));
  const sections: string[] = [];
  const usedIndices = new Set<number>();

  if (title) {
    sections.push(`【章节标题】\n${title}`);
  }

  const anchorLabels = ['开场片段', '中段片段', '结尾片段'];
  const anchorModes: Array<'head' | 'middle' | 'tail'> = ['head', 'middle', 'tail'];
  anchorIndices.forEach((index, position) => {
    const paragraph = paragraphs[index];
    if (!paragraph) return;
    usedIndices.add(index);
    sections.push(
      `【${anchorLabels[Math.min(position, anchorLabels.length - 1)]}】\n` +
      `${clipSegment(paragraph, 260, anchorModes[Math.min(position, anchorModes.length - 1)])}`
    );
  });

  const extraParagraphs = paragraphs
    .map((paragraph, index) => {
      const score = scoreParagraph(paragraph);
      return {
        paragraph,
        index,
        score,
        density: score / Math.max(paragraph.length, 1),
      };
    })
    .filter((item) => !usedIndices.has(item.index))
    .sort((a, b) => b.density - a.density || b.score - a.score || a.index - b.index)
    .slice(0, 3);

  for (const item of extraParagraphs) {
    sections.push(`【关键片段】\n${clipSegment(item.paragraph, 220, 'head')}`);
  }

  return clipText(sections.join('\n\n'), maxChars);
}
