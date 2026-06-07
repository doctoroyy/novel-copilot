/**
 * MCP Prompts — 预设的创作工作流模板
 *
 * 每个 prompt 是一个完整的创作任务指令，
 * agent 按指令调用工具完成创作。
 * v2: 集成写作规则和节奏指导工具。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer) {
  server.prompt(
    'write_next_chapter',
    '写下一章：获取上下文(含规则) → 分析方向 → 创作 → 评估 → 保存',
    {
      project_name: z.string().describe('项目名'),
      direction: z.string().optional().describe('可选的创作方向指示'),
      narrative_type: z.enum(['action', 'climax', 'tension', 'revelation', 'emotional', 'transition'])
        .optional().describe('可选的叙事类型覆盖'),
    },
    async ({ project_name, direction, narrative_type }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            `请为「${project_name}」写下一章。${narrative_type ? `叙事类型: ${narrative_type}。` : ''}`,
            '',
            '## 工作流',
            '',
            '### 1. 准备（一次获取全部上下文）',
            `调用 \`prepare_writing_context\` 获取完整创作 briefing。${narrative_type ? `传入 narrative_type="${narrative_type}"。` : ''}`,
            'briefing 已包含：写作规则、节奏指导、一致性护栏、前文摘要、伏笔。',
            '',
            '### 2. 分析（可选，复杂章节推荐）',
            '调用 `analyze_last_chapter_ending` 了解如何承接。',
            '调用 `suggest_chapter_direction` 获取方向建议。',
            '',
            '### 3. 构思',
            '基于 briefing 中的规则和节奏指导，规划：',
            '- 本章 2-4 个场景的序列',
            '- CHST 四要素如何达成（冲突/钩子/爽点/转折）',
            '- 章末钩子属于 12 类钩子的哪一种',
            '- 要操作的伏笔（埋设/回收）',
            '',
            '### 4. 写作',
            '严格遵守 briefing 中的【写作规则】创作正文。关键约束：',
            '- 开头用动作/对话切入，不要重复上章结尾',
            '- 句长≤25字，对话≤30字（小白文规则）',
            '- 无对白连续段落≤300字（弃书红线）',
            '- 结尾 200-300 字必须是 12 类钩子之一',
            '- 字数达到 briefing 中的建议区间',
            '',
            '### 5. 自检',
            '调用 `evaluate_chapter`（传入你写的内容）做引擎级评估。',
            '- 如果有 🚫 弃书红线：必须修复后重新评估',
            '- 如果评分 < B 级：根据建议修改后重新评估',
            '调用 `check_continuity` 确认无连续性问题。',
            '',
            '### 6. 提交',
            '调用 `commit_chapter` 保存。',
            '调用 `commit_summary` 更新滚动摘要和伏笔（基于新章内容）。',
            direction ? `\n## 创作方向\n${direction}` : '',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'review_and_fix',
    '审核并修复已有章节的质量问题',
    {
      project_name: z.string().describe('项目名'),
      chapter_index: z.number().describe('要审核的章节'),
    },
    async ({ project_name, chapter_index }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            `审核「${project_name}」第 ${chapter_index} 章并修复问题。`,
            '',
            '## 流程',
            '1. `read_chapter` 读取全文',
            '2. `evaluate_chapter` 获取引擎级评分和问题列表',
            '3. `check_continuity` 检查连续性',
            '4. `get_writing_rules` 获取该章应遵守的规则',
            '5. 如果有弃书红线或评分 < B：按规则重写有问题的部分',
            '6. 用 `evaluate_chapter` 验证修复后的版本通过',
            '7. 用 `commit_chapter` 保存修复后的版本',
            '',
            '## 修改原则',
            '- 只改有问题的部分，保持其余不变',
            '- 优先修复 🚫 弃书红线（设定倾泻/无钩子/话剧腔）',
            '- 章末钩子是重中之重——没有钩子的章节一定要补',
            '- 遵守句长限制（正文≤25字，对话≤30字）',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'batch_write',
    '连续写多章（批量日更模式）',
    {
      project_name: z.string().describe('项目名'),
      count: z.number().describe('要写几章'),
    },
    async ({ project_name, count }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            `请为「${project_name}」连续写 ${count} 章。`,
            '',
            '## 执行规则',
            '',
            '对每一章执行 write_next_chapter 的完整流程。',
            '',
            '### 批量模式额外规则',
            '- 每章完成后必须 commit_summary，否则下一章上下文断裂',
            '- 每 3 章调用 `analyze_story_health` 做一次全面诊断',
            '- 如果连续 2 章有弃书红线或评分低于 B，暂停并报告问题',
            '- 注意章间节奏变化：使用 `get_pacing_guidance` 确认节奏曲线',
            '- 不要连续写同类型场景（动作后接情感，紧张后接揭示）',
            '',
            '### 完成后',
            '报告：写了哪些章、总字数、每章评分、节奏变化曲线。',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'brainstorm_plot',
    '基于当前状态进行剧情头脑风暴',
    {
      project_name: z.string().describe('项目名'),
      focus: z.string().optional().describe('关注的方面'),
    },
    async ({ project_name, focus }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            `为「${project_name}」进行剧情头脑风暴。`,
            '',
            '## 流程',
            '1. `prepare_writing_context` 了解当前状态和节奏位置',
            '2. `analyze_story_health` 诊断当前问题',
            '3. `get_pacing_guidance` 了解接下来几章的节奏曲线',
            '4. 基于以上信息，提出 3-5 个剧情发展方向：',
            '   - 方向概述',
            '   - 对应的叙事类型（action/climax/tension/revelation/emotional/transition）',
            '   - 能回收哪些伏笔',
            '   - CHST 四要素如何满足',
            '   - 风险（可能的一致性问题）',
            '5. 用 `remember` 记录讨论结论',
            focus ? `\n## 重点关注\n${focus}` : '',
          ].join('\n'),
        },
      }],
    }),
  );
}
