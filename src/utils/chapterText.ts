function stripCodeFence(text: string): string {
  return text.replace(/```json\s*|```\s*/gi, '').trim();
}

function tryParseJsonCandidate(candidate: string): any | null {
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      // Best-effort fix for trailing commas.
      const fixed = candidate.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}

function extractJsonObject(raw: string): any | null {
  const cleaned = stripCodeFence(raw);
  const candidates = [cleaned];

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    const parsed = tryParseJsonCandidate(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function looksLikeJsonChapterPayload(text: string): boolean {
  const cleaned = stripCodeFence(text);
  if (!(cleaned.startsWith('{') || cleaned.startsWith('['))) return false;
  return /"content"\s*:/.test(cleaned) && /"title"\s*:/.test(cleaned);
}

function normalizeTitle(title: string, chapterIndex: number): string {
  const cleaned = title.replace(/^#+\s*/, '').trim();
  if (!cleaned) return `第${chapterIndex}章`;
  if (/^第[一二三四五六七八九十百千万零两\d]+[章节回]/.test(cleaned)) {
    return cleaned;
  }
  return `第${chapterIndex}章 ${cleaned}`;
}

function extractPlainTextTitleAndBody(raw: string, chapterIndex: number): { title: string; content: string } | null {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) return null;

  const lines = normalized.split('\n');
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLineIndex < 0) return null;

  const candidateTitleIndex = (() => {
    for (let i = firstContentLineIndex; i < Math.min(lines.length, firstContentLineIndex + 4); i++) {
      const line = lines[i].replace(/^#+\s*/, '').trim();
      if (!line) continue;
      if (/^第[一二三四五六七八九十百千万零两\d]+[章节回]/.test(line)) {
        return i;
      }
      if (/^(标题|题目)\s*[:：]/.test(line)) {
        return i;
      }
    }
    return -1;
  })();

  if (candidateTitleIndex < 0) return null;

  const rawTitle = lines[candidateTitleIndex]
    .replace(/^#+\s*/, '')
    .replace(/^(标题|题目)\s*[:：]\s*/, '')
    .trim();
  const title = normalizeTitle(rawTitle, chapterIndex);

  const body = lines
    .slice(candidateTitleIndex + 1)
    .join('\n')
    .trim();

  return { title, content: body };
}

/**
 * 清理 AI 生成的元说明文本，如【本章结尾悬念】、【章节目标完成提示】等。
 * 这些文字不是小说正文，而是 AI 的自我注释。
 */
function stripTrailingMeta(text: string): string {
  // 从末尾向前查找元说明块（以【...】开头的行）
  const lines = text.split('\n');
  let cutIndex = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue; // 跳过空行
    if (/^【.{2,}】/.test(trimmed)) {
      cutIndex = i;
    } else {
      break; // 遇到正常正文行就停止
    }
  }
  if (cutIndex < lines.length) {
    return lines.slice(0, cutIndex).join('\n').trimEnd();
  }
  return text;
}

/**
 * 清理 AI 输出末尾的统计文本和收尾标记。
 * 例如：「（本章完，共计2856字）」「（全文共计xxx字）」「---\n字数统计」等。
 */
function stripTrailingStats(text: string): string {
  return text
    // 匹配末尾的「（本章完...）」「（全文共...）」「（完）」「（以上为...）」等
    .replace(/\n*[（\(]\s*(本章完|全文共[计]?|以上为|完|字数[：:]?|共计|本章共)\s*[^）\)]*[）\)]\s*$/i, '')
    // 匹配末尾的 --- 分隔线后的统计信息
    .replace(/\n+-{3,}\s*\n+.*?(字数|共计|统计|总计|本章完).*$/s, '')
    // 匹配末尾单独的「本章完」「全文完」等行
    .replace(/\n+\s*(本章完|全文完|本卷完|完)\s*[。.]?\s*$/, '')
    .trimEnd();
}

export function normalizeGeneratedChapterText(rawResponse: string, chapterIndex: number): string {
  const parsed = extractJsonObject(rawResponse);
  if (parsed && typeof parsed.content === 'string') {
    const finalTitle = normalizeTitle(
      typeof parsed.title === 'string' ? parsed.title : '',
      chapterIndex
    );
    return stripTrailingStats(stripTrailingMeta(`${finalTitle}\n\n${parsed.content.trim()}`));
  }

  const cleaned = stripCodeFence(rawResponse);
  const plain = extractPlainTextTitleAndBody(cleaned, chapterIndex);
  if (plain) {
    return stripTrailingStats(stripTrailingMeta(`${plain.title}\n\n${plain.content}`.trim()));
  }

  return stripTrailingStats(stripTrailingMeta(cleaned));
}
