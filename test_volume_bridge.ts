import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChapterOutline, VolumeOutline } from './src/generateOutline.js';
import { applyVolumeOpeningBridgeContracts } from './src/generateOutline.js';
import {
  buildVolumeBridgeContext,
  isVolumeBridgeChapter,
  VOLUME_BRIDGE_CHAPTER_COUNT,
} from './src/utils/volumeBridge.js';

const nextVolume: Omit<VolumeOutline, 'chapters'> = {
  title: '第二卷：皇都风云',
  startChapter: 81,
  endChapter: 160,
  goal: '主角带着新身份进入皇都，先站稳脚跟，再卷入皇权暗流',
  conflict: '旧敌尾巴未断，新权贵势力开始试探主角底线',
  climax: '皇都夜宴上身份曝光，主角被迫公开撕破脸',
  volumeEndState: '主角在皇都立足，但彻底卷入更高层棋局',
};

test('buildVolumeBridgeContext keeps exact ending and actual summary together', () => {
  const bridgeContext = buildVolumeBridgeContext({
    previousVolumeSummary: '卷末状态: 主角重伤离开林家，带着新地位与旧仇进入皇都。',
    actualStorySummary: '滚动摘要: 主角刚结束林家大战，伤势未愈，外部追兵未散。',
    currentVolume: nextVolume,
    bridgeChapterCount: VOLUME_BRIDGE_CHAPTER_COUNT,
  });

  assert.ok(bridgeContext);
  assert.match(bridgeContext!, /上一卷精确结尾/);
  assert.match(bridgeContext!, /实际剧情摘要/);
  assert.match(bridgeContext!, new RegExp(`新卷前 ${VOLUME_BRIDGE_CHAPTER_COUNT} 章`));
});

test('isVolumeBridgeChapter only marks the opening two chapters', () => {
  assert.equal(isVolumeBridgeChapter(81, 81, VOLUME_BRIDGE_CHAPTER_COUNT), true);
  assert.equal(isVolumeBridgeChapter(82, 81, VOLUME_BRIDGE_CHAPTER_COUNT), true);
  assert.equal(isVolumeBridgeChapter(83, 81, VOLUME_BRIDGE_CHAPTER_COUNT), false);
});

test('applyVolumeOpeningBridgeContracts injects bridge contract into the first two chapters', () => {
  const chapters: ChapterOutline[] = [
    {
      index: 81,
      title: '血月下的抉择',
      goal: '主角踏入皇都，准备接触新的势力。',
      hook: '城门外的暗哨认出了他的来历。',
    },
    {
      index: 82,
      title: '旧伤与新局',
      goal: '主角在落脚点处理伤势，摸清皇都局面。',
      hook: '旧敌的探子已经先一步潜入客栈。',
    },
    {
      index: 83,
      title: '暗流初现',
      goal: '主角正式接触皇都权贵，打开本卷主线。',
      hook: '宴会请帖背后藏着真正的试探。',
    },
  ];

  const patched = applyVolumeOpeningBridgeContracts(chapters, {
    volume: nextVolume,
    previousVolumeSummary: '卷末状态: 主角重伤离开林家，旧敌未散。',
    actualStorySummary: '滚动摘要: 主角刚结束林家大战，外部追兵仍在。',
    bridgeChapterCount: VOLUME_BRIDGE_CHAPTER_COUNT,
  });

  assert.equal(patched[0].storyContract?.crisis?.requiredBridge, true);
  assert.deepEqual(patched[0].storyContract?.threads?.mustAdvance, [
    '承接上一卷结局带来的直接后果',
  ]);
  assert.match((patched[0].storyContract?.notes || []).join('\n'), /桥接段/);

  assert.equal(patched[1].storyContract?.crisis?.requiredBridge, true);
  assert.deepEqual(patched[1].storyContract?.threads?.mustAdvance, [
    '延续上一卷余波并完成卷切换过渡',
  ]);

  assert.equal(patched[2].storyContract, undefined);
});
