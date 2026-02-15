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

export function normalizeGeneratedChapterText(rawResponse: string, chapterIndex: number): string {
  const parsed = extractJsonObject(rawResponse);
  if (parsed && typeof parsed.content === 'string') {
    const safeTitle = typeof parsed.title === 'string' && parsed.title.trim().length > 0
      ? parsed.title.trim()
      : `第${chapterIndex}章`;
    const finalTitle = safeTitle.startsWith('第') ? safeTitle : `第${chapterIndex}章 ${safeTitle}`;
    return `${finalTitle}\n\n${parsed.content.trim()}`;
  }

  const cleaned = stripCodeFence(rawResponse);
  if (looksLikeJsonChapterPayload(cleaned)) {
    throw new Error(`AI 返回了无效的 JSON 章节结构（第 ${chapterIndex} 章）`);
  }

  return cleaned;
}
