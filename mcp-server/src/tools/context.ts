/**
 * Context tools — query plot graph, character state, timeline
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerContextTools(server: McpServer, db: DbInstance) {
  server.tool(
    'context_get_state',
    'Get the full narrative context state: rolling summary, open loops, and recent chapter summaries',
    { project_id: z.string().describe('Project ID') },
    async ({ project_id }) => {
      const state = db.prepare(`
        SELECT rolling_summary, open_loops, next_chapter_index
        FROM states WHERE project_id = ?
      `).get(project_id) as any;

      if (!state) {
        return { content: [{ type: 'text' as const, text: 'No state found' }], isError: true };
      }

      // Get recent summary memories
      const memories = db.prepare(`
        SELECT chapter_index, rolling_summary, open_loops
        FROM summary_memories
        WHERE project_id = ?
        ORDER BY chapter_index DESC
        LIMIT 3
      `).all(project_id) as any[];

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            currentSummary: state.rolling_summary,
            openLoops: JSON.parse(state.open_loops || '[]'),
            nextChapterIndex: state.next_chapter_index,
            recentMemorySnapshots: memories.map(m => ({
              chapterIndex: m.chapter_index,
              summary: m.rolling_summary,
              openLoops: JSON.parse(m.open_loops || '[]'),
            })),
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'context_plot_graph',
    'Query the plot graph: active plots, pending foreshadowing, causal chains',
    {
      project_id: z.string().describe('Project ID'),
      aspect: z.enum(['active_plots', 'pending_foreshadowing', 'causal_chains', 'full']).describe('Which aspect to query'),
    },
    async ({ project_id, aspect }) => {
      const row = db.prepare(`
        SELECT plot_graph_json FROM plot_graphs WHERE project_id = ?
      `).get(project_id) as any;

      if (!row) {
        return { content: [{ type: 'text' as const, text: 'No plot graph data available. The plot graph is built incrementally as chapters are generated.' }] };
      }

      const graph = JSON.parse(row.plot_graph_json);

      if (aspect === 'full') {
        return { content: [{ type: 'text' as const, text: JSON.stringify(graph, null, 2) }] };
      }

      const filtered = aspect === 'active_plots' ? graph.activePlots
        : aspect === 'pending_foreshadowing' ? graph.pendingForeshadowing
        : graph.causalChains;

      return { content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }] };
    },
  );

  server.tool(
    'context_character_state',
    'Query current character states: location, condition, motivation, recent changes',
    {
      project_id: z.string().describe('Project ID'),
      character_name: z.string().default('all').describe('Character name, or "all" for all active characters'),
    },
    async ({ project_id, character_name }) => {
      const row = db.prepare(`
        SELECT character_states_json FROM character_states WHERE project_id = ?
      `).get(project_id) as any;

      if (!row) {
        return { content: [{ type: 'text' as const, text: 'No character state data available' }] };
      }

      const states = JSON.parse(row.character_states_json);

      if (character_name === 'all') {
        return { content: [{ type: 'text' as const, text: JSON.stringify(states, null, 2) }] };
      }

      const charState = states[character_name] || states[Object.keys(states).find(k => k.includes(character_name)) || ''];
      if (!charState) {
        return { content: [{ type: 'text' as const, text: `Character "${character_name}" not found` }], isError: true };
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(charState, null, 2) }] };
    },
  );

  server.tool(
    'context_timeline',
    'Query timeline events to avoid repetition and maintain continuity',
    {
      project_id: z.string().describe('Project ID'),
      scope: z.enum(['recent_5', 'recent_10', 'all_major']).describe('How many events to return'),
    },
    async ({ project_id, scope }) => {
      const row = db.prepare(`
        SELECT timeline_json FROM timelines WHERE project_id = ?
      `).get(project_id) as any;

      if (!row) {
        return { content: [{ type: 'text' as const, text: 'No timeline data available' }] };
      }

      const timeline = JSON.parse(row.timeline_json);
      const events = timeline.events || [];

      let filtered: any[];
      switch (scope) {
        case 'recent_5':
          filtered = events.slice(-5);
          break;
        case 'recent_10':
          filtered = events.slice(-10);
          break;
        case 'all_major':
          filtered = events.filter((e: any) => e.importance === 'major' || e.importance === 'critical');
          break;
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }] };
    },
  );
}
