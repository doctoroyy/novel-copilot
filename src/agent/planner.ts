import { z } from 'zod';
import type { AIConfig } from '../services/aiClient.js';
import { generateTextWithRetry } from '../services/aiClient.js';
import type { OutlineAgentState, PlannerDecision } from './types.js';

const LLMDecisionSchema = z.object({
  tool: z.enum(['generate_outline', 'critic_outline', 'finish']),
  reason: z.string().min(1),
  input: z.record(z.unknown()).optional(),
});

function stripMarkdownCodeFence(raw: string): string {
  return raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
}

function buildFallbackDecision(state: OutlineAgentState): PlannerDecision {
  const maxAttempts = state.maxRetries + 1;

  if (!state.latestOutline) {
    return {
      tool: 'generate_outline',
      reason: '尚无候选大纲，先生成第一版大纲',
    };
  }

  if (!state.latestEvaluation) {
    return {
      tool: 'critic_outline',
      reason: '已有候选大纲，需要先评估质量',
    };
  }

  if (state.latestEvaluation.passed) {
    return {
      tool: 'finish',
      reason: `质量评分达到 ${state.latestEvaluation.score}，满足目标阈值`,
    };
  }

  if (state.outlineVersion >= maxAttempts) {
    return {
      tool: 'finish',
      reason: `已达到最大尝试次数 ${maxAttempts}，停止重试`,
    };
  }

  const revisionNotes = state.latestEvaluation.issues.slice(0, 8).join('；');
  return {
    tool: 'generate_outline',
    reason: `当前评分 ${state.latestEvaluation.score} 低于目标 ${state.targetScore}，继续修复重试`,
    input: revisionNotes ? { revisionNotes } : {},
  };
}

function buildPlannerPrompt(state: OutlineAgentState): { system: string; prompt: string } {
  const maxAttempts = state.maxRetries + 1;
  const lastHistory = state.history.slice(-5);

  const system = `
你是小说大纲生成 Agent 的 Planner。你只能做一步决策：
1. generate_outline: 生成/重写大纲
2. critic_outline: 评估当前大纲质量
3. finish: 停止循环

只输出严格 JSON，不要输出任何额外文字。
JSON 结构：
{
  "tool": "generate_outline|critic_outline|finish",
  "reason": "简短决策理由",
  "input": {"revisionNotes":"可选，重写注意事项"}
}
`.trim();

  const prompt = `
【目标】
${state.goal}

【状态】
- 当前迭代步数: ${state.iteration}
- 已生成大纲版本: ${state.outlineVersion}/${maxAttempts}
- 目标评分: ${state.targetScore}
- 是否已有候选大纲: ${state.latestOutline ? '是' : '否'}
- 最近评分: ${state.latestEvaluation?.score ?? '无'}
- 最近是否通过: ${state.latestEvaluation?.passed ?? false}
- 最近问题: ${state.latestEvaluation?.issues.slice(0, 6).join('；') || '无'}

【最近历史】
${lastHistory.map((item) => `- [${item.tool}] ${item.summary}`).join('\n') || '- 无'}

【决策约束】
- 没有候选大纲时，只能选择 generate_outline
- 有候选大纲但未评估时，只能选择 critic_outline
- 评分达标或达到最大尝试次数时，优先选择 finish
- 如果评分不达标且还有重试配额，选择 generate_outline，并在 input.revisionNotes 给出改写重点
`.trim();

  return { system, prompt };
}

function normalizeDecision(state: OutlineAgentState, decision: PlannerDecision): PlannerDecision {
  const maxAttempts = state.maxRetries + 1;

  if (decision.tool === 'generate_outline' && state.outlineVersion >= maxAttempts) {
    return {
      tool: 'finish',
      reason: `已达到最大尝试次数 ${maxAttempts}，停止重试`,
    };
  }

  if (decision.tool === 'critic_outline' && !state.latestOutline) {
    return {
      tool: 'generate_outline',
      reason: '当前没有候选大纲，回退到生成步骤',
    };
  }

  if (decision.tool === 'finish' && !state.latestOutline) {
    return {
      tool: 'generate_outline',
      reason: '当前没有可用结果，不能结束，先生成大纲',
    };
  }

  return decision;
}

export async function planOutlineNextAction(params: {
  aiConfig: AIConfig;
  state: OutlineAgentState;
  useLLMPlanner?: boolean;
}): Promise<PlannerDecision> {
  const { aiConfig, state, useLLMPlanner = true } = params;
  const fallback = buildFallbackDecision(state);

  if (!useLLMPlanner) {
    return fallback;
  }

  try {
    const { system, prompt } = buildPlannerPrompt(state);
    const raw = await generateTextWithRetry(
      aiConfig,
      {
        system,
        prompt,
        temperature: 0.2,
        maxTokens: 240,
      },
      2
    );
    const parsed = LLMDecisionSchema.parse(JSON.parse(stripMarkdownCodeFence(raw)));
    return normalizeDecision(state, parsed);
  } catch (error) {
    console.warn('Planner fallback to heuristic decision:', (error as Error).message);
    return fallback;
  }
}
