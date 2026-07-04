import type { AgentRuntimeAdapter, AgentMessage, AgentMessageContent, ToolCallResult, AdapterUsage } from './adapters/types.js';
import { AgentTools } from './tools.js';

export interface ToolExecutor {
  (name: string, args: any): Promise<any>;
}

export interface AgentLoopOptions {
  adapter: AgentRuntimeAdapter;
  systemPrompt: string;
  executor: ToolExecutor;
  maxIterations?: number;
}

export interface AgentRunResult {
  proposal?: any;
  messages: AgentMessage[];
  usage: AdapterUsage;
  status: 'completed' | 'max_iterations_reached' | 'error';
  error?: string;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentRunResult> {
  const { adapter, systemPrompt, executor, maxIterations = 15 } = options;
  
  const messages: AgentMessage[] = [];
  let iterations = 0;
  
  const totalUsage: AdapterUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheHitTokens: 0,
  };

  while (iterations < maxIterations) {
    iterations++;

    try {
      const response = await adapter.chat(systemPrompt, messages, AgentTools);
      
      // Update usage
      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;
      if (response.usage.cacheHitTokens) {
        totalUsage.cacheHitTokens! += response.usage.cacheHitTokens;
      }

      messages.push(response.message);

      // If no tool calls, the model decided to just talk. We could break or continue.
      // Usually it should call submit_proposal when done.
      if (!response.toolCalls || response.toolCalls.length === 0) {
        // Did not call tools, and did not submit proposal. We'll ask it to proceed or finish.
        messages.push({
          role: 'user',
          content: '请调用 submit_proposal 提交你的提案，或者调用其他工具获取更多上下文。'
        });
        continue;
      }

      const toolResults: AgentMessageContent[] = [];
      let proposalData = null;

      // Execute tools
      for (const tc of response.toolCalls) {
        if (tc.name === 'submit_proposal') {
          proposalData = tc.arguments;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: JSON.stringify({ success: true, message: 'Proposal submitted successfully.' })
          });
        } else {
          try {
            const result = await executor(tc.name, tc.arguments);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: typeof result === 'string' ? result : JSON.stringify(result)
            });
          } catch (err: any) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              is_error: true,
              content: err.message || String(err)
            });
          }
        }
      }

      messages.push({
        role: 'tool', // Our adapters translate 'tool' role + 'tool_result' blocks appropriately
        content: toolResults
      });

      if (proposalData) {
        return {
          status: 'completed',
          proposal: proposalData,
          messages,
          usage: totalUsage,
        };
      }

    } catch (error: any) {
      return {
        status: 'error',
        error: error.message || String(error),
        messages,
        usage: totalUsage,
      };
    }
  }

  return {
    status: 'max_iterations_reached',
    messages,
    usage: totalUsage,
  };
}
