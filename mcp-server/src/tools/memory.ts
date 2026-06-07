/**
 * 记忆与设定管理工具 — 持久化创作决策和知识
 *
 * Agent 需要跨会话记住的东西：之前做的决策、用户偏好、
 * 创作笔记、角色关系变化等。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

function ensureMemoryTable(db: DbInstance) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'note',
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memory_project ON agent_memory(project_id, category);
  `);
}

export function registerMemoryTools(server: McpServer, db: DbInstance) {
  ensureMemoryTable(db);

  server.tool(
    'remember',
    '记住一条创作决策、用户偏好或重要笔记。跨会话持久化。',
    {
      project_id: z.string().describe('项目 ID'),
      category: z.enum(['decision', 'style_pref', 'plot_note', 'character_note', 'user_feedback', 'todo'])
        .describe('类型：决策/风格偏好/剧情笔记/角色笔记/用户反馈/待办'),
      content: z.string().describe('要记住的内容'),
    },
    async ({ project_id, category, content }) => {
      db.prepare(`
        INSERT INTO agent_memory (project_id, category, content)
        VALUES (?, ?, ?)
      `).run(project_id, category, content);

      return { content: [{ type: 'text' as const, text: `📝 已记录 [${category}]` }] };
    },
  );

  server.tool(
    'recall',
    '回忆之前记录的信息。不带 category 返回所有。',
    {
      project_id: z.string().describe('项目 ID'),
      category: z.enum(['decision', 'style_pref', 'plot_note', 'character_note', 'user_feedback', 'todo', 'all'])
        .default('all')
        .describe('过滤类型'),
      limit: z.number().default(20).describe('最多返回几条'),
    },
    async ({ project_id, category, limit }) => {
      const query = category === 'all'
        ? db.prepare(`SELECT * FROM agent_memory WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`)
        : db.prepare(`SELECT * FROM agent_memory WHERE project_id = ? AND category = ? ORDER BY created_at DESC LIMIT ?`);

      const rows = (category === 'all'
        ? query.all(project_id, limit)
        : query.all(project_id, category, limit)) as any[];

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: '无记录。' }] };
      }

      const text = rows.map(r => {
        const date = new Date(r.created_at).toLocaleDateString('zh-CN');
        return `- [${r.category}] ${r.content} _(${date})_`;
      }).join('\n');

      return { content: [{ type: 'text' as const, text: `# 创作记忆\n\n${text}` }] };
    },
  );

  server.tool(
    'update_outline',
    '更新项目大纲。大纲以 JSON 格式存储。',
    {
      project_id: z.string().describe('项目 ID'),
      outline_json: z.string().describe('完整大纲 JSON'),
    },
    async ({ project_id, outline_json }) => {
      try { JSON.parse(outline_json); } catch {
        return { content: [{ type: 'text' as const, text: 'JSON 格式无效' }], isError: true };
      }

      db.prepare(`
        INSERT INTO outlines (project_id, outline_json, updated_at)
        VALUES (?, ?, unixepoch() * 1000)
        ON CONFLICT(project_id) DO UPDATE SET
          outline_json = excluded.outline_json, updated_at = excluded.updated_at
      `).run(project_id, outline_json);

      return { content: [{ type: 'text' as const, text: '✅ 大纲已更新' }] };
    },
  );

  server.tool(
    'update_characters',
    '更新项目角色档案。',
    {
      project_id: z.string().describe('项目 ID'),
      characters_json: z.string().describe('完整角色数据 JSON'),
    },
    async ({ project_id, characters_json }) => {
      try { JSON.parse(characters_json); } catch {
        return { content: [{ type: 'text' as const, text: 'JSON 格式无效' }], isError: true };
      }

      db.prepare(`
        INSERT INTO characters (project_id, characters_json, updated_at)
        VALUES (?, ?, unixepoch() * 1000)
        ON CONFLICT(project_id) DO UPDATE SET
          characters_json = excluded.characters_json, updated_at = excluded.updated_at
      `).run(project_id, characters_json);

      return { content: [{ type: 'text' as const, text: '✅ 角色档案已更新' }] };
    },
  );
}
