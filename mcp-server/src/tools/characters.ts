/**
 * Character tools — read and manage character profiles
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerCharacterTools(server: McpServer, db: DbInstance) {
  server.tool(
    'characters_get',
    'Get all character profiles for a project',
    { project_id: z.string().describe('Project ID') },
    async ({ project_id }) => {
      const row = db.prepare(`
        SELECT characters_json FROM characters WHERE project_id = ?
      `).get(project_id) as any;

      if (!row) {
        return { content: [{ type: 'text' as const, text: 'No characters found' }] };
      }

      return { content: [{ type: 'text' as const, text: row.characters_json }] };
    },
  );

  server.tool(
    'characters_update',
    'Replace character profiles JSON for a project',
    {
      project_id: z.string().describe('Project ID'),
      characters_json: z.string().describe('Full characters data as JSON string'),
    },
    async ({ project_id, characters_json }) => {
      try {
        JSON.parse(characters_json);
      } catch {
        return { content: [{ type: 'text' as const, text: 'Invalid JSON' }], isError: true };
      }

      db.prepare(`
        INSERT INTO characters (project_id, characters_json, updated_at)
        VALUES (?, ?, unixepoch() * 1000)
        ON CONFLICT(project_id) DO UPDATE SET
          characters_json = excluded.characters_json,
          updated_at = excluded.updated_at
      `).run(project_id, characters_json);

      return { content: [{ type: 'text' as const, text: 'Characters updated successfully' }] };
    },
  );
}
