/**
 * Chapter tools — read, write, and generate chapters
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerChapterTools(server: McpServer, db: DbInstance) {
  server.tool(
    'chapter_list',
    'List all chapters for a project with their titles and word counts',
    { project_id: z.string().describe('Project ID') },
    async ({ project_id }) => {
      const rows = db.prepare(`
        SELECT chapter_index, title, word_count, created_at
        FROM chapters
        WHERE project_id = ?
        ORDER BY chapter_index ASC
      `).all(project_id) as any[];

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(rows.map(r => ({
            index: r.chapter_index,
            title: r.title,
            wordCount: r.word_count,
            createdAt: r.created_at,
          })), null, 2),
        }],
      };
    },
  );

  server.tool(
    'chapter_read',
    'Read the full content of a specific chapter',
    {
      project_id: z.string().describe('Project ID'),
      chapter_index: z.number().describe('Chapter index (1-based)'),
    },
    async ({ project_id, chapter_index }) => {
      const row = db.prepare(`
        SELECT title, content, word_count FROM chapters
        WHERE project_id = ? AND chapter_index = ?
      `).get(project_id, chapter_index) as any;

      if (!row) {
        return { content: [{ type: 'text' as const, text: `Chapter ${chapter_index} not found` }], isError: true };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `# ${row.title}\n\n${row.content}\n\n---\nWord count: ${row.word_count}`,
        }],
      };
    },
  );

  server.tool(
    'chapter_read_recent',
    'Read the N most recent chapters (for context continuity)',
    {
      project_id: z.string().describe('Project ID'),
      count: z.number().default(3).describe('Number of recent chapters to read'),
    },
    async ({ project_id, count }) => {
      const state = db.prepare(`SELECT next_chapter_index FROM states WHERE project_id = ?`).get(project_id) as any;
      const nextIdx = state?.next_chapter_index || 1;
      const startIdx = Math.max(1, nextIdx - count);

      const rows = db.prepare(`
        SELECT chapter_index, title, content, word_count FROM chapters
        WHERE project_id = ? AND chapter_index >= ? AND chapter_index < ?
        ORDER BY chapter_index ASC
      `).all(project_id, startIdx, nextIdx) as any[];

      const text = rows.map(r =>
        `## 第${r.chapter_index}章 ${r.title}\n\n${r.content}`
      ).join('\n\n---\n\n');

      return { content: [{ type: 'text' as const, text: text || 'No chapters found' }] };
    },
  );

  server.tool(
    'chapter_write',
    'Write or overwrite a chapter with given title and content',
    {
      project_id: z.string().describe('Project ID'),
      chapter_index: z.number().describe('Chapter index (1-based)'),
      title: z.string().describe('Chapter title'),
      content: z.string().describe('Full chapter content'),
    },
    async ({ project_id, chapter_index, title, content }) => {
      const wordCount = content.replace(/\s/g, '').length;

      db.prepare(`
        INSERT INTO chapters (project_id, chapter_index, title, content, word_count, created_at)
        VALUES (?, ?, ?, ?, ?, unixepoch() * 1000)
        ON CONFLICT(project_id, chapter_index) DO UPDATE SET
          title = excluded.title,
          content = excluded.content,
          word_count = excluded.word_count
      `).run(project_id, chapter_index, title, content, wordCount);

      // Advance next_chapter_index if needed
      const state = db.prepare(`SELECT next_chapter_index FROM states WHERE project_id = ?`).get(project_id) as any;
      if (state && chapter_index >= state.next_chapter_index) {
        db.prepare(`UPDATE states SET next_chapter_index = ? WHERE project_id = ?`)
          .run(chapter_index + 1, project_id);
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Chapter ${chapter_index} "${title}" saved (${wordCount} chars)`,
        }],
      };
    },
  );

  server.tool(
    'chapter_update_summary',
    'Update the rolling summary and open loops after writing new chapters',
    {
      project_id: z.string().describe('Project ID'),
      rolling_summary: z.string().describe('Updated rolling summary (800-1500 chars)'),
      open_loops: z.array(z.string()).describe('Updated list of unresolved plot threads (max 12)'),
    },
    async ({ project_id, rolling_summary, open_loops }) => {
      db.prepare(`
        UPDATE states SET rolling_summary = ?, open_loops = ? WHERE project_id = ?
      `).run(rolling_summary, JSON.stringify(open_loops), project_id);

      return { content: [{ type: 'text' as const, text: 'Summary and open loops updated' }] };
    },
  );
}
