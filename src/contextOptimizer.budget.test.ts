import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOptimizedContext, getContextStats } from './contextOptimizer.js';

const longText = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i + 1}：剧情细节与状态描述`).join('\n');

test('focused context should be significantly shorter while keeping critical sections', () => {
  const bible = longText('世界观设定', 400);
  const rollingSummary = longText('摘要', 300);
  const lastChapters = [longText('上一章', 320), longText('当前上一章', 350)];

  const full = buildOptimizedContext({
    bible,
    rollingSummary,
    lastChapters,
    chapterIndex: 20,
    totalChapters: 100,
    contextMode: 'full',
  });

  const focused = buildOptimizedContext({
    bible,
    rollingSummary,
    lastChapters,
    chapterIndex: 20,
    totalChapters: 100,
    contextMode: 'focused',
    targetContextTokens: 8000,
  });

  const fullStats = getContextStats(full);
  const focusedStats = getContextStats(focused);

  assert.ok(focusedStats.estimatedTokens < fullStats.estimatedTokens);
  assert.ok(focusedStats.estimatedTokens <= 8800);
  assert.match(focused, /【章节信息】/);
  assert.match(focused, /【剧情摘要】/);
  assert.match(focused, /【上一章原文|【上一章原文\(节选\)/);
});
