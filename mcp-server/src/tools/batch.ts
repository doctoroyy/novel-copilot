/**
 * Batch tools — trigger batch chapter generation
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerBatchTools(server: McpServer, db: DbInstance) {
  server.tool(
    'batch_status',
    'Get the current batch generation status for a project',
    { project_id: z.string().describe('Project ID') },
    async ({ project_id }) => {
      const state = db.prepare(`
        SELECT next_chapter_index, total_chapters, need_human, need_human_reason
        FROM states WHERE project_id = ?
      `).get(project_id) as any;

      if (!state) {
        return { content: [{ type: 'text' as const, text: 'Project state not found' }], isError: true };
      }

      const chapterCount = (db.prepare(`
        SELECT COUNT(*) as count FROM chapters WHERE project_id = ?
      `).get(project_id) as any)?.count || 0;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            projectId: project_id,
            chaptersWritten: chapterCount,
            totalPlanned: state.total_chapters,
            nextChapterIndex: state.next_chapter_index,
            progress: `${chapterCount}/${state.total_chapters}`,
            needHuman: !!state.need_human,
            needHumanReason: state.need_human_reason,
          }, null, 2),
        }],
      };
    },
  );

  // Note: actual batch generation requires the full engine (AI providers, etc.)
  // This tool provides status; actual generation is orchestrated by the agent via
  // repeated chapter_write calls or by invoking the engine externally.
}
