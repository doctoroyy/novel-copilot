/**
 * Native agent chapter engine smoke test (no real LLM).
 * Stubs OpenAIDirectAdapter.chat to immediately submit_proposal.
 */
import assert from 'node:assert/strict';
import { writeChapterWithAgent } from './agent/agentChapterEngine.js';
import { OpenAIDirectAdapter } from './agent/adapters/OpenAIDirectAdapter.js';
import type { AdapterResponse, AgentMessage, ToolDefinition } from './agent/adapters/types.js';
import type { EnhancedWriteChapterParams } from './enhancedChapterEngine.js';

const proposalText =
  '这是测试生成的章节内容。确保至少有 50 个字。测试测试测试测试测试测试测试测试测试测试测试测试测试测试测试测试测试测试测试测试测试测试测试测试。';

const proposalArgs = {
  scene_plan: [
    { purpose: '开场', conflict: '冲突', new_info: '信息' },
  ],
  chapter_text: proposalText,
  review_notes: 'mock proposal',
};

async function fakeChat(
  _systemPrompt: string,
  _messages: AgentMessage[],
  _tools: ToolDefinition[],
): Promise<AdapterResponse> {
  return {
    message: {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        tool_use_id: 'call_submit',
        name: 'submit_proposal',
        input: proposalArgs,
      }],
    },
    toolCalls: [{
      id: 'call_submit',
      name: 'submit_proposal',
      arguments: proposalArgs,
    }],
    usage: { inputTokens: 12, outputTokens: 34, cacheHitTokens: 0 },
  };
}

async function run() {
  console.log('Starting native agent integration smoke test...');

  const originalChat = OpenAIDirectAdapter.prototype.chat;
  OpenAIDirectAdapter.prototype.chat = fakeChat;

  try {
    const params: EnhancedWriteChapterParams = {
      aiConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'fake-key' },
      bible: 'This is the story bible.',
      rollingSummary: 'Summary of past chapters.',
      openLoops: ['Who is the villain?'],
      lastChapters: ['Chapter 1 text'],
      chapterIndex: 2,
      totalChapters: 10,
      skipStateUpdate: true,
      skipSummaryUpdate: true,
      agentMaxTurns: 2,
    };

    const result = await writeChapterWithAgent(params);
    assert.ok(result.chapterText.includes('这是测试生成的章节内容'));
    assert.ok(result.generationDurationMs >= 0);
    console.log('Integration test passed successfully!');
  } finally {
    OpenAIDirectAdapter.prototype.chat = originalChat;
  }
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
