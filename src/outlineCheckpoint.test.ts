import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateVolumeChapters } from './generateOutline.js';

test('resumes a completed chapter batch without calling the model', async () => {
  const chapters = [1, 2, 3].map(index => ({ index, title: `第${index}章`, goal: '推动故事继续发展', hook: '接下来的选择' }));
  const result = await generateVolumeChapters({ provider: 'openai', model: 'unused', apiKey: 'unused', baseUrl: 'http://127.0.0.1:1' }, {
    bible: '测试设定',
    masterOutline: { mainGoal: '测试目标', milestones: [] },
    volume: { title: '第一卷', startChapter: 1, endChapter: 3, goal: '目标', conflict: '冲突', climax: '高潮' },
    initialChapters: chapters,
  });
  assert.deepEqual(result, chapters);
});
