import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoreWritingRules, WRITING_RULES_VERSION } from './writingRules.js';

test('buildCoreWritingRules: 包含 CHST + 12 钩子 + 爽点三步法', () => {
  const rules = buildCoreWritingRules({
    chapterIndex: 50,
    totalChapters: 400,
    isFinalChapter: false,
  });
  assert.match(rules, /CHST/);
  assert.match(rules, /危机悬停/);
  assert.match(rules, /信息炸弹/);
  assert.match(rules, /强敌出场/);
  assert.match(rules, /爽点三步法/);
  assert.match(rules, /铺垫压抑/);
  assert.match(rules, /积蓄期待/);
  assert.match(rules, /爆发释放/);
  assert.match(rules, /信息差/);
  assert.match(rules, /弃书红线/);
  assert.match(rules, /严禁.*完结/);
});

test('buildCoreWritingRules: 第1章触发黄金三章规则', () => {
  const rules = buildCoreWritingRules({
    chapterIndex: 1,
    totalChapters: 400,
    isFinalChapter: false,
  });
  assert.match(rules, /黄金三章铁律/);
  assert.match(rules, /第1章/);
  assert.match(rules, /500字内必出冲突/);
  assert.match(rules, /出场角色≤5人/);
});

test('buildCoreWritingRules: 第3章要求完成首个爽点循环', () => {
  const rules = buildCoreWritingRules({
    chapterIndex: 3,
    totalChapters: 400,
    isFinalChapter: false,
  });
  assert.match(rules, /第3章/);
  assert.match(rules, /首个完整爽点循环/);
});

test('buildCoreWritingRules: 第4章起不再提黄金三章', () => {
  const rules = buildCoreWritingRules({
    chapterIndex: 4,
    totalChapters: 400,
    isFinalChapter: false,
  });
  assert.doesNotMatch(rules, /黄金三章铁律/);
});

test('buildCoreWritingRules: 最终章允许收束', () => {
  const rules = buildCoreWritingRules({
    chapterIndex: 400,
    totalChapters: 400,
    isFinalChapter: true,
  });
  assert.match(rules, /最终章/);
  assert.doesNotMatch(rules, /严禁.*完结/);
});

test('buildCoreWritingRules: narrativeType 注入对应节奏菜谱', () => {
  const rules = buildCoreWritingRules({
    chapterIndex: 20,
    totalChapters: 400,
    isFinalChapter: false,
    narrativeType: 'action',
    pacingTarget: 9,
  });
  assert.match(rules, /动作\/战斗章/);
  assert.match(rules, /9\/10/);
  assert.match(rules, /极高强度/);
});

test('buildCoreWritingRules: isArcOpening 且非黄金三章 → 新弧起点规则', () => {
  const rules = buildCoreWritingRules({
    chapterIndex: 51,
    totalChapters: 400,
    isFinalChapter: false,
    isArcOpening: true,
  });
  assert.match(rules, /新弧起点规则/);
  assert.match(rules, /前 300 字快速切入新冲突/);
});

test('WRITING_RULES_VERSION 存在（防止静默回退）', () => {
  assert.ok(WRITING_RULES_VERSION);
  assert.equal(typeof WRITING_RULES_VERSION, 'string');
});
