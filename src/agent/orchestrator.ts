/**
 * ReAct Agent Orchestrator — 核心循环
 *
 * 实现多轮推理 + 工具调用的 Agent 循环，
 * 用于替代线性 pipeline 的章节生成方式。
 */

import { z } from 'zod';
import type { AgentConfig, AgentState, AgentTrace, AgentTurn } from './types.js';
import { DEFAULT_AGENT_CONFIG } from './types.js';
import { TOOL_DEFINITIONS, AI_TOOLS } from './tools.js';
import { ToolExecutor } from './toolExecutor.js';
import {
  generateTextWithRetry,
  generateTextWithFallback,
  AICallTracer,
  type AIConfig,
  type FallbackConfig,
  type AICallOptions,
} from '../services/aiClient.js';
import { quickChapterFormatHeuristic } from '../qc.js';
import { normalizeGeneratedChapterText } from '../utils/chapterText.js';

/** Agent 单轮输出 Schema */
const AgentTurnSchema = z.object({
  thought: z.string(),
  tool_calls: z.array(z.object({
    tool: z.string(),
    args: z.record(z.any()),
  })).optional(),
  final_output: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  phase: z.string().optional(),
});

/** 构建 fallback config */
function buildFallbackConfig(primary: AIConfig, fallbackConfigs?: AIConfig[]): FallbackConfig {
  return {
    primary,
    fallback: fallbackConfigs,
    switchConditions: ['rate_limit', 'server_error', 'timeout', 'unknown'] as FallbackConfig['switchConditions'],
  };
}

export class ChapterAgentOrchestrator {
  private state: AgentState;
  private aiCallCount = 0;
  /** 保存初始上下文（optimizedContext + 写作目标），供 executeWriteChapter 使用 */
  private initialWriteContext = '';

  constructor(
    private aiConfig: AIConfig,
    private fallbackConfigs: AIConfig[] | undefined,
    private toolExecutor: ToolExecutor,
    private config: AgentConfig = DEFAULT_AGENT_CONFIG,
    private tracer: AICallTracer = new AICallTracer(),
  ) {
    this.state = {
      scratchpad: '',
      currentDraft: null,
      queriedTools: new Set(),
      turnCount: 0,
    };
  }

  async run(initialContext: string): Promise<{
    chapterText: string;
    trace: AgentTrace;
  }> {
    const startedAt = Date.now();
    const trace: AgentTrace = {
      turns: [],
      totalTurns: 0,
      totalDurationMs: 0,
      totalToolCalls: 0,
    };

    this.state.scratchpad = initialContext;
    this.initialWriteContext = initialContext;

    for (let turn = 0; turn < this.config.maxTurns; turn++) {
      // 预算检查
      if (this.aiCallCount >= this.config.maxAICalls) {
        this.config.onProgress?.('budget_exceeded', '推理预算已用完，输出当前最佳结果');
        break;
      }

      this.state.turnCount = turn;
      const turnStartedAt = Date.now();
      this.config.onProgress?.('reasoning', `推理轮次 ${turn + 1}/${this.config.maxTurns}`);

      // 1. 调用 LLM 获取下一步
      const agentTurn = await this.getNextTurn();
      this.aiCallCount++;

      const turnRecord = {
        turnIndex: turn,
        thought: agentTurn.thought,
        toolCalls: [] as { tool: string; args: any; result: string }[],
        durationMs: 0,
      };

      // 2. 检查是否有最终输出
      if (agentTurn.finalOutput) {
        turnRecord.durationMs = Date.now() - turnStartedAt;
        trace.turns.push(turnRecord);
        trace.totalTurns = turn + 1;
        trace.totalDurationMs = Date.now() - startedAt;
        trace.totalToolCalls = this.countTotalToolCalls(trace);
        return { chapterText: agentTurn.finalOutput, trace };
      }

      // 3. 执行工具调用
      if (agentTurn.toolCalls && agentTurn.toolCalls.length > 0) {
        const calls = agentTurn.toolCalls.slice(0, this.config.maxToolCallsPerTurn);

        const results = await Promise.all(
          calls.map(async (call) => {
            this.config.onProgress?.('tool_call', `调用 ${call.tool}`);

            // AI 增强工具计入预算
            if (AI_TOOLS.has(call.tool)) {
              this.aiCallCount++;
            }

            let result: string;
            try {
              result = await this.toolExecutor.execute(call);
            } catch (err) {
              result = `[ERROR] ${call.tool} 执行失败: ${(err as Error).message}`;
            }
            return { tool: call.tool, args: call.args, result };
          }),
        );

        turnRecord.toolCalls = results;

        // 4. 处理特殊信号
        for (const r of results) {
          if (r.result.startsWith('[WRITE_CHAPTER_SIGNAL]')) {
            const payload = JSON.parse(r.result.slice('[WRITE_CHAPTER_SIGNAL]'.length));
            this.config.onProgress?.('generating', '正在生成章节正文...');
            const draft = await this.executeWriteChapter(payload.scenePlan, payload.writingNotes);
            this.state.currentDraft = draft;
            this.toolExecutor.setCurrentDraft(draft);
            r.result = `章节草稿已生成，共 ${draft.length} 字。`;
          } else if (r.result.startsWith('[REWRITE_SECTION_SIGNAL]')) {
            const payload = JSON.parse(r.result.slice('[REWRITE_SECTION_SIGNAL]'.length));
            this.config.onProgress?.('rewriting', `正在重写片段: ${payload.section}...`);
            const rewritten = await this.executeRewriteSection(payload.section, payload.guidance);
            this.state.currentDraft = rewritten;
            this.toolExecutor.setCurrentDraft(rewritten);
            r.result = `片段 "${payload.section}" 已重写。`;
          } else if (r.result.startsWith('[FINISH_SIGNAL]')) {
            const finalText = r.result.slice('[FINISH_SIGNAL]'.length);
            const resolvedFinalText = this.resolveFinalChapterText(finalText);
            if (resolvedFinalText) {
              turnRecord.durationMs = Date.now() - turnStartedAt;
              trace.turns.push(turnRecord);
              trace.totalTurns = turn + 1;
              trace.totalDurationMs = Date.now() - startedAt;
              trace.totalToolCalls = this.countTotalToolCalls(trace);
              return { chapterText: resolvedFinalText, trace };
            }
          }
        }

        // 5. 将工具结果追加到 scratchpad
        const toolResultsText = results
          .map(r => `[Tool: ${r.tool}]\n${r.result.slice(0, 2000)}`)
          .join('\n\n');

        this.state.scratchpad += `\n\n--- Turn ${turn + 1} ---\n`
          + `Thought: ${agentTurn.thought}\n\n${toolResultsText}`;
      }

      turnRecord.durationMs = Date.now() - turnStartedAt;
      trace.turns.push(turnRecord);
    }

    // 循环结束未得到 finalOutput，使用 currentDraft 或空串
    trace.totalTurns = trace.turns.length;
    trace.totalDurationMs = Date.now() - startedAt;
    trace.totalToolCalls = this.countTotalToolCalls(trace);

    if (this.state.currentDraft) {
      return { chapterText: this.state.currentDraft, trace };
    }
    return { chapterText: '', trace };
  }

  // ========== 私有方法 ==========

  private async getNextTurn(): Promise<AgentTurn> {
    const systemPrompt = this.buildAgentSystemPrompt();
    const userPrompt = this.buildTurnPrompt();

    const callOptions: AICallOptions = {
      tracer: this.tracer,
      phase: 'drafting',
      timeoutMs: 60_000,
    };

    const raw = await generateTextWithRetry(this.aiConfig, {
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.6,
      maxTokens: 1200,
    }, 2, callOptions);

    return this.parseAgentResponse(raw);
  }

  private parseAgentResponse(raw: string): AgentTurn {
    // 尝试从 response 中提取 JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // 如果没找到 JSON，将整个输出作为 thought
      return { thought: raw.slice(0, 200) };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const validated = AgentTurnSchema.safeParse(parsed);

      if (validated.success) {
        return {
          thought: validated.data.thought,
          toolCalls: validated.data.tool_calls?.map(tc => ({
            tool: tc.tool,
            args: tc.args,
          })),
          finalOutput: validated.data.final_output,
          metadata: validated.data.confidence != null ? {
            confidence: validated.data.confidence,
            phase: validated.data.phase || 'unknown',
          } : undefined,
        };
      }

      // Schema 校验失败但 JSON 解析成功，尽量提取信息
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

  private buildTurnPrompt(): string {
    const draftInfo = this.state.currentDraft
      ? `\n\n[当前草稿状态] 已有草稿，共 ${this.state.currentDraft.length} 字。可用 soft_validate 校验格式或 rewrite_section 修改。`
      : '';

    const budgetInfo = `\n[预算] AI调用 ${this.aiCallCount}/${this.config.maxAICalls}, 轮次 ${this.state.turnCount + 1}/${this.config.maxTurns}`;

    return `${this.state.scratchpad}${draftInfo}${budgetInfo}\n\n请输出你的下一步推理和行动（JSON格式）：`;
  }

  private buildAgentSystemPrompt(): string {
    const toolDescriptions = TOOL_DEFINITIONS
      .map(t => {
        const params = Object.entries(t.parameters)
          .map(([k, v]) => `${k}(${v.type}${v.required ? ',必填' : ''}): ${v.description}`)
          .join('; ');
        return `- ${t.name}: ${t.description}${params ? `\n  参数: ${params}` : ''}`;
      })
      .join('\n');

    return `你是一个专业的小说章节创作 Agent。你通过多轮推理和工具调用来创作高质量的章节。

## 你的工作流程

1. **调研阶段**: 先使用查询工具了解当前故事状态（剧情图谱、角色状态、伏笔情况）
2. **分析阶段**: 分析读者预期、冲突密度，找到让故事精彩的切入点
3. **设计阶段**: 设计场景序列，确保有足够的冲突和意外
4. **写作阶段**: 调用 write_chapter 生成正文
5. **校验阶段**: 调用 soft_validate 检查格式（标题、字数等）
6. **优化阶段**: 如有必要，调用 rewrite_section 定向修改
7. **提交阶段**: 满意后用 finish 提交，或在 final_output 中直接输出最终文本

## 字数要求

本章正文（不含标题行）最少 ${this.toolExecutor['ctx'].minChapterWords || 2500} 字。这是硬性要求，字数不足的章节不合格。
写作时要充分展开场景描写、对话交锋和心理活动，确保内容充实饱满。

## 核心创作原则

- **打破预期**: 使用 query_reader_expectations 了解读者预测，然后有意识地打破部分预期
- **冲突升级**: 使用 analyze_conflict_density 确保冲突密度足够，每章至少有一个微冲突
- **伏笔管理**: 使用 check_foreshadowing_opportunities 及时回收伏笔，合理植入新伏笔
- **每次胜利都有代价**: 主角获得的每样东西都要付出相应代价
- **效率意识**: 数据查询工具不消耗 AI 预算，优先使用；AI 工具消耗预算，合理使用

## 可用工具

${toolDescriptions}

## 输出格式

每轮你必须输出严格的 JSON（不要有其他文字）：
{
  "thought": "你的推理过程（100字以内）",
  "tool_calls": [{"tool": "工具名", "args": {...}}],
  "confidence": 0.0-1.0,
  "phase": "research|analysis|design|writing|evaluation|optimization"
}

或者当你准备提交最终结果时：
{
  "thought": "提交原因",
  "tool_calls": [{"tool": "finish", "args": {"chapter_text": "完整章节文本..."}}],
  "confidence": 0.85,
  "phase": "final"
}

注意：
- tool_calls 和 final_output 不能同时存在
- 可以一次调多个工具（最多${this.config.maxToolCallsPerTurn}个）
- 当你对章节质量满意（confidence >= 0.8）时，用 finish 工具提交最终文本`;
  }

  /** 执行实际写作 — 使用 initialWriteContext（与旧管线一致的 optimizedContext 结构） */
  private async executeWriteChapter(scenePlan: string, writingNotes: string): Promise<string> {
    const ctx = this.toolExecutor['ctx'] as import('./tools.js').ToolContext;
    const { chapterIndex, totalChapters, narrativeGuide, minChapterWords } = ctx;
    const isFinal = chapterIndex === totalChapters;
    const targetWords = minChapterWords || 2500;
    const recommendedMaxWords = Math.max(targetWords + 1000, Math.round(targetWords * 1.5));

    let pacingInstructions = '';
    if (narrativeGuide) {
      const pacingDescriptions: Record<string, string> = {
        action: '动作/战斗章节，使用短句、快节奏、动作描写为主',
        climax: '高潮章节，情感和冲突达到峰值，使用强烈对比和出人意料的转折',
        tension: '紧张铺垫章节，营造压迫感和危机感',
        revelation: '揭示/发现章节，有节奏地释放关键信息',
        emotional: '情感章节，注重内心描写和关系发展',
        transition: '过渡章节，调整节奏、补充设定，但要埋下后续剧情的种子',
      };
      pacingInstructions = `\n节奏要求：本章类型 ${narrativeGuide.pacingType}（紧张度 ${narrativeGuide.pacingTarget}/10）。${pacingDescriptions[narrativeGuide.pacingType] || ''}`;
    }

    const system = `你是商业网文连载写作助手，核心目标是"好读、顺畅、让人想继续看"。

【阅读体验优先】
- 以剧情推进为第一优先，文采服务于阅读速度，不要为了辞藻牺牲清晰度
- 句子以短句和中句为主，避免连续堆砌形容词、比喻和排比
- 对话要像真实人物说话，信息有效，减少空话和口号
- 每个段落都应承担功能：推进事件、制造冲突或揭示信息

【章节推进规则】
- 本章必须完成"目标 -> 阻碍 -> 行动 -> 新结果/新问题"的推进链
- 开头直接进入当前场景，不写回顾式开场
- 非最终章结尾必须留下悬念、压力或抉择其一
- 单章只保留 1 个主危机，可附带 1 个副事件
- 若上一章刚经历大战或世界观升级，本章先处理余波和代价
${pacingInstructions}

═══════ 硬性规则 ═══════
- 只有当 is_final_chapter=true 才允许收束主线
- 若 is_final_chapter=false：严禁出现任何"完结/终章/尾声"等收尾表达
- 每章正文字数不少于 ${targetWords} 字，建议控制在 ${targetWords}~${recommendedMaxWords} 字
- 禁止说教式总结、口号式感悟、作者视角旁白
- 结尾不要"总结陈词"，用事件/冲突/抉择直接收尾

输出格式：
- 第一行必须是章节标题：第${chapterIndex}章 [创意标题]
- 章节号必须是 ${chapterIndex}
- 其后是正文
- 严禁写任何解释、元说明

当前是否为最终章：${isFinal ? 'true - 可以写结局' : 'false - 禁止收尾'}`;

    // 使用 initialWriteContext（即 optimizedContext + 写作目标），与旧管线保持一致
    const prompt = `${this.initialWriteContext}

【章节计划（内部参考，勿复述）】
${scenePlan}

【写作注意事项】
${writingNotes}
- 开头直接进入场景，禁止旁白或概述开头
- 重要对话前后要有动作/表情/心理描写
- 如有战斗/冲突，必须有具体招式/策略描写
- 章节结尾最后一段必须是钩子场景
- 展开具体场景而非概述，让读者"看到"而非"被告知"
- 本章正文字数至少 ${targetWords} 字

请写出本章完整内容：`;

    const callOptions: AICallOptions = {
      tracer: this.tracer,
      phase: 'drafting',
      timeoutMs: 5 * 60_000,
    };

    let raw: string;
    if (this.fallbackConfigs?.length) {
      raw = await generateTextWithFallback(
        buildFallbackConfig(this.aiConfig, this.fallbackConfigs),
        { system, prompt, temperature: 0.7 },
        2,
        callOptions,
      );
    } else {
      raw = await generateTextWithRetry(this.aiConfig, {
        system, prompt, temperature: 0.7,
      }, 3, callOptions);
    }

    return normalizeGeneratedChapterText(raw, chapterIndex);
  }

  /** 定向重写草稿片段 */
  private async executeRewriteSection(section: string, guidance: string): Promise<string> {
    if (!this.state.currentDraft) return '';
    const { chapterIndex, minChapterWords } = this.toolExecutor['ctx'];
    const targetWords = minChapterWords || 2500;

    const system = `你是小说编辑。根据指导重写指定片段，保持与其他部分的衔接。只输出修改后的完整章节文本。
注意：完整章节正文不少于 ${targetWords} 字，不要缩减内容。`;

    const prompt = `【当前草稿】
${this.state.currentDraft}

【要修改的片段】${section}
【修改指导】${guidance}

请输出修改后的完整章节文本（包含未修改的部分）：`;

    const callOptions: AICallOptions = {
      tracer: this.tracer,
      phase: 'selfReview',
      timeoutMs: 5 * 60_000,
    };

    const raw = await generateTextWithRetry(this.aiConfig, {
      system, prompt, temperature: 0.6,
    }, 2, callOptions);

    return normalizeGeneratedChapterText(raw, chapterIndex);
  }

  private countTotalToolCalls(trace: AgentTrace): number {
    return trace.turns.reduce((sum, t) => sum + t.toolCalls.length, 0);
  }

  private resolveFinalChapterText(finalText: string): string {
    const chapterIndex = this.toolExecutor['ctx'].chapterIndex;
    const normalizedFinalText = normalizeGeneratedChapterText(finalText, chapterIndex);
    const currentDraft = this.state.currentDraft;

    if (!currentDraft) {
      return normalizedFinalText;
    }

    const finalTextLooksShort = this.hasShortBodyIssue(normalizedFinalText);
    const currentDraftLooksShort = this.hasShortBodyIssue(currentDraft);
    const currentDraftClearlyLonger = currentDraft.length > normalizedFinalText.length + 300;

    if ((finalTextLooksShort || currentDraftClearlyLonger) && !currentDraftLooksShort) {
      return currentDraft;
    }

    return normalizedFinalText;
  }

  private hasShortBodyIssue(chapterText: string): boolean {
    if (!chapterText.trim()) return true;

    const minBodyChars = this.toolExecutor['ctx'].minChapterWords || 2500;
    const result = quickChapterFormatHeuristic(chapterText, { minBodyChars });
    return [...result.blockingReasons, ...result.reviewReasons].some((reason) =>
      reason.includes('过短') || reason.includes('目标至少') || reason.includes('缺少章节正文')
    );
  }
}
