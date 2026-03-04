/**
 * ReAct Agent 工具定义
 */

import type { ToolDefinition } from './types.js';
import type { PlotGraph } from '../types/plotGraph.js';
import type { CharacterStateRegistry } from '../types/characterState.js';
import type { TimelineState } from '../types/timeline.js';
import type { NarrativeGuide, EnhancedChapterOutline } from '../types/narrative.js';

/** 工具执行上下文 — 传入现有的各种状态 */
export type ToolContext = {
  bible: string;
  plotGraph?: PlotGraph;
  characterStates?: CharacterStateRegistry;
  timeline?: TimelineState;
  narrativeGuide?: NarrativeGuide;
  rollingSummary: string;
  openLoops: string[];
  lastChapters: string[];
  chapterIndex: number;
  totalChapters: number;
  enhancedOutline?: EnhancedChapterOutline;
};

/** AI 增强工具名称列表（消耗 AI 调用预算） */
export const AI_TOOLS = new Set([
  'query_reader_expectations',
  'design_scene_sequence',
  'evaluate_draft',
  'write_chapter',
  'rewrite_section',
]);

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'query_plot_graph',
    description: '查询剧情图谱。获取活跃主线/支线剧情、待回收伏笔、因果链、近期重要事件。用于理解当前故事状态。',
    parameters: {
      aspect: {
        type: 'string',
        description: '要查询的方面',
        enum: ['active_plots', 'pending_foreshadowing', 'causal_chains', 'recent_events', 'full_summary'],
        required: true,
      },
    },
  },
  {
    name: 'query_character_state',
    description: '查询角色当前状态。包括位置、身体状况、情绪、动机、近期变化。',
    parameters: {
      character_name: {
        type: 'string',
        description: '角色名称，传 "all" 查询所有活跃角色',
        required: true,
      },
    },
  },
  {
    name: 'query_timeline',
    description: '查询时间线上的已发生事件。用于避免重复和保持连续性。',
    parameters: {
      scope: {
        type: 'string',
        description: '查询范围',
        enum: ['recent_5', 'recent_10', 'all_major'],
        required: true,
      },
    },
  },
  {
    name: 'query_reader_expectations',
    description: '模拟读者视角，分析读者此刻的预期、疑问和情感状态。基于已有的摘要和伏笔推断。',
    parameters: {},
  },
  {
    name: 'analyze_conflict_density',
    description: '分析最近 N 章的冲突密度和类型分布，判断是否需要升级冲突或引入新冲突。',
    parameters: {
      lookback_chapters: {
        type: 'number',
        description: '回看章数，默认5',
      },
    },
  },
  {
    name: 'check_foreshadowing_opportunities',
    description: '检查当前章节有哪些伏笔可以回收，以及是否需要植入新伏笔。',
    parameters: {},
  },
  {
    name: 'design_scene_sequence',
    description: '设计本章的场景序列。输入整体目标，输出场景级的详细计划。',
    parameters: {
      goal: {
        type: 'string',
        description: '本章的核心目标',
        required: true,
      },
      constraints: {
        type: 'string',
        description: '额外约束（如节奏要求、必须包含的元素等）',
      },
    },
  },
  {
    name: 'evaluate_draft',
    description: '评估已生成的草稿。从冲突强度、角色行为一致性、节奏、读者体验等维度打分。',
    parameters: {
      focus: {
        type: 'string',
        description: '重点评估维度',
        enum: ['conflict', 'character_consistency', 'pacing', 'reader_engagement', 'all'],
      },
    },
  },
  {
    name: 'rewrite_section',
    description: '定向重写草稿中的某个片段，而不是整章重写。',
    parameters: {
      section: {
        type: 'string',
        description: '要重写的片段标识（如 "opening", "climax", "ending", 或具体的场景编号）',
        required: true,
      },
      guidance: {
        type: 'string',
        description: '重写指引',
        required: true,
      },
    },
  },
  {
    name: 'write_chapter',
    description: '执行实际的章节写作。在你完成了足够的调研和规划后调用此工具。',
    parameters: {
      scene_plan: {
        type: 'string',
        description: '详细的场景计划（JSON 格式）',
        required: true,
      },
      writing_notes: {
        type: 'string',
        description: '写作注意事项和特别指示',
        required: true,
      },
    },
  },
  {
    name: 'finish',
    description: '确认最终输出。当你对章节质量满意时调用此工具提交最终版本。',
    parameters: {
      chapter_text: {
        type: 'string',
        description: '最终章节文本',
        required: true,
      },
    },
  },
];
