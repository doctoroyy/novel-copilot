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

test('resumes only the missing batch with the saved chapters as context', async () => {
  const { createServer } = await import('node:http');
  let requests = 0;
  let prompt = '';
  const server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', chunk => parts.push(chunk));
    req.on('end', () => {
      requests += 1;
      const body = JSON.parse(Buffer.concat(parts).toString());
      prompt = JSON.stringify(body.messages);
      const content = Array.from({ length: 15 }, (_, i) => `${i + 16}|新章节${i + 16}|主角找到线索并向目标前进|敌人逐渐逼近`).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      res.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    const saved = Array.from({ length: 15 }, (_, i) => ({ index: i + 1, title: `已保存${i + 1}`, goal: '主角寻找关键信息并准备下一步行动', hook: '危机正在靠近' }));
    const checkpoints: number[] = [];
    const result = await generateVolumeChapters({ provider: 'openai', model: 'test', apiKey: 'test', baseUrl: `http://127.0.0.1:${address.port}/v1` }, {
      bible: '测试设定', masterOutline: { mainGoal: '测试目标', milestones: [] },
      volume: { title: '第一卷', startChapter: 1, endChapter: 30, goal: '目标', conflict: '冲突', climax: '高潮' },
      initialChapters: saved, previousVolumes: Array.from({ length: 3 }, (_, v) => ({ title: `旧卷${v + 1}`, startChapter: v * 80 + 1, endChapter: (v + 1) * 80, goal: '卷目标', conflict: '冲突', climax: '高潮', chapters: Array.from({ length: 80 }, (_, i) => ({ index: v * 80 + i + 1, title: `旧章${v}-${i}`, goal: '剧情推进'.repeat(120), hook: '悬念' })) })), onBatchComplete: chapters => { checkpoints.push(chapters.length); },
    });
    assert.equal(requests, 1);
    assert.match(prompt, /已保存15/);
    assert.match(prompt, /旧卷3/);
    assert.match(prompt, /旧章0-0/);
    assert.match(prompt, /旧章2-79/);
    assert.ok(prompt.length < 30000, `上下文过长: ${prompt.length}`);
    assert.deepEqual(checkpoints, [30]);
    assert.equal(result.length, 30);
    assert.equal(result[0].title, '已保存1');
    assert.equal(result[29].index, 30);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('does not silently replace missing generated chapters with placeholders', async () => {
  const { createServer } = await import('node:http');
  let requests = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      requests++;
      const content = Array.from({ length: 8 }, (_, i) => `${i + 1}|有效标题${i + 1}|主角找到线索并向目标前进|敌人逐渐逼近`).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created:0, model: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      res.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    await assert.rejects(generateVolumeChapters({ provider: 'openai', model: 'test', apiKey: 'test', baseUrl: `http://127.0.0.1:${address.port}/v1` }, {
      bible: '测试设定', masterOutline: { mainGoal: '测试目标', milestones: [] },
      volume: { title: '第一卷', startChapter: 1, endChapter: 15, goal: '目标', conflict: '冲突', climax: '高潮' },
    }), /expected 15/);
    assert.equal(requests, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});

test('rejects a full-sized JSON batch with missing descriptions or wrong chapter numbers', async () => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const content = JSON.stringify([{ index: 1, title: '标题一', goal: '主角寻找重要线索', hook: '悬念' }, { index: 1, title: '标题二', goal: '', hook: '悬念' }]);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      res.end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not start');
    await assert.rejects(generateVolumeChapters({ provider: 'openai', model: 'test', apiKey: 'test', baseUrl: `http://127.0.0.1:${address.port}/v1` }, {
      bible: '测试设定', masterOutline: { mainGoal: '测试目标', milestones: [] },
      volume: { title: '第一卷', startChapter: 1, endChapter: 2, goal: '目标', conflict: '冲突', climax: '高潮' },
    }), /batch/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
