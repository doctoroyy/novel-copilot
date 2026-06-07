/**
 * MCP Prompts — 预设的创作工作流模板
 *
 * 每个 prompt 是一个完整的创作任务指令，
 * agent 按指令调用工具完成创作。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer) {
  server.prompt(
    'write_next_chapter',
    '写下一章：获取上下文 → 分析方向 → 创作 → 评估 → 保存',
    {
      project_name: z.string().describe('项目名'),
      direction: z.string().optional().describe('可选的创作方向指示'),
    },
    async ({ project_name, direction }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            `请为「${project_name}」写下一章。`,
            '',
            '## 工作流',
            '',
            '### 1. 准备',
            '调用 `prepare_writing_context` 获取完整创作 briefing。',
            '',
            '### 2. 分析',
            '调用 `analyze_last_chapter_ending` 了解如何承接。',
            '调用 `suggest_chapter_direction` 获取方向建议。',
            '',
            '### 3. 构思',
            '基于以上信息，在心中规划：',
            '- 本章 2-4 个场景的序列',
            '- 每个场景的核心目的',
            '- 章末钩子方向',
            '- 要操作的伏笔（埋设/回收）',
            '',
            '### 4. 写作',
            '直接创作章节正文。注意：',
            '- 开头用动作或对话切入，不要重复上章结尾',
            '- 每个场景服务于推进剧情或展现人物',
            '- 结尾必须有钩子',
            '- 字数达到 briefing 中要求的最低字数',
            '',
            '### 5. 自检',
            '调用 `evaluate_chapter`（传入你写的内容）检查质量。',
            '如果评分 < B 级，根据建议修改后重新评估。',
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
            '2. `evaluate_chapter` 获取评分和问题',
            '3. `check_continuity` 检查连续性',
            '4. 如果有问题，重写有问题的部分',
            '5. 用 `commit_chapter` 保存修复后的版本',
            '',
            '## 修改原则',
            '- 只改有问题的部分，保持其余不变',
            '- 优先修复 ❌ 标记的严重问题',
            '- 章末钩子是重中之重——没有钩子的章节一定要补',
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
            '- 如果连续 2 章评分低于 B，暂停并报告问题',
            '- 注意章间节奏变化：不要连续写同类型场景',
            '',
            '### 完成后',
            '报告：写了哪些章、总字数、每章钩子概要、诊断结果。',
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
            '1. `prepare_writing_context` 了解当前状态',
            '2. `analyze_story_health` 诊断当前问题',
            '3. 基于以上信息，提出 3-5 个剧情发展方向：',
            '   - 方向概述',
            '   - 对应的冲突和爽点',
            '   - 能回收哪些伏笔',
            '   - 风险（可能的一致性问题）',
            '4. 用 `remember` 记录讨论结论',
            focus ? `\n## 重点关注\n${focus}` : '',
          ].join('\n'),
        },
      }],
    }),
  );
}
