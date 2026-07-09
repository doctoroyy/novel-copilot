import type { AgentRuntimeAdapter, AgentMessage, AgentMessageContent, AdapterUsage } from './adapters/types.js';
import { AgentTools } from './tools.js';

export interface ToolExecutor {
  (name: string, args: any): Promise<any>;
}

export interface AgentLoopOptions {
  adapter: AgentRuntimeAdapter;
  systemPrompt: string;
  executor: ToolExecutor;
  maxIterations?: number;
  /** 首轮用户任务消息；缺省时使用通用章节写作指令 */
  initialUserMessage?: string;
}

export interface AgentRunResult {
  proposal?: any;
  messages: AgentMessage[];
  usage: AdapterUsage;
  status: 'completed' | 'max_iterations_reached' | 'error';
  error?: string;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentRunResult> {
  const {
    adapter,
    systemPrompt,
    executor,
    maxIterations = 15,
    initialUserMessage = '请根据当前任务上下文创作本章。先按需读取资料，完成后调用 submit_proposal 提交提案。',
  } = options;

  const messages: AgentMessage[] = [
    {
      role: 'user',
      content: initialUserMessage,
    },
  ];
  let iterations = 0;
  let emptyToolTurns = 0;

  const totalUsage: AdapterUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheHitTokens: 0,
  };

  while (iterations < maxIterations) {
    iterations++;

    try {
      const response = await adapter.chat(systemPrompt, messages, AgentTools);

      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;
      if (response.usage.cacheHitTokens) {
        totalUsage.cacheHitTokens = (totalUsage.cacheHitTokens || 0) + response.usage.cacheHitTokens;
      }

      messages.push(response.message);

      if (!response.toolCalls || response.toolCalls.length === 0) {
        emptyToolTurns += 1;
        if (emptyToolTurns >= 3) {
          return {
            status: 'error',
            error: 'Agent 连续多轮未调用工具，已中止以避免空转。',
            messages,
            usage: totalUsage,
          };
        }
        messages.push({
          role: 'user',
          content: '请调用工具获取上下文，或调用 submit_proposal 提交你的提案。不要只回复文字。',
        });
        continue;
      }

      emptyToolTurns = 0;
      const toolResults: AgentMessageContent[] = [];
      let proposalData: any = null;

      for (const tc of response.toolCalls) {
        if (tc.name === 'submit_proposal') {
          proposalData = tc.arguments;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: JSON.stringify({ success: true, message: 'Proposal submitted successfully.' }),
          });
          continue;
        }

        try {
          const result = await executor(tc.name, tc.arguments);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          });
        } catch (err: any) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            is_error: true,
            content: err.message || String(err),
          });
        }
      }

      // Anthropic 需要 user 消息承载 tool_result；OpenAI adapter 识别 role=tool
      messages.push({
        role: 'tool',
        content: toolResults,
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
