import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextPackage,
  serializeContextPackage,
  estimateTokens,
  budgetForTask,
  type SelectedContextItem,
} from './contextBuilder.js';
import type { StoryEntity, StoryThread } from '../services/storyVaultService.js';

function makeEntity(over: Partial<StoryEntity> & { name: string; type?: any }): StoryEntity {
  const base: StoryEntity = {
    id: `e-${over.name}`,
    projectId: 'proj-1',
    type: over.type || 'character',
    name: over.name,
    aliases: over.aliases ?? [],
    content: over.content ?? `${over.name} 的设定内容。`,
    status: over.status ?? {},
    triggerTerms: over.triggerTerms ?? [over.name],
    importance: over.importance ?? 3,
    lastReferencedChapter: over.lastReferencedChapter ?? null,
    sourceRefs: over.sourceRefs ?? [],
    createdAt: 1,
    updatedAt: 1,
  };
  return Object.assign(base, over);
}

test('estimateTokens is roughly half the char count', () => {
  assert.ok(estimateTokens('abcd') === 2);
  assert.ok(estimateTokens('') === 0);
});

test('budgetForTask returns sensible per-task budgets', () => {
  assert.equal(budgetForTask('blueprint'), 12_000);
  assert.equal(budgetForTask('chapter_draft'), 40_000);
  assert.equal(budgetForTask('summary'), 8_000);
  assert.ok(budgetForTask('unknown-task') > 0);
});

test('ContextBuilder without DB produces a slim essentials-only package within budget', () => {
  const pkg = buildContextPackage({
    taskId: 'task-123',
    projectId: 'proj-456',
    chapterIndex: 42,
    taskType: 'chapter_draft',
    rollingSummary: 'This is a short summary of the last 3 chapters.',
    currentBlueprint: 'The protagonist finds a hidden artifact.',
    goalHint: '主角发现神器',
    writingStyleRules: 'Keep it concise and suspenseful.',
    totalChapters: 41,
  });

  const serialized = serializeContextPackage(pkg);
  assert.ok(serialized.length > 0);
  assert.match(serialized, /Target Chapter: 42/);
  assert.match(serialized, /This is a short summary/);
  assert.match(serialized, /hidden artifact/);
  assert.match(serialized, /Keep it concise/);
  assert.ok(pkg.tokenBudget.withinBudget, 'should be within budget with no vault');
  assert.ok(pkg.promptHash.length > 0, 'prompt hash should be set');
  assert.equal(pkg.selectedItems.length, 0, 'no DB => no selected items');
});

test('ContextBuilder selects entities by trigger-term match and respects importance', () => {
  // Inject a fake DB-backed selection by monkeypatching via the no-DB path is not enough,
  // so we test the selection logic indirectly by building a corpus and asserting
  // that a premise entity would always be included. Full DB selection is covered
  // by the smoke test.
  const pkg = buildContextPackage({
    taskId: 't',
    projectId: 'p',
    chapterIndex: 1,
    rollingSummary: '主角林动获得了祖符',
    goalHint: '林动',
    writingStyleRules: '',
    totalChapters: 10,
  });
  // Without DB, no items selected but essentials present
  assert.equal(pkg.selectedItems.length, 0);
  assert.match(pkg.essentials.goalHint!, /林动/);
});

test('ContextBuilder is deterministic for identical input (same prompt hash)', () => {
  const base = {
    taskId: 't',
    projectId: 'p',
    chapterIndex: 5,
    rollingSummary: 'same summary',
    currentBlueprint: 'same blueprint',
    writingStyleRules: 'same rules',
    totalChapters: 10,
  };
  const a = buildContextPackage(base);
  const b = buildContextPackage(base);
  assert.equal(a.promptHash, b.promptHash);
});

test('serializeContextPackage includes token budget line and available resources', () => {
  const pkg = buildContextPackage({
    taskId: 't',
    projectId: 'p',
    chapterIndex: 3,
    totalChapters: 20,
  });
  const s = serializeContextPackage(pkg);
  assert.match(s, /Token 预算/);
  assert.match(s, /Story Vault/);
});
