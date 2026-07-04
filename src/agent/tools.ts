import { z } from 'zod';
import type { ToolDefinition } from './adapters/types.js';

export const ToolSchemas = {
  read_story_vault: z.object({
    aspect: z.enum(['active_plots', 'pending_foreshadowing', 'causal_chains', 'recent_events', 'full_summary'])
      .describe('要查询的资料库方面'),
  }),
  
  read_chapter: z.object({
    chapter_index: z.number().describe('要读取的章节序号'),
  }),
  
  read_summary: z.object({
    scope: z.enum(['recent_3', 'recent_10', 'all_major']).describe('要读取的摘要范围'),
  }),
  
  submit_proposal: z.object({
    scene_plan: z.array(z.object({
      purpose: z.string(),
      conflict: z.string(),
      new_info: z.string(),
    })).describe('场景规划序列'),
    chapter_text: z.string().describe('本章草稿文本'),
    review_notes: z.string().describe('需要作者注意的审阅备注'),
  }),
  
  run_qc: z.object({
    chapter_text: z.string().describe('需要进行质量检查的章节文本'),
  }),
  
  search_references: z.object({
    query: z.string().describe('要在设定集和参考资料中搜索的关键词'),
  })
};

// Helper to convert Zod schema to JSON Schema for the LLM
import { zodToJsonSchema } from 'zod-to-json-schema';

export const AgentTools: ToolDefinition[] = [
  {
    name: 'read_story_vault',
    description: '查询故事资料库。获取活跃主线/支线剧情、待回收伏笔、因果链、近期重要事件。用于理解当前故事状态。',
    parameters: zodToJsonSchema(ToolSchemas.read_story_vault) as Record<string, any>,
  },
  {
    name: 'read_chapter',
    description: '读取某一特定章节的原文内容，以获取局部细节。不要一次性请求太多章节。',
    parameters: zodToJsonSchema(ToolSchemas.read_chapter) as Record<string, any>,
  },
  {
    name: 'read_summary',
    description: '读取章节滚动摘要，用于了解最近几章的发展或全书大纲概要，比读取原文更省 token。',
    parameters: zodToJsonSchema(ToolSchemas.read_summary) as Record<string, any>,
  },
  {
    name: 'submit_proposal',
    description: '提交章节草稿和结构化提案。这会结束你的写作任务并向作者请求审查确认。',
    parameters: zodToJsonSchema(ToolSchemas.submit_proposal) as Record<string, any>,
  },
  {
    name: 'run_qc',
    description: '对生成的草稿进行质量检查，从冲突强度、角色一致性、节奏等维度打分并给出修改建议。',
    parameters: zodToJsonSchema(ToolSchemas.run_qc) as Record<string, any>,
  },
  {
    name: 'search_references',
    description: '搜索项目中的设定集和参考资料（如角色设定、世界观词典）。',
    parameters: zodToJsonSchema(ToolSchemas.search_references) as Record<string, any>,
  }
];
