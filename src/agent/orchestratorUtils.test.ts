import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for orchestrator resilience improvements:
 * - Robust JSON extraction from malformed LLM output
 * - Auto-finish when draft exists and budget exhausted
 */

import {
  extractAgentJSON,
} from './orchestratorUtils.js';

test('extractAgentJSON parses clean JSON', () => {
  const raw = '{"thought":"plan","tool_calls":[{"tool":"write_chapter","args":{}}]}';
  const result = extractAgentJSON(raw);
  assert.ok(result);
  assert.equal(result!.thought, 'plan');
  assert.equal(result!.tool_calls?.length, 1);
});

test('extractAgentJSON extracts JSON from markdown code block', () => {
  const raw = `Here's my reasoning:
\`\`\`json
{"thought":"plan scenes","tool_calls":[{"tool":"finish","args":{"chapter_text":"hello"}}]}
\`\`\`
That's my output.`;
  const result = extractAgentJSON(raw);
  assert.ok(result);
  assert.equal(result!.thought, 'plan scenes');
});

test('extractAgentJSON extracts JSON embedded in prose', () => {
  const raw = `I think we should proceed as follows:
  
{"thought":"generate chapter","tool_calls":[{"tool":"write_chapter","args":{"scene_plan":"test","writing_notes":"test"}}],"confidence":0.9}

This will produce the chapter.`;
  const result = extractAgentJSON(raw);
  assert.ok(result);
  assert.equal(result!.thought, 'generate chapter');
  assert.ok(result!.confidence! >= 0.9);
});

test('extractAgentJSON handles truncated JSON by attempting repair', () => {
  // Sometimes LLM output gets truncated mid-JSON
  const raw = '{"thought":"analyze context","tool_calls":[{"tool":"query_plot_graph","args":{"aspect":"active_plots"}}';
  const result = extractAgentJSON(raw);
  assert.ok(result);
  assert.equal(result!.thought, 'analyze context');
});

test('extractAgentJSON returns null for completely non-JSON output', () => {
  const raw = 'I am going to write a chapter now. Let me think about the plot.';
  const result = extractAgentJSON(raw);
  assert.equal(result, null);
});

test('extractAgentJSON handles nested JSON in tool args without breaking', () => {
  const raw = `{"thought":"finish","tool_calls":[{"tool":"finish","args":{"chapter_text":"第1章 测试\\n正文内容"}}],"confidence":0.85}`;
  const result = extractAgentJSON(raw);
  assert.ok(result);
  assert.equal(result!.tool_calls?.[0].tool, 'finish');
});
