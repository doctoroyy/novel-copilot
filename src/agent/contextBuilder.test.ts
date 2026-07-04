import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContextPackage, serializeContextPackage } from './contextBuilder.js';

test('ContextBuilder creates a slim package within token budget', () => {
  const pkg = buildContextPackage({
    taskId: 'task-123',
    projectId: 'proj-456',
    chapterIndex: 42,
    rollingSummary: 'This is a short summary of the last 3 chapters.',
    currentBlueprint: 'The protagonist finds a hidden artifact.',
    writingStyleRules: 'Keep it concise and suspenseful.',
    totalChapters: 41,
  });

  const serialized = serializeContextPackage(pkg);
  
  // A rough token estimate: 1 char ~= 0.5 tokens for English/Chinese mix, 
  // but we can just assert string length is well within limits (e.g. < 3000 chars for a ~1500 token budget)
  assert.ok(serialized.length < 3000, 'Serialized context should be slim');
  assert.match(serialized, /Task ID: task-123/);
  assert.match(serialized, /Target Chapter: 42/);
  assert.match(serialized, /This is a short summary/);
  assert.match(serialized, /The protagonist finds a hidden artifact/);
  assert.match(serialized, /Keep it concise/);
  assert.match(serialized, /1 - 41/); // Chapters available
});
