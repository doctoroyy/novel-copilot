import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessChapterComplexity,
  deriveAgentExecutionPlan,
  type ChapterComplexityInput,
} from './adaptivePolicy.js';

test('assessChapterComplexity returns high for transition-heavy and unresolved chapters', () => {
  const input: ChapterComplexityInput = {
    chapterIndex: 58,
    totalChapters: 60,
    openLoopsCount: 14,
    hasNarrativeArc: true,
    hasEnhancedOutline: true,
    timelineEventCount: 120,
    previousChapterLength: 8200,
    hasBridgeGoalHint: true,
  };

  const result = assessChapterComplexity(input);

  assert.equal(result.level, 'high');
  assert.ok(result.score >= 70);
});

test('deriveAgentExecutionPlan favors speed for simple chapters', () => {
  const input: ChapterComplexityInput = {
    chapterIndex: 3,
    totalChapters: 80,
    openLoopsCount: 1,
    hasNarrativeArc: false,
    hasEnhancedOutline: false,
    timelineEventCount: 0,
    previousChapterLength: 2200,
    hasBridgeGoalHint: false,
  };

  const plan = deriveAgentExecutionPlan(input, { minChapterWords: 2200 });

  assert.equal(plan.complexity.level, 'low');
  assert.equal(plan.agent.maxTurns, 3);
  assert.equal(plan.agent.maxAICalls, 4);
  assert.equal(plan.context.mode, 'focused');
  assert.ok(plan.context.targetTokens <= 9000);
});

test('deriveAgentExecutionPlan preserves quality guardrails for high complexity chapters', () => {
  const input: ChapterComplexityInput = {
    chapterIndex: 45,
    totalChapters: 50,
    openLoopsCount: 10,
    hasNarrativeArc: true,
    hasEnhancedOutline: true,
    timelineEventCount: 80,
    previousChapterLength: 6500,
    hasBridgeGoalHint: true,
  };

  const plan = deriveAgentExecutionPlan(input, { minChapterWords: 3500 });

  assert.equal(plan.complexity.level, 'high');
  assert.ok(plan.agent.maxTurns >= 5);
  assert.ok(plan.agent.maxAICalls >= 8);
  assert.equal(plan.context.mode, 'balanced');
  assert.ok(plan.context.targetTokens >= 12000);
});
