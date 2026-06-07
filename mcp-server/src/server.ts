/**
 * Novel Copilot MCP Server — Server definition
 *
 * 工具设计哲学：
 * - 不做 CRUD 搬运工，做创作流程的智能助手
 * - 一次调用获得可用上下文（prepare），不让 agent 自己拼装
 * - 评估工具给出可操作建议（evaluate），不只是通过/不通过
 * - 分析工具提供创作洞察（analyze），辅助 agent 决策
 * - 提交工具管理交付（commit），自动维护状态
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from './bridge/db.js';
import { registerPrepareTools } from './tools/prepare.js';
import { registerAnalyzeTools } from './tools/analyze.js';
import { registerEvaluateTools } from './tools/evaluate.js';
import { registerCommitTools } from './tools/commit.js';
import { registerMemoryTools } from './tools/memory.js';
import { registerResources } from './resources/novel.js';
import { registerPrompts } from './prompts/templates.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'novel-copilot',
    version: '0.2.0',
  });

  const db = getDb();

  // === 创作流程工具 ===
  // 1. Prepare: 获取上下文 → 2. Analyze: 分析决策 → 3. Write (agent自身) → 4. Evaluate: 质量检查 → 5. Commit: 保存
  registerPrepareTools(server, db);   // prepare_writing_context, list_projects
  registerAnalyzeTools(server, db);   // analyze_story_health, analyze_last_chapter_ending, suggest_chapter_direction
  registerEvaluateTools(server, db);  // evaluate_chapter, check_continuity
  registerCommitTools(server, db);    // commit_chapter, commit_summary, read_chapter, export_novel
  registerMemoryTools(server, db);    // remember, recall, update_outline, update_characters

  // Resources & Prompts
  registerResources(server, db);
  registerPrompts(server);

  return server;
}
