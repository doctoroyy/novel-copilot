/**
 * MCP Prompts — pre-built prompt templates for common novel operations
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer) {
  server.prompt(
    'generate_chapter',
    'Generate a new chapter with full context injection',
    {
      project_name: z.string().describe('Project name for context'),
      chapter_index: z.number().describe('Which chapter to write'),
      direction: z.string().optional().describe('Optional creative direction or constraints'),
    },
    async ({ project_name, chapter_index, direction }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            `请为项目「${project_name}」撰写第 ${chapter_index} 章。`,
            '',
            '工作流程：',
            '1. 先调用 project_get 获取项目设定和当前状态',
            '2. 调用 context_get_state 获取滚动摘要和未解伏笔',
            '3. 调用 chapter_read_recent 读取最近 2-3 章保持连续性',
            '4. 调用 outline_get 查看本章在大纲中的位置和要求',
            '5. 根据以上信息撰写本章，注意：',
            '   - 字数不少于项目设定的 minChapterWords',
            '   - 结尾必须有钩子（悬念、转折或冲突升级）',
            '   - 保持人物性格一致性',
            '   - 推进至少一条主线或支线',
            '6. 调用 chapter_write 保存章节',
            '7. 更新 rolling_summary 和 open_loops（调用 chapter_update_summary）',
            '8. 调用 qc_heuristic_check 验证质量',
            direction ? `\n创作方向：${direction}` : '',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'review_chapter',
    'Review an existing chapter for quality and consistency',
    {
      project_name: z.string().describe('Project name'),
      chapter_index: z.number().describe('Chapter to review'),
    },
    async ({ project_name, chapter_index }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            `请审核项目「${project_name}」的第 ${chapter_index} 章。`,
            '',
            '审核流程：',
            '1. 调用 chapter_read 读取该章内容',
            '2. 调用 qc_heuristic_check 做基础质量检查',
            '3. 调用 qc_consistency_check 做连续性检查',
            '4. 调用 context_get_state 对比滚动摘要',
            '5. 给出修改建议，重点关注：',
            '   - 钩子是否足够强',
            '   - 是否有情节重复或遗漏',
            '   - 人物行为是否合理',
            '   - 节奏是否合适',
          ].join('\n'),
        },
      }],
    }),
  );

  server.prompt(
    'brainstorm_plot',
    'Brainstorm plot development ideas based on current state',
    {
      project_name: z.string().describe('Project name'),
      focus: z.string().optional().describe('What aspect to brainstorm about'),
    },
    async ({ project_name, focus }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: [
            `请为项目「${project_name}」进行剧情头脑风暴。`,
            '',
            '步骤：',
            '1. 调用 project_get 了解设定',
            '2. 调用 context_get_state 了解当前进度',
            '3. 调用 context_plot_graph 查看活跃剧情线',
            '4. 基于以上信息，提出 3-5 个剧情发展方向，每个包含：',
            '   - 方向概述',
            '   - 可能的冲突升级点',
            '   - 对哪些伏笔有回收作用',
            '   - 风险评估（是否会导致不一致）',
            focus ? `\n重点关注：${focus}` : '',
          ].join('\n'),
        },
      }],
    }),
  );
}
