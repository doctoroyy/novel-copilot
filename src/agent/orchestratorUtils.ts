/**
 * Orchestrator utility functions — robust JSON extraction from LLM output.
 */

export type AgentJSONPayload = {
  thought: string;
  tool_calls?: { tool: string; args: Record<string, any> }[];
  final_output?: string;
  confidence?: number;
  phase?: string;
};

/**
 * Robustly extract an AgentTurn-like JSON object from potentially malformed LLM output.
 * Tries multiple strategies:
 * 1. Direct parse
 * 2. Extract from markdown code block
 * 3. Find first { ... } span
 * 4. Repair truncated JSON by closing brackets
 */
export function extractAgentJSON(raw: string): AgentJSONPayload | null {
  if (!raw || raw.trim().length === 0) return null;

  // Strategy 1: direct parse
  const direct = tryParse(raw.trim());
  if (direct) return direct;

  // Strategy 2: markdown code block
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    const inner = tryParse(codeBlockMatch[1].trim());
    if (inner) return inner;
  }

  // Strategy 3: extract first { ... } span (greedy innermost valid JSON)
  const firstBrace = raw.indexOf('{');
  if (firstBrace === -1) return null;

  const lastBrace = raw.lastIndexOf('}');
  if (lastBrace > firstBrace) {
    const candidate = raw.slice(firstBrace, lastBrace + 1);
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
  }

  // Strategy 4: repair truncated JSON — find opening { and try closing
  const fromBrace = raw.slice(firstBrace);
  const repaired = repairTruncatedJSON(fromBrace);
  if (repaired) {
    const parsed = tryParse(repaired);
    if (parsed) return parsed;
  }

  return null;
}

function tryParse(text: string): AgentJSONPayload | null {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && typeof obj.thought === 'string') {
      return obj as AgentJSONPayload;
    }
    return null;
  } catch {
    return null;
  }
}

function repairTruncatedJSON(text: string): string | null {
  // Count unmatched braces/brackets
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of text) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }

  if (braces <= 0 && brackets <= 0) return null;

  // Close open strings if needed
  let repaired = text;
  if (inString) repaired += '"';

  // Close brackets then braces
  while (brackets > 0) {
    repaired += ']';
    brackets--;
  }
  while (braces > 0) {
    repaired += '}';
    braces--;
  }

  return repaired;
}
