/**
 * Outline tools — read and update novel outlines
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerOutlineTools(server: McpServer, db: DbInstance) {
  server.tool(
    'outline_get',
    'Get the structured outline for a project',
    { project_id: z.string().describe('Project ID') },
    async ({ project_id }) => {
      const row = db.prepare(`
        SELECT outline_json FROM outlines WHERE project_id = ?
      `).get(project_id) as any;

      if (!row) {
        return { content: [{ type: 'text' as const, text: 'No outline found for this project' }] };
      }

      return {
        content: [{ type: 'text' as const, text: row.outline_json }],
      };
    },
  );

  server.tool(
    'outline_update',
    'Replace the outline for a project with new structured JSON',
    {
      project_id: z.string().describe('Project ID'),
      outline_json: z.string().describe('Full outline as JSON string'),
    },
    async ({ project_id, outline_json }) => {
      // Validate JSON
      try {
        JSON.parse(outline_json);
      } catch {
        return { content: [{ type: 'text' as const, text: 'Invalid JSON' }], isError: true };
      }

      db.prepare(`
        INSERT INTO outlines (project_id, outline_json, updated_at)
        VALUES (?, ?, unixepoch() * 1000)
        ON CONFLICT(project_id) DO UPDATE SET
          outline_json = excluded.outline_json,
          updated_at = excluded.updated_at
      `).run(project_id, outline_json);

      return { content: [{ type: 'text' as const, text: 'Outline updated successfully' }] };
    },
  );
}
