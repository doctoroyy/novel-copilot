/**
 * Project tools — list and read novel projects
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerProjectTools(server: McpServer, db: DbInstance) {
  server.tool(
    'project_list',
    'List all novel projects with their basic info',
    {},
    async () => {
      const rows = db.prepare(`
        SELECT p.id, p.name, p.bible, p.chapter_prompt_profile,
               s.total_chapters, s.next_chapter_index, s.min_chapter_words
        FROM projects p
        LEFT JOIN states s ON s.project_id = p.id
        WHERE p.deleted_at IS NULL
        ORDER BY p.created_at DESC
      `).all() as any[];

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(rows.map(r => ({
            id: r.id,
            name: r.name,
            totalChapters: r.total_chapters,
            currentChapter: (r.next_chapter_index || 1) - 1,
            minChapterWords: r.min_chapter_words,
            promptProfile: r.chapter_prompt_profile,
          })), null, 2),
        }],
      };
    },
  );

  server.tool(
    'project_get',
    'Get full details of a novel project including bible, state, and settings',
    { project_id: z.string().describe('Project ID') },
    async ({ project_id }) => {
      const project = db.prepare(`
        SELECT p.*, s.total_chapters, s.next_chapter_index, s.min_chapter_words,
               s.rolling_summary, s.open_loops, s.need_human, s.need_human_reason
        FROM projects p
        LEFT JOIN states s ON s.project_id = p.id
        WHERE p.id = ? AND p.deleted_at IS NULL
      `).get(project_id) as any;

      if (!project) {
        return { content: [{ type: 'text' as const, text: `Project not found: ${project_id}` }], isError: true };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            id: project.id,
            name: project.name,
            bible: project.bible,
            promptProfile: project.chapter_prompt_profile,
            promptCustom: project.chapter_prompt_custom,
            state: {
              totalChapters: project.total_chapters,
              currentChapter: (project.next_chapter_index || 1) - 1,
              minChapterWords: project.min_chapter_words,
              rollingSummary: project.rolling_summary,
              openLoops: JSON.parse(project.open_loops || '[]'),
              needHuman: !!project.need_human,
              needHumanReason: project.need_human_reason,
            },
          }, null, 2),
        }],
      };
    },
  );
}
