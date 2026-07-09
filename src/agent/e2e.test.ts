import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop, type ToolExecutor } from './agentLoop.js';
import { buildContextPackage, serializeContextPackage } from './contextBuilder.js';
import { importProposal } from './proposalImporter.js';
import { AGENT_SYSTEM_PROMPT } from './systemPrompt.js';
import type { AgentRuntimeAdapter, AdapterResponse, AgentMessage, ToolDefinition } from './adapters/types.js';

class DummyAdapter implements AgentRuntimeAdapter {
  provider = 'dummy';
  model = 'dummy-model';
  
  async chat(systemPrompt: string, messages: AgentMessage[], tools: ToolDefinition[]): Promise<AdapterResponse> {
    // Just mock returning a submit_proposal call immediately
    return {
      message: { 
        role: 'assistant', 
        content: [{ 
          type: 'tool_use', 
          tool_use_id: 'call_999', 
          name: 'submit_proposal', 
          input: { 
            scene_plan: [{ purpose: 'intro', conflict: 'none', new_info: 'world' }],
            chapter_text: '这是生成的章节文本内容。',
            review_notes: '没有冲突，建议增加。'
          } 
        }] 
      },
      toolCalls: [{ 
        id: 'call_999', 
        name: 'submit_proposal', 
        arguments: { 
          scene_plan: [{ purpose: 'intro', conflict: 'none', new_info: 'world' }],
          chapter_text: '这是生成的章节文本内容。',
          review_notes: '没有冲突，建议增加。'
        } 
      }],
      usage: { inputTokens: 50, outputTokens: 20 }
    };
  }
}

test('End-to-End Agent Workflow (Smoke Test)', async () => {
  // 1. Build Context
  const contextPkg = buildContextPackage({
    taskId: 'test-e2e',
    projectId: 'proj-1',
    chapterIndex: 1,
    rollingSummary: 'Test summary',
    writingStyleRules: 'Test rules',
    totalChapters: 0,
  });
  
  const serializedContext = serializeContextPackage(contextPkg);
  const fullSystemPrompt = `${AGENT_SYSTEM_PROMPT}\n\n${serializedContext}`;

  // 2. Setup Loop
  const adapter = new DummyAdapter();
  const executor = mock.fn(async () => { return 'ok'; }) as ToolExecutor;
  
  // 3. Run Loop
  const result = await runAgentLoop({
    adapter,
    systemPrompt: fullSystemPrompt,
    executor,
  });

  assert.strictEqual(result.status, 'completed');
  assert.ok(result.proposal);

  // 4. Import Proposal
  const importResult = importProposal(result.proposal);
  assert.strictEqual(importResult.success, true);
  assert.strictEqual(importResult.data?.chapter_text, '这是生成的章节文本内容。');
  assert.strictEqual(importResult.data?.scene_plan.length, 1);
});
