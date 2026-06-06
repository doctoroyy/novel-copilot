/**
 * Session memory tools — persistent memory for agent conversations
 *
 * Stores notes, decisions, and creative directions across sessions.
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
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      expires_at INTEGER DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memory_project ON agent_memory(project_id, category);
  `);
}

export function registerMemoryTools(server: McpServer, db: DbInstance) {
  ensureMemoryTable(db);

  server.tool(
    'memory_save',
    'Save a note, decision, or creative direction to persistent memory for future reference',
    {
      project_id: z.string().describe('Project ID'),
      category: z.enum(['note', 'decision', 'direction', 'feedback', 'todo']).describe('Memory category'),
      content: z.string().describe('Content to remember'),
      metadata: z.string().optional().describe('Optional JSON metadata'),
    },
    async ({ project_id, category, content, metadata }) => {
      db.prepare(`
        INSERT INTO agent_memory (project_id, category, content, metadata)
        VALUES (?, ?, ?, ?)
      `).run(project_id, category, content, metadata || '{}');

      return { content: [{ type: 'text' as const, text: `Saved to memory [${category}]` }] };
    },
  );

  server.tool(
    'memory_search',
    'Search persistent memory by project and optional category',
    {
      project_id: z.string().describe('Project ID'),
      category: z.enum(['note', 'decision', 'direction', 'feedback', 'todo', 'all']).default('all').describe('Category filter'),
      limit: z.number().default(20).describe('Max results'),
    },
    async ({ project_id, category, limit }) => {
      const query = category === 'all'
        ? db.prepare(`SELECT * FROM agent_memory WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`)
        : db.prepare(`SELECT * FROM agent_memory WHERE project_id = ? AND category = ? ORDER BY created_at DESC LIMIT ?`);

      const rows = category === 'all'
        ? query.all(project_id, limit) as any[]
        : query.all(project_id, category, limit) as any[];

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(rows.map(r => ({
            id: r.id,
            category: r.category,
            content: r.content,
            metadata: JSON.parse(r.metadata || '{}'),
            createdAt: r.created_at,
          })), null, 2),
        }],
      };
    },
  );

  server.tool(
    'memory_delete',
    'Delete a memory entry by ID',
    { id: z.number().describe('Memory entry ID') },
    async ({ id }) => {
      db.prepare(`DELETE FROM agent_memory WHERE id = ?`).run(id);
      return { content: [{ type: 'text' as const, text: `Deleted memory #${id}` }] };
    },
  );
}
