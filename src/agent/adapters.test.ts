import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicDirectAdapter } from './adapters/AnthropicDirectAdapter.js';
import { OpenAIDirectAdapter } from './adapters/OpenAIDirectAdapter.js';
import type { AgentMessage, ToolDefinition } from './adapters/types.js';

test('AnthropicDirectAdapter correctly formats system prompt and tools for caching', async () => {
  const adapter = new AnthropicDirectAdapter({
    apiKey: 'dummy',
    model: 'claude-3-5-sonnet-20240620'
  });

  // Spy on the internal client's create method
  const mockCreate = mock.fn(async () => {
    return {
      content: [{ type: 'text', text: 'Hello' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20 }
    };
  });
  
  // Replace the method
  (adapter as any).client.messages.create = mockCreate;

  const systemPrompt = 'You are an AI.';
  const messages: AgentMessage[] = [
    { role: 'user', content: 'Hi' }
  ];
  const tools: ToolDefinition[] = [
    { name: 'tool1', description: 'Tool 1', parameters: { type: 'object' } },
    { name: 'tool2', description: 'Tool 2', parameters: { type: 'object' } }
  ];

  await adapter.chat(systemPrompt, messages, tools);

  assert.strictEqual(mockCreate.mock.calls.length, 1);
  const callArgs = (mockCreate.mock.calls[0].arguments as any[])[0] as any;

  assert.strictEqual(callArgs.system, 'You are an AI.');
  assert.strictEqual(callArgs.messages.length, 1);
  assert.strictEqual(callArgs.messages[0].role, 'user');
  assert.strictEqual(callArgs.messages[0].content, 'Hi');
  
  assert.strictEqual(callArgs.tools.length, 2);
  assert.strictEqual(callArgs.tools[0].name, 'tool1');
  assert.strictEqual(callArgs.tools[1].name, 'tool2');
  assert.deepEqual(callArgs.tools[1].cache_control, { type: 'ephemeral' });
});

test('OpenAIDirectAdapter correctly formats tools and parses tool calls', async () => {
  const adapter = new OpenAIDirectAdapter({
    apiKey: 'dummy',
    model: 'gpt-4o'
  });

  const mockCreate = mock.fn(async () => {
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {
              name: 'tool1',
              arguments: '{"a":1}'
            }
          }]
        }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    };
  });

  (adapter as any).client.chat.completions.create = mockCreate;

  const systemPrompt = 'You are an AI.';
  const messages: AgentMessage[] = [
    { role: 'user', content: 'Hi' }
  ];
  const tools: ToolDefinition[] = [
    { name: 'tool1', description: 'Tool 1', parameters: { type: 'object' } }
  ];

  const result = await adapter.chat(systemPrompt, messages, tools);

  assert.strictEqual(mockCreate.mock.calls.length, 1);
  const callArgs = (mockCreate.mock.calls[0].arguments as any[])[0] as any;

  assert.strictEqual(callArgs.messages.length, 2);
  assert.strictEqual(callArgs.messages[0].role, 'system');
  assert.strictEqual(callArgs.messages[0].content, 'You are an AI.');
  
  assert.strictEqual(callArgs.tools.length, 1);
  assert.strictEqual(callArgs.tools[0].type, 'function');
  assert.strictEqual(callArgs.tools[0].function.name, 'tool1');

  // Verify parsing result
  assert.strictEqual(result.toolCalls?.length, 1);
  assert.strictEqual(result.toolCalls?.[0].id, 'call_123');
  assert.strictEqual(result.toolCalls?.[0].name, 'tool1');
  assert.deepEqual(result.toolCalls?.[0].arguments, { a: 1 });
});
