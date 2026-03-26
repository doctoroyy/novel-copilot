/**
 * ExploreAgent 工具定义
 */

import type { ToolDefinition } from '../types.js';
import type { AIConfig } from '../../services/aiClient.js';

/** ExploreAgent 工具执行上下文 */
export type ExploreToolContext = {
  db: D1Database;
  browserBinding?: Fetcher;
  aiConfig: AIConfig;
  fallbackConfigs?: AIConfig[];
  /** 用户输入的一句话创意 */
  concept: string;
  genre?: string;
  theme?: string;
  keywords?: string;
};

/** AI 增强工具（消耗 AI 调用预算） */
export const EXPLORE_AI_TOOLS = new Set([
  'analyze_and_generate',
]);

export const EXPLORE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_cached_templates',
    description: '在已有的每日模板快照中按关键词搜索历史热榜模板和排行数据。不消耗 AI 预算。',
    parameters: {
      query: {
        type: 'string',
        description: '搜索关键词，如"都市重生 投资"',
        required: true,
      },
    },
  },
  {
    name: 'search_fanqie_rank',
    description: '实时爬取番茄小说热榜数据。需要 FANQIE_BROWSER 可用。不消耗 AI 预算。',
    parameters: {
      category: {
        type: 'string',
        description: '筛选分类，如"都市""玄幻""系统"等。留空返回所有分类。',
      },
    },
  },
  {
    name: 'search_web',
    description: '通用网页搜索（Bing），搜索起点/番茄趋势、类型分析等。需要 FANQIE_BROWSER 可用。不消耗 AI 预算。',
    parameters: {
      query: {
        type: 'string',
        description: '搜索关键词',
        required: true,
      },
    },
  },
  {
    name: 'analyze_and_generate',
    description: '综合分析所有搜索数据 + 用户创意，生成定制化 Story Bible（Markdown 格式）。由于系统会自动读取上下文，你无需提供任何参数。',
    parameters: {},
  },
];
