import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for consistency guardrails embedded in context.
 * These guardrails extract critical continuity facts and embed them
 * as a checklist the LLM must not violate.
 */

import {
  buildConsistencyGuardrails,
  type ConsistencyInput,
} from './consistencyGuardrails.js';

test('buildConsistencyGuardrails produces guardrails from character states', () => {
  const input: ConsistencyInput = {
    characterStates: {
      version: '1.0.0',
      lastUpdatedChapter: 5,
      pendingUpdates: [],
      snapshots: {
        'mc': {
          asOfChapter: 5,
          characterId: 'mc',
          characterName: '李明',
          physical: { location: '京都学院', condition: 'minor_injury', equipment: ['长剑'], abilities: [] },
          psychological: { mood: '紧张', motivation: '找到失踪的妹妹', knownSecrets: [], beliefs: [] },
          social: { publicIdentity: '学院弟子', reputation: '普通', activeAlliances: ['张伟'], activeEnemies: ['黑影组织'] },
          recentChanges: [{ chapter: 5, change: '左臂受伤', field: 'physical.condition', newValue: 'minor_injury' }],
        },
      },
    },
    plotGraph: undefined,
    timeline: undefined,
    lastChapterEnding: '李明握紧了受伤的左臂，目光投向远处黑压压的山脉。',
    chapterIndex: 6,
  };

  const guardrails = buildConsistencyGuardrails(input);

  assert.ok(guardrails.length > 0, 'should produce non-empty guardrails');
  assert.match(guardrails, /李明/);
  assert.match(guardrails, /京都学院|受伤|左臂/);
  assert.match(guardrails, /一致性/i);
});

test('buildConsistencyGuardrails includes pending foreshadowing deadlines', () => {
  const input: ConsistencyInput = {
    characterStates: undefined,
    plotGraph: {
      version: '1.0.0',
      lastUpdatedChapter: 10,
      nodes: [],
      edges: [],
      activeMainPlots: [],
      activeSubPlots: [],
      pendingForeshadowing: [
        {
          id: 'f1',
          summary: '神秘信件的真相',
          suggestedResolutionRange: [8, 12] as [number, number],
          urgency: 'critical' as const,
          ageInChapters: 7,
        },
      ],
    },
    timeline: undefined,
    lastChapterEnding: '',
    chapterIndex: 10,
  };

  const guardrails = buildConsistencyGuardrails(input);

  assert.match(guardrails, /神秘信件/);
  assert.match(guardrails, /紧急|回收|critical/i);
});

test('buildConsistencyGuardrails returns empty for no state data', () => {
  const input: ConsistencyInput = {
    characterStates: undefined,
    plotGraph: undefined,
    timeline: undefined,
    lastChapterEnding: '',
    chapterIndex: 1,
  };

  const guardrails = buildConsistencyGuardrails(input);

  assert.equal(guardrails, '');
});
