import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for fast-path single-pass generation that skips the ReAct agent loop
 * for low-complexity chapters. This is the biggest speed optimization.
 */

// We test the exported function that decides routing
import {
  shouldUseFastPath,
  type FastPathInput,
} from './adaptivePolicy.js';

test('shouldUseFastPath returns true for low complexity with no special requirements', () => {
  const input: FastPathInput = {
    complexityLevel: 'low',
    hasPlotGraph: false,
    hasPendingCriticalForeshadowing: false,
    agentMaxTurnsOverride: undefined,
  };
  assert.equal(shouldUseFastPath(input), true);
});

test('shouldUseFastPath returns false for medium complexity', () => {
  const input: FastPathInput = {
    complexityLevel: 'medium',
    hasPlotGraph: true,
    hasPendingCriticalForeshadowing: false,
    agentMaxTurnsOverride: undefined,
  };
  assert.equal(shouldUseFastPath(input), false);
});

test('shouldUseFastPath returns false for high complexity', () => {
  const input: FastPathInput = {
    complexityLevel: 'high',
    hasPlotGraph: true,
    hasPendingCriticalForeshadowing: true,
    agentMaxTurnsOverride: undefined,
  };
  assert.equal(shouldUseFastPath(input), false);
});

test('shouldUseFastPath returns false when user explicitly sets agent turns', () => {
  const input: FastPathInput = {
    complexityLevel: 'low',
    hasPlotGraph: false,
    hasPendingCriticalForeshadowing: false,
    agentMaxTurnsOverride: 5,
  };
  assert.equal(shouldUseFastPath(input), false);
});

test('shouldUseFastPath returns false for low complexity with critical foreshadowing', () => {
  const input: FastPathInput = {
    complexityLevel: 'low',
    hasPlotGraph: true,
    hasPendingCriticalForeshadowing: true,
    agentMaxTurnsOverride: undefined,
  };
  assert.equal(shouldUseFastPath(input), false);
});
