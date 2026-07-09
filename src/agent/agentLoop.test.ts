import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop, type ToolExecutor } from './agentLoop.js';
import type { AgentRuntimeAdapter, AdapterResponse, AgentMessage, ToolDefinition } from './adapters/types.js';

class MockAdapter implements AgentRuntimeAdapter {
  provider = 'mock';
  model = 'mock-model';
  
  public responses: AdapterResponse[] = [];
  public callCount = 0;

  async chat(systemPrompt: string, messages: AgentMessage[], tools: ToolDefinition[]): Promise<AdapterResponse> {
    const res = this.responses[this.callCount];
    if (!res) {
      throw new Error(`Mock adapter ran out of responses at call ${this.callCount}`);
    }
    this.callCount++;
    return res;
  }
}

test('agentLoop handles tool execution and termination', async () => {
  const adapter = new MockAdapter();
  
  adapter.responses = [
    {
      message: { role: 'assistant', content: [{ type: 'tool_use', tool_use_id: 'call_1', name: 'read_chapter', input: { chapter_index: 1 } }] },
      toolCalls: [{ id: 'call_1', name: 'read_chapter', arguments: { chapter_index: 1 } }],
      usage: { inputTokens: 10, outputTokens: 5 }
    },
    {
      message: { role: 'assistant', content: [{ type: 'tool_use', tool_use_id: 'call_2', name: 'submit_proposal', input: { chapter_text: 'draft' } }] },
      toolCalls: [{ id: 'call_2', name: 'submit_proposal', arguments: { chapter_text: 'draft' } }],
      usage: { inputTokens: 20, outputTokens: 10, cacheHitTokens: 100 }
    }
  ];

  const executor = mock.fn(async (name: string, args: any) => {
    if (name === 'read_chapter') {
      return 'Chapter 1 text here';
    }
    return 'Unknown';
  }) as ToolExecutor;

  const result = await runAgentLoop({
    adapter,
    systemPrompt: 'System',
    executor,
    maxIterations: 5
  });

  assert.strictEqual(result.status, 'completed');
  assert.deepEqual(result.proposal, { chapter_text: 'draft' });
  
  // Usage should be accumulated
  assert.strictEqual(result.usage.inputTokens, 30);
  assert.strictEqual(result.usage.outputTokens, 15);
  assert.strictEqual(result.usage.cacheHitTokens, 100);

  // Executor should have been called once for read_chapter
  const executorMock = executor as any;
  assert.strictEqual(executorMock.mock.calls.length, 1);
  assert.strictEqual(executorMock.mock.calls[0].arguments[0], 'read_chapter');
});
