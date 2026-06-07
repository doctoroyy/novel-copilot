/**
 * Novel Copilot MCP Server — Server definition
 *
 * 工具设计哲学 v2:
 * - 引擎级质量检测：与内部 ReAct agent 使用相同的规则和启发式
 * - 动态规则注入：写作规则根据章节位置/节奏类型/叙事阶段动态生成
 * - 节奏曲线控制：三幕结构数学模型计算每章紧张度目标
 * - 一次调用完备：prepare 包含规则+节奏+护栏，agent 无需额外查询
 * - 零 AI 成本评估：8项量化指标 + 弃书红线检测，无需 AI 调用
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from './bridge/db.js';
import { registerPrepareTools } from './tools/prepare.js';
import { registerAnalyzeTools } from './tools/analyze.js';
import { registerEvaluateTools } from './tools/evaluate.js';
import { registerCommitTools } from './tools/commit.js';
import { registerMemoryTools } from './tools/memory.js';
import { registerRulesTools } from './tools/rules.js';
import { registerResources } from './resources/novel.js';
import { registerPrompts } from './prompts/templates.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'novel-copilot',
    version: '0.3.0',
  });

  const db = getDb();

  // === 创作流程工具 ===
  // 1. Prepare: 完整 briefing (含规则+节奏+护栏)
  // 2. Rules: 独立获取写作规则和节奏指导
  // 3. Analyze: 故事健康度分析
  // 4. Write (agent 自身创作)
  // 5. Evaluate: 引擎级质量评估 (8项指标+弃书红线)
  // 6. Commit: 保存+状态更新
  registerPrepareTools(server, db);   // prepare_writing_context, list_projects
  registerRulesTools(server, db);     // get_writing_rules, get_pacing_guidance, list_narrative_types
  registerAnalyzeTools(server, db);   // analyze_story_health, analyze_last_chapter_ending, suggest_chapter_direction
  registerEvaluateTools(server, db);  // evaluate_chapter, check_continuity
  registerCommitTools(server, db);    // commit_chapter, commit_summary, read_chapter, export_novel
  registerMemoryTools(server, db);    // remember, recall, update_outline, update_characters

  // Resources & Prompts
  registerResources(server, db);
  registerPrompts(server);

  return server;
}
