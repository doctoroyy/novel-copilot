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
import { normalizeGeneratedChapterText, cleanChapterTitle } from '../utils/chapterText.js';
import { buildChapterPromptStyleSection } from '../chapterPromptProfiles.js';
import { buildCoreWritingRules, type NarrativeType } from '../writingRules.js';
import { extractAgentJSON } from './orchestratorUtils.js';

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
  /** 保存干净的初始上下文（optimizedContext），不含 Agent 思考历史 */
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
      // 预算检查：预算耗尽或仅剩1次且已有草稿 → 直接用草稿结束
      if (this.aiCallCount >= this.config.maxAICalls) {
        this.config.onProgress?.('budget_exceeded', '推理预算已用完，输出当前最佳结果');
        break;
      }
      if (this.state.currentDraft && this.aiCallCount >= this.config.maxAICalls - 1) {
        this.config.onProgress?.('budget_exceeded', '预算即将耗尽，提交当前草稿');
        trace.totalTurns = trace.turns.length;
        trace.totalDurationMs = Date.now() - startedAt;
        trace.totalToolCalls = this.countTotalToolCalls(trace);
        return { chapterText: this.state.currentDraft, trace };
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
        // 优先使用 currentDraft（比 Agent inline final_output 更完整）
        let output = agentTurn.finalOutput;
        if (this.state.currentDraft) {
          const draftLen = this.state.currentDraft.replace(/\s/g, '').length;
          const outputLen = output.replace(/\s/g, '').length;
          if (draftLen > outputLen) {
            output = this.state.currentDraft;
          }
        }
        turnRecord.durationMs = Date.now() - turnStartedAt;
        trace.turns.push(turnRecord);
        trace.totalTurns = turn + 1;
        trace.totalDurationMs = Date.now() - startedAt;
        trace.totalToolCalls = this.countTotalToolCalls(trace);
        return { chapterText: output, trace };
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
            const draftWordCount = draft.replace(/\s/g, '').length;
            r.result = `章节草稿已生成，共 ${draftWordCount} 字（目标 >= ${this.toolExecutor['ctx'].minChapterWords || 2500}）。`;
            console.log(`[Agent] write_chapter: ${draftWordCount} 字`);
          } else if (r.result.startsWith('[REWRITE_SECTION_SIGNAL]')) {
            const payload = JSON.parse(r.result.slice('[REWRITE_SECTION_SIGNAL]'.length));
            this.config.onProgress?.('rewriting', `正在重写片段: ${payload.section}...`);
            const rewritten = await this.executeRewriteSection(payload.section, payload.guidance);
            // 安全检查：如果重写结果比原稿短超过 20%，拒绝替换
            const oldLen = this.state.currentDraft?.replace(/\s/g, '').length || 0;
            const newLen = rewritten.replace(/\s/g, '').length;
            if (rewritten && newLen >= oldLen * 0.8) {
              this.state.currentDraft = rewritten;
              this.toolExecutor.setCurrentDraft(rewritten);
              r.result = `片段 "${payload.section}" 已重写，字数 ${oldLen} → ${newLen}。`;
            } else {
              r.result = `片段 "${payload.section}" 重写后太短（${newLen} < 原稿 ${oldLen} 的 80%），已保留原稿。`;
            }
          } else if (r.result.startsWith('[FINISH_SIGNAL]')) {
            let finalText = r.result.slice('[FINISH_SIGNAL]'.length);
            // 优先使用存储的 currentDraft（比 Agent inline 输出更完整）
            if (this.state.currentDraft) {
              const draftLen = this.state.currentDraft.replace(/\s/g, '').length;
              const finishLen = finalText.replace(/\s/g, '').length;
              if (draftLen > finishLen) {
                finalText = this.state.currentDraft;
              }
            }
            if (finalText) {
              turnRecord.durationMs = Date.now() - turnStartedAt;
              trace.turns.push(turnRecord);
              trace.totalTurns = turn + 1;
              trace.totalDurationMs = Date.now() - startedAt;
              trace.totalToolCalls = this.countTotalToolCalls(trace);
              return { chapterText: finalText, trace };
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
    const extracted = extractAgentJSON(raw);
    if (!extracted) {
      return { thought: raw.slice(0, 200) };
    }

    return {
      thought: extracted.thought,
      toolCalls: Array.isArray(extracted.tool_calls)
        ? extracted.tool_calls.map(tc => ({ tool: tc.tool, args: tc.args || {} }))
        : undefined,
      finalOutput: extracted.final_output,
      metadata: extracted.confidence != null
        ? { confidence: extracted.confidence, phase: extracted.phase || 'unknown' }
        : undefined,
    };
  }

  private buildTurnPrompt(): string {
    const draftInfo = this.state.currentDraft
      ? `\n\n[当前草稿状态] 已有草稿，共 ${this.state.currentDraft.length} 字。可用 evaluate_draft 评估或 rewrite_section 修改。`
      : '';

    const budgetInfo = `\n[预算] AI调用 ${this.aiCallCount}/${this.config.maxAICalls}, 轮次 ${this.state.turnCount + 1}/${this.config.maxTurns}`;

    return `${this.state.scratchpad}${draftInfo}${budgetInfo}\n\n请输出你的下一步推理和行动（JSON格式）：`;
  }

  private buildAgentSystemPrompt(): string {
    const ctx = this.toolExecutor['ctx'];
    const minChapterWords = ctx.minChapterWords || 2500;
    const isLeanBudget = this.config.maxAICalls <= 4;

    // For lean budgets, only list essential tools
    const toolsToList = isLeanBudget
      ? TOOL_DEFINITIONS.filter(t =>
          ['write_chapter', 'soft_validate', 'finish', 'query_plot_graph', 'check_foreshadowing_opportunities'].includes(t.name))
      : TOOL_DEFINITIONS;

    const toolDescriptions = toolsToList
      .map(t => {
        const params = Object.entries(t.parameters)
          .map(([k, v]) => `${k}(${v.type}${v.required ? ',必填' : ''}): ${v.description}`)
          .join('; ');
        return `- ${t.name}: ${t.description}${params ? `\n  参数: ${params}` : ''}`;
      })
      .join('\n');

    if (isLeanBudget) {
      return `你是小说章节创作 Agent。预算紧凑，直奔主题。

工作流：查阅关键伏笔 → write_chapter 生成正文 → soft_validate 校验 → finish 提交。
字数要求：正文 >= ${minChapterWords} 字。
可用工具：
${toolDescriptions}

输出严格 JSON：
{"thought":"推理","tool_calls":[{"tool":"名","args":{}}],"confidence":0.9,"phase":"writing"}
最多调 ${this.config.maxToolCallsPerTurn} 个工具/轮。confidence >= 0.8 时用 finish 提交。`;
    }

    return `你是一个专业的小说章节创作 Agent。你通过多轮推理和工具调用来创作高质量的章节。

## 工作流程（效率优先）
1. 查阅核心信息流并构思场景序列
2. 调用 write_chapter 生成正文
3. soft_validate 检查字数和格式
4. 达标即 finish 提交，除非有严重缺陷才 evaluate_draft 或 rewrite_section

## 核心原则
- 打破读者预期，冲突升级，伏笔管理
- 每次胜利都有代价
- 数据查询工具不消耗 AI 预算，优先用；AI 工具消耗预算，精用

## 字数要求
正文 >= ${minChapterWords} 字。不足时用 rewrite_section 扩充。

## 可用工具
${toolDescriptions}

## 输出格式
每轮输出严格 JSON：
{"thought":"推理(100字内)","tool_calls":[{"tool":"名","args":{}}],"confidence":0.0-1.0,"phase":"research|design|writing|evaluation|final"}
最多 ${this.config.maxToolCallsPerTurn} 个工具/轮。confidence >= 0.8 用 finish 提交。`;
  }

  /** 执行实际写作 — 系统 prompt 与老 pipeline buildEnhancedSystemPrompt 完全对齐 */
  private async executeWriteChapter(scenePlan: string, writingNotes: string): Promise<string> {
    const ctx = this.toolExecutor['ctx'];
    const { chapterIndex, totalChapters, narrativeGuide, enhancedOutline } = ctx;
    const isFinal = chapterIndex === totalChapters;

    const minChapterWords = ctx.minChapterWords || 2500;
    const recommendedMaxWords = Math.max(minChapterWords + 1000, Math.round(minChapterWords * 1.5));

    const chapterTitleRaw = enhancedOutline?.title;
    const chapterTitle = cleanChapterTitle(chapterTitleRaw || '');
    const titleText = chapterTitle
      ? `第${chapterIndex}章 ${chapterTitle}`
      : `第${chapterIndex}章 [你需要起一个创意标题]`;

    // 节奏指令（与老 pipeline 一致）
    let pacingInstructions = '';
    if (narrativeGuide) {
      const pacingDescriptions: Record<string, string> = {
        action: '这是动作/战斗章节，使用短句、快节奏、动作描写为主，对话简短有力',
        climax: '这是高潮章节，情感和冲突达到峰值，使用强烈对比和出人意料的转折',
        tension: '这是紧张铺垫章节，营造压迫感和危机感，使用暗示和伏笔',
        revelation: '这是揭示/发现章节，有节奏地释放关键信息，角色反应要真实',
        emotional: '这是情感章节，注重内心描写和关系发展，对话可以更细腻',
        transition: '这是过渡章节，调整节奏、补充设定，但要埋下后续剧情的种子',
      };
      pacingInstructions = `
节奏要求（重要）：
- 本章节奏类型: ${narrativeGuide.pacingType}
- 紧张度目标: ${narrativeGuide.pacingTarget}/10
- ${pacingDescriptions[narrativeGuide.pacingType] || ''}`;
    }

    // 风格模板
    const styleSection = buildChapterPromptStyleSection(
      ctx.chapterPromptProfile,
      ctx.chapterPromptCustom,
    );

    const isOpeningChapter = chapterIndex <= 3;
    const goldenThreeRules = '';

    const defaultCoreRules = buildCoreWritingRules({
      chapterIndex,
      totalChapters: ctx.totalChapters,
      isFinalChapter: isFinal,
      narrativeType: narrativeGuide?.pacingType as NarrativeType | undefined,
      pacingTarget: narrativeGuide?.pacingTarget,
    });

    const coreRules = ctx.customSystemPrompt ? ctx.customSystemPrompt.trim() : defaultCoreRules;

    const system = `${coreRules}
${pacingInstructions}

【当前风格模板】
- 模板: ${styleSection.profileLabel}
- 说明: ${styleSection.profileDescription}
${styleSection.styleBlock}

═══════ 硬性规则 ═══════
- 只有当 is_final_chapter=true 才允许收束主线
- 若 is_final_chapter=false：严禁出现任何"完结/终章/尾声/后记/感谢读者"等收尾表达
- 每章正文字数不少于 ${minChapterWords} 字，建议控制在 ${minChapterWords}~${recommendedMaxWords} 字
- 禁止说教式总结、口号式感悟、作者视角旁白
- 结尾不要"总结陈词"，用事件/冲突/抉择直接收尾
- 章末钩子必须属于以下之一：危机悬停/信息炸弹/强敌出场/反转/抉择困境/伏笔触发/时限压力

输出格式：
- 第一行必须是章节标题：${titleText}
- 章节号必须是 ${chapterIndex}，严禁使用其他数字
- 从第二行开始输出正文内容
- 不要输出 JSON，不要代码块，不要"以下是正文"等解释说明
- 严禁写任何解释、元说明、目标完成提示、字数统计（如"本章完，共计xxx字"）

当前是否为最终章：${isFinal ? 'true - 可以写结局' : 'false - 禁止收尾'}`;

    // 使用干净的 initialWriteContext 而非被 Agent 思考历史污染的 scratchpad
    const prompt = `${this.initialWriteContext}

【Agent 场景计划】
${scenePlan}

【Agent 写作注意事项】
${writingNotes}

本章正文字数至少 ${minChapterWords} 字，请写出本章完整内容：`;

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

    let result = normalizeGeneratedChapterText(raw, chapterIndex);

    // 自动扩写：如果输出不达标，用续写模式扩展
    const bodyText = result.replace(/^[^\n]*\n+/, ''); // 去标题行
    const wordCount = bodyText.replace(/\s/g, '').length;
    if (wordCount < minChapterWords) {
      console.log(`[Agent] 首次输出 ${wordCount} 字 < ${minChapterWords} 目标，触发续写扩展`);
      const expandPrompt = `你之前写的章节太短了（只有 ${wordCount} 字，目标至少 ${minChapterWords} 字）。

请在已有内容的基础上大幅扩展本章。保留已有情节走向，但必须用事件和冲突来扩充，严禁水字数：
1. 补充中间环节：增加主角达成目标过程中的小挫折、试错、具体互动回合
2. 扩展对话交锋：让对话有更多拉扯、信息博弈和情绪反应，不要一笔带过
3. 增加爽点密度：每800-1000字至少一个小爽点（主角展示能力/获得进展/赢得交锋）
4. 利用信息差：让某些角色不知道的信息制造悬念和期待
5. **绝对禁止**通过堆砌环境描写、华丽形容词、比喻或感官细节来凑字数

已有章节：
${result}

请输出扩展后的完整章节（必须超过 ${minChapterWords} 字，保持轻松直白口语化风格）：`;

      let expandedRaw: string;
      if (this.fallbackConfigs?.length) {
        expandedRaw = await generateTextWithFallback(
          buildFallbackConfig(this.aiConfig, this.fallbackConfigs),
          { system, prompt: expandPrompt, temperature: 0.7 },
          2,
          callOptions,
        );
      } else {
        expandedRaw = await generateTextWithRetry(this.aiConfig, {
          system, prompt: expandPrompt, temperature: 0.7,
        }, 2, callOptions);
      }

      const expanded = normalizeGeneratedChapterText(expandedRaw, chapterIndex);
      const expandedWordCount = expanded.replace(/^[^\n]*\n+/, '').replace(/\s/g, '').length;
      if (expandedWordCount > wordCount) {
        console.log(`[Agent] 续写扩展 ${wordCount} → ${expandedWordCount} 字`);
        result = expanded;
      }
    }

    return result;
  }

  /** 定向重写草稿片段 */
  private async executeRewriteSection(section: string, guidance: string): Promise<string> {
    if (!this.state.currentDraft) return '';
    const ctx = this.toolExecutor['ctx'];
    const { chapterIndex } = ctx;
    const minChapterWords = ctx.minChapterWords || 2500;

    const system = `你是小说编辑。根据指导重写指定片段，保持与其他部分的衔接。只输出修改后的完整章节文本。
注意：完整章节正文不少于 ${minChapterWords} 字，不要缩减内容。`;

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
}
