import { z } from 'zod';

export type RollingSummaryMemory = {
  longTerm: string;
  midTerm: string;
  recent: string;
};

const headingMap: Record<string, keyof RollingSummaryMemory> = {
  长期记忆: 'longTerm',
  中期记忆: 'midTerm',
  近期记忆: 'recent',
};

const SummaryUpdateSchema = z.object({
  longTermMemory: z.string().min(8).optional(),
  midTermMemory: z.string().min(8).optional(),
  recentMemory: z.string().min(8).optional(),
  rollingSummary: z.string().min(8).optional(),
  openLoops: z.array(z.string()).max(12).optional(),
});

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function splitSentences(text: string): string[] {
  const chunks = text.split(/([。！？!?；;])/);
  const out: string[] = [];
  for (let i = 0; i < chunks.length; i += 2) {
    const body = (chunks[i] || '').trim();
    const punct = (chunks[i + 1] || '').trim();
    const sentence = `${body}${punct}`.trim();
    if (sentence) {
      out.push(sentence);
    }
  }
  if (out.length === 0 && text.trim()) {
    out.push(text.trim());
  }
  return out;
}

function truncateBySentences(text: string, maxChars: number, keepTail = false): string {
  const normalized = normalize(text);
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;

  const sentences = splitSentences(normalized);
  const ordered = keepTail ? [...sentences].reverse() : sentences;
  const selected: string[] = [];
  let total = 0;

  for (const sentence of ordered) {
    const next = total + sentence.length;
    if (next > maxChars) break;
    selected.push(sentence);
    total = next;
  }

  if (selected.length === 0) {
    return keepTail ? normalized.slice(-maxChars) : normalized.slice(0, maxChars);
  }

  const merged = (keepTail ? selected.reverse() : selected).join('');
  return normalize(merged);
}

function fallbackSplitLegacySummary(summary: string): RollingSummaryMemory {
  const normalized = normalize(summary);
  if (!normalized) {
    return { longTerm: '', midTerm: '', recent: '' };
  }

  const recentChars = 500;
  const midChars = 380;

  const recent = normalized.slice(Math.max(0, normalized.length - recentChars));
  const beforeRecent = normalized.slice(0, Math.max(0, normalized.length - recentChars));
  const midTerm = beforeRecent.slice(Math.max(0, beforeRecent.length - midChars));
  const longTerm = beforeRecent.slice(0, Math.max(0, beforeRecent.length - midChars));

  return {
    longTerm: normalize(longTerm),
    midTerm: normalize(midTerm),
    recent: normalize(recent),
  };
}

export function parseRollingSummaryMemory(summary: string): RollingSummaryMemory {
  const normalized = normalize(summary);
  if (!normalized) {
    return { longTerm: '', midTerm: '', recent: '' };
  }

  const headingRegex = /【(长期记忆|中期记忆|近期记忆)】/g;
  const matches = Array.from(normalized.matchAll(headingRegex));
  if (matches.length === 0) {
    return fallbackSplitLegacySummary(normalized);
  }

  const parsed: RollingSummaryMemory = { longTerm: '', midTerm: '', recent: '' };

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const headingText = current[1];
    const target = headingMap[headingText];
    if (!target || current.index === undefined) continue;

    const contentStart = current.index + current[0].length;
    const contentEnd = next?.index ?? normalized.length;
    const section = normalized.slice(contentStart, contentEnd);
    parsed[target] = normalize(section);
  }

  if (!parsed.longTerm && !parsed.midTerm && !parsed.recent) {
    return fallbackSplitLegacySummary(normalized);
  }

  return parsed;
}

export function formatRollingSummaryMemory(memory: RollingSummaryMemory): string {
  const parts: string[] = [];
  if (memory.longTerm) {
    parts.push(`【长期记忆】\n${normalize(memory.longTerm)}`);
  }
  if (memory.midTerm) {
    parts.push(`【中期记忆】\n${normalize(memory.midTerm)}`);
  }
  if (memory.recent) {
    parts.push(`【近期记忆】\n${normalize(memory.recent)}`);
  }
  return parts.join('\n\n').trim();
}

export function normalizeRollingSummary(summary: string): string {
  return formatRollingSummaryMemory(parseRollingSummaryMemory(summary));
}

export function compressRollingSummaryRecency(summary: string, maxTokens = 900): string {
  const maxChars = Math.max(240, Math.floor(maxTokens * 2));
  if (!summary) return '';

  const memory = parseRollingSummaryMemory(summary);
  const longBudget = Math.floor(maxChars * 0.2);
  const midBudget = Math.floor(maxChars * 0.3);
  const recentBudget = Math.max(80, maxChars - longBudget - midBudget);

  const compressed: RollingSummaryMemory = {
    longTerm: truncateBySentences(memory.longTerm, longBudget, false),
    midTerm: truncateBySentences(memory.midTerm, midBudget, true),
    recent: truncateBySentences(memory.recent, recentBudget, true),
  };

  return formatRollingSummaryMemory(compressed);
}

export function parseSummaryUpdateResponse(
  rawResponse: string,
  previousSummary: string,
  previousOpenLoops: string[]
): { updatedSummary: string; updatedOpenLoops: string[] } {
  const jsonText = rawResponse.replace(/```json\s*|```\s*/g, '').trim();

  try {
    const parsed = SummaryUpdateSchema.parse(JSON.parse(jsonText));
    const loops = parsed.openLoops?.length ? parsed.openLoops : previousOpenLoops;

    // 新协议：分层记忆字段
    if (parsed.longTermMemory || parsed.midTermMemory || parsed.recentMemory) {
      const memory: RollingSummaryMemory = {
        longTerm: normalize(parsed.longTermMemory || ''),
        midTerm: normalize(parsed.midTermMemory || ''),
        recent: normalize(parsed.recentMemory || ''),
      };
      const summary = formatRollingSummaryMemory(memory);
      if (summary) {
        return {
          updatedSummary: summary,
          updatedOpenLoops: loops,
        };
      }
    }

    // 兼容旧协议：rollingSummary 单字段
    if (parsed.rollingSummary) {
      return {
        updatedSummary: normalizeRollingSummary(parsed.rollingSummary),
        updatedOpenLoops: loops,
      };
    }
  } catch {
    // ignore and fallback
  }

  return {
    updatedSummary: previousSummary,
    updatedOpenLoops: previousOpenLoops,
  };
}

