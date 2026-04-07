/**
 * ExploreAgent Orchestrator — 精简版 ReAct 循环
 *
 * 用于根据用户创意搜索市场数据 + 生成定制化 Story Bible。
 * 典型 3 轮：并行搜索 → 分析生成 → finish
 */

import { z } from 'zod';
import type { AgentConfig, AgentTrace, AgentTurn, ToolCall } from '../types.js';
import { EXPLORE_TOOL_DEFINITIONS, EXPLORE_AI_TOOLS, type ExploreToolContext } from './tools.js';
import { ExploreToolExecutor } from './toolExecutor.js';
import {
  generateTextWithRetry,
  AICallTracer,
  type AICallOptions,
} from '../../services/aiClient.js';

const FINISH_SIGNAL = '[FINISH_SIGNAL]';

const AgentTurnSchema = z.object({
  thought: z.string(),
  tool_calls: z.array(z.object({
    tool: z.string(),
    args: z.record(z.any()),
  })).optional(),
  final_output: z.string().optional(),
});

const EXPLORE_CONFIG: AgentConfig = {
  maxTurns: 4,
  maxToolCallsPerTurn: 3,
  enableReaderSimulation: false,
  maxAICalls: 8,
};

export type ExploreProgressEvent = {
  type: 'progress' | 'search_result' | 'thought' | 'tool_result' | 'tool_error' | 'summary' | 'done' | 'error';
  phase?: string;
  detail?: string;
  data?: any;
  /** Agent 推理内容 */
  thought?: string;
  /** 工具名称 */
  toolName?: string;
  /** 工具结果摘要 */
  toolResultPreview?: string;
  /** 当前轮次 */
  turn?: number;
  /** 总轮次 */
  maxTurns?: number;
  /** AI 调用预算 */
  aiCallBudget?: { used: number; max: number };
};

export class ExploreAgentOrchestrator {
  private aiCallCount = 0;
  private scratchpad = '';
  private toolExecutor: ExploreToolExecutor;
  private tracer = new AICallTracer();
  private onEvent?: (event: ExploreProgressEvent) => void;

  constructor(
    private ctx: ExploreToolContext,
    onEvent?: (event: ExploreProgressEvent) => void,
  ) {
    this.toolExecutor = new ExploreToolExecutor(ctx);
    this.onEvent = onEvent;
  }

  async run(): Promise<{ bible: string; trace: AgentTrace }> {
    const startedAt = Date.now();
    const trace: AgentTrace = {
      turns: [],
      totalTurns: 0,
      totalDurationMs: 0,
      totalToolCalls: 0,
    };

    // 构建初始上下文
    this.scratchpad = this.buildInitialContext();

    for (let turn = 0; turn < EXPLORE_CONFIG.maxTurns; turn++) {
      if (this.aiCallCount >= EXPLORE_CONFIG.maxAICalls) {
        this.emit({
          type: 'progress',
          phase: 'budget_exceeded',
          detail: `推理预算已用完 (${this.aiCallCount}/${EXPLORE_CONFIG.maxAICalls})`,
          aiCallBudget: { used: this.aiCallCount, max: EXPLORE_CONFIG.maxAICalls },
        });
        break;
      }

      const turnStartedAt = Date.now();
      this.emit({
        type: 'progress',
        phase: 'reasoning',
        detail: `推理轮次 ${turn + 1}/${EXPLORE_CONFIG.maxTurns}`,
        turn: turn + 1,
        maxTurns: EXPLORE_CONFIG.maxTurns,
        aiCallBudget: { used: this.aiCallCount, max: EXPLORE_CONFIG.maxAICalls },
      });

      // 1. 调用 LLM 获取下一步
      const agentTurn = await this.getNextTurn();
      this.aiCallCount++;

      // 发送 Agent 推理过程
      this.emit({
        type: 'thought',
        thought: agentTurn.thought,
        turn: turn + 1,
        maxTurns: EXPLORE_CONFIG.maxTurns,
        detail: agentTurn.toolCalls?.length
          ? `计划调用 ${agentTurn.toolCalls.length} 个工具: ${agentTurn.toolCalls.map(tc => tc.tool).join(', ')}`
          : agentTurn.finalOutput ? '准备输出最终结果' : '推理中...',
      });

      const turnRecord = {
        turnIndex: turn,
        thought: agentTurn.thought,
        toolCalls: [] as { tool: string; args: any; result: string }[],
        durationMs: 0,
      };

      // 2. 检查 final_output
      if (agentTurn.finalOutput) {
        turnRecord.durationMs = Date.now() - turnStartedAt;
        trace.turns.push(turnRecord);
        trace.totalTurns = turn + 1;
        trace.totalDurationMs = Date.now() - startedAt;
        trace.totalToolCalls = this.countToolCalls(trace);
        this.emit({
          type: 'summary',
          detail: `✅ Agent 完成 | ${turn + 1} 轮推理 | ${this.countToolCalls(trace)} 次工具调用 | 耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
          data: { totalTurns: turn + 1, totalToolCalls: this.countToolCalls(trace), durationMs: Date.now() - startedAt },
        });
        return { bible: agentTurn.finalOutput, trace };
      }

      // 3. 执行工具调用
      if (agentTurn.toolCalls?.length) {
        const calls = agentTurn.toolCalls.slice(0, EXPLORE_CONFIG.maxToolCallsPerTurn);

        const results = await Promise.all(
          calls.map(async (call) => {
            const toolStartMs = Date.now();
            this.emit({
              type: 'progress',
              phase: 'tool_call',
              detail: `调用 ${call.tool}`,
              toolName: call.tool,
              turn: turn + 1,
            });

            if (EXPLORE_AI_TOOLS.has(call.tool)) {
              this.aiCallCount++;
            }

            if (call.tool === 'analyze_and_generate') {
              call.args = {
                search_data: this.scratchpad,
                user_concept: this.ctx.concept,
              };
            }

            let result: string;
            try {
              result = await this.toolExecutor.execute(call);

              // 为每个工具发送结果摘要
              const preview = this.buildToolResultPreview(call.tool, result);
              const isError = result.startsWith('[ERROR]');

              this.emit({
                type: isError ? 'tool_error' : 'tool_result',
                toolName: call.tool,
                toolResultPreview: preview,
                detail: `${call.tool} ${isError ? '❌' : '✅'} (${((Date.now() - toolStartMs) / 1000).toFixed(1)}s)`,
                turn: turn + 1,
              });
            } catch (err) {
              result = `[ERROR] ${call.tool} 执行失败: ${(err as Error).message}`;
              this.emit({
                type: 'tool_error',
                toolName: call.tool,
                toolResultPreview: (err as Error).message,
                detail: `${call.tool} 执行异常`,
                turn: turn + 1,
              });
            }

            // 发送搜索结果事件（前端可展示详情）
            if (['search_cached_templates', 'search_fanqie_rank', 'search_web'].includes(call.tool)) {
              this.emit({ type: 'search_result', phase: call.tool, detail: result.slice(0, 500), data: { tool: call.tool, result } });
            }

            return { tool: call.tool, args: call.args, result };
          }),
        );

        turnRecord.toolCalls = results;

        // 4. 处理 FINISH_SIGNAL
        for (const r of results) {
          if (r.result.startsWith(FINISH_SIGNAL)) {
            const bibleText = r.result.slice(FINISH_SIGNAL.length);
            if (bibleText) {
              turnRecord.durationMs = Date.now() - turnStartedAt;
              trace.turns.push(turnRecord);
              trace.totalTurns = turn + 1;
              trace.totalDurationMs = Date.now() - startedAt;
              trace.totalToolCalls = this.countToolCalls(trace);
              this.emit({
                type: 'summary',
                detail: `✅ Agent 完成 | ${turn + 1} 轮推理 | ${this.countToolCalls(trace)} 次工具调用 | 耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
                data: { totalTurns: turn + 1, totalToolCalls: this.countToolCalls(trace), durationMs: Date.now() - startedAt },
              });
              return { bible: bibleText, trace };
            }
          }
        }

        // 5. 将工具结果追加到 scratchpad
        const toolResultsText = results
          .map(r => `[Tool: ${r.tool}]\n${r.result.slice(0, 3000)}`)
          .join('\n\n');

        this.scratchpad += `\n\n--- Turn ${turn + 1} ---\nThought: ${agentTurn.thought}\n\n${toolResultsText}`;
      }

      turnRecord.durationMs = Date.now() - turnStartedAt;
      trace.turns.push(turnRecord);
    }

    // 循环结束未得到 bible — 返回空
    trace.totalTurns = trace.turns.length;
    trace.totalDurationMs = Date.now() - startedAt;
    trace.totalToolCalls = this.countToolCalls(trace);
    this.emit({
      type: 'summary',
      detail: `⚠️ Agent 未能生成结果 | ${trace.totalTurns} 轮推理 | ${trace.totalToolCalls} 次工具调用 | 耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      data: { totalTurns: trace.totalTurns, totalToolCalls: trace.totalToolCalls, durationMs: Date.now() - startedAt, success: false },
    });
    return { bible: '', trace };
  }

  // ========== 私有方法 ==========

  private emit(event: ExploreProgressEvent) {
    this.onEvent?.(event);
  }

  private buildInitialContext(): string {
    const { concept, genre, theme, keywords } = this.ctx;
    const parts = [`【用户创意】${concept}`];
    if (genre) parts.push(`【类型】${genre}`);
    if (theme) parts.push(`【主题】${theme}`);
    if (keywords) parts.push(`【关键词】${keywords}`);
    return parts.join('\n');
  }

  private async getNextTurn(): Promise<AgentTurn> {
    const system = this.buildSystemPrompt();
    const prompt = `${this.scratchpad}\n\n[预算] AI调用 ${this.aiCallCount}/${EXPLORE_CONFIG.maxAICalls}, 轮次 ${this.aiCallCount + 1}/${EXPLORE_CONFIG.maxTurns}\n\n请输出你的下一步推理和行动（JSON格式）：`;

    const callOptions: AICallOptions = {
      tracer: this.tracer,
      phase: 'planning',
      timeoutMs: 30_000,
    };

    const raw = await generateTextWithRetry(this.ctx.aiConfig, {
      system,
      prompt,
      temperature: 0.6,
      maxTokens: 1200,
    }, 2, callOptions);

    return this.parseResponse(raw);
  }

  private parseResponse(raw: string): AgentTurn {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { thought: raw.slice(0, 200) };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const validated = AgentTurnSchema.safeParse(parsed);

      if (validated.success) {
        return {
          thought: validated.data.thought,
          toolCalls: validated.data.tool_calls?.map(tc => ({ tool: tc.tool, args: tc.args })),
          finalOutput: validated.data.final_output,
        };
      }

      return {
        thought: parsed.thought || 'Schema validation failed',
        toolCalls: Array.isArray(parsed.tool_calls)
          ? parsed.tool_calls.map((tc: any) => ({ tool: tc.tool, args: tc.args || {} }))
          : undefined,
        finalOutput: parsed.final_output,
      };
    } catch {
      return { thought: raw.slice(0, 200) };
    }
  }

  private buildSystemPrompt(): string {
    const toolDescriptions = EXPLORE_TOOL_DEFINITIONS
      .map(t => {
        const params = Object.entries(t.parameters)
          .map(([k, v]) => `${k}(${v.type}${v.required ? ',必填' : ''}): ${v.description}`)
          .join('; ');
        return `- ${t.name}: ${t.description}${params ? `\n  参数: ${params}` : ''}`;
      })
      .join('\n');

    return `你是一个网文市场调研 Agent。你的任务是根据用户创意，搜索市场数据，然后生成定制化的 Story Bible。

## 工作流程

1. **搜索阶段（Turn 1）**: 并行调用多个搜索工具获取市场数据
   - search_cached_templates: 搜索已有模板（总是可用，会返回缓存数据）
   - search_fanqie_rank: 爬取实时热榜（优先实时，失败时自动降级到缓存）
   - search_web: Bing 搜索行业趋势（需要浏览器可用）
   注意：一次调用中最多 ${EXPLORE_CONFIG.maxToolCallsPerTurn} 个工具

2. **生成阶段（Turn 2）**: 调用 analyze_and_generate 生成定制化 Story Bible。该工具会自动提取上下文并处理最终输出。

## 重要原则

- **无论搜索工具返回什么结果（包括无数据、空结果），都必须在 Turn 2 调用 analyze_and_generate**
- 搜索结果仅供参考，analyze_and_generate 能够根据用户创意直接生成高质量内容
- 不要因搜索失败而重试或停止，直接进入生成阶段
- 尽量在 2 轮内完成任务（搜索 + 生成）

## 可用工具

${toolDescriptions}

## 输出格式

每轮输出严格 JSON（不要有其他文字）：
{
  "thought": "你的推理（50字以内）",
  "tool_calls": [{"tool": "工具名", "args": {...}}]
}

注意：
- tool_calls 和 final_output 不能同时存在
- 第一轮并行调用所有数据搜索工具
- 第二轮直接调用 analyze_and_generate（无论搜索是否成功）
- 调用 analyze_and_generate 即可完成全部任务`;
  }

  private countToolCalls(trace: AgentTrace): number {
    return trace.turns.reduce((sum, t) => sum + t.toolCalls.length, 0);
  }

  /** 为工具结果生成人类可读的摘要 */
  private buildToolResultPreview(toolName: string, result: string): string {
    if (result.startsWith('[ERROR]') || result.startsWith('[SKIP]')) {
      return result.slice(0, 150);
    }

    if (result.startsWith(FINISH_SIGNAL)) {
      const bibleLen = result.length - FINISH_SIGNAL.length;
      return `生成了 ${bibleLen} 字的 Story Bible`;
    }

    switch (toolName) {
      case 'search_cached_templates': {
        const tplMatch = result.match(/匹配模板 \((\d+)\)/);
        const rankMatch = result.match(/匹配排行书目 \((\d+)\)/);
        const parts: string[] = [];
        if (tplMatch) parts.push(`${tplMatch[1]} 个模板`);
        if (rankMatch) parts.push(`${rankMatch[1]} 本排行书`);
        return parts.length > 0
          ? `找到 ${parts.join('、')}` 
          : result.includes('未找到') ? '未找到匹配数据' : result.slice(0, 100);
      }
      case 'search_fanqie_rank': {
        const countMatch = result.match(/番茄热榜 \((\d+)/);
        return countMatch ? `获取到 ${countMatch[1]} 本热榜书目` : result.slice(0, 100);
      }
      case 'search_web': {
        const countMatch = result.match(/网页搜索结果 \((\d+)\)/);
        return countMatch ? `获取到 ${countMatch[1]} 条搜索结果` : result.slice(0, 100);
      }
      case 'analyze_and_generate':
        return `生成了 ${result.length} 字的分析结果`;
      default:
        return result.slice(0, 100);
    }
  }
}
