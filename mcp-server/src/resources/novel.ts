/**
 * MCP Resources — expose novel project data as browseable resources
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerResources(server: McpServer, db: DbInstance) {
  // Resource templates for dynamic project content
  server.resource(
    'novel-project',
    'novel://project/{project_id}',
    { description: 'Full novel project snapshot including bible, state, and outline' },
    async (uri) => {
      const projectId = uri.pathname.split('/').pop();
      const project = db.prepare(`
        SELECT p.*, s.total_chapters, s.next_chapter_index, s.rolling_summary, s.open_loops
        FROM projects p LEFT JOIN states s ON s.project_id = p.id
        WHERE p.id = ? AND p.deleted_at IS NULL
      `).get(projectId) as any;

      if (!project) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'Project not found' }] };
      }

      const outline = db.prepare(`SELECT outline_json FROM outlines WHERE project_id = ?`).get(projectId) as any;
      const chars = db.prepare(`SELECT characters_json FROM characters WHERE project_id = ?`).get(projectId) as any;

      const snapshot = {
        name: project.name,
        bible: project.bible,
        state: {
          totalChapters: project.total_chapters,
          currentChapter: (project.next_chapter_index || 1) - 1,
          rollingSummary: project.rolling_summary,
          openLoops: JSON.parse(project.open_loops || '[]'),
        },
        outline: outline ? JSON.parse(outline.outline_json) : null,
        characters: chars ? JSON.parse(chars.characters_json) : null,
      };

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(snapshot, null, 2),
        }],
      };
    },
  );
}
