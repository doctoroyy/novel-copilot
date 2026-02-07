/**
 * 上下文工程 API 路由
 *
 * 管理:
 * - 人物状态 (Character States)
 * - 剧情图谱 (Plot Graph)
 * - 叙事配置 (Narrative Config)
 * - QC 结果 (QC Results)
 */

import { Hono } from 'hono';
import type { Env } from '../worker.js';
import type { AIConfig } from '../services/aiClient.js';
import type { CharacterStateRegistry } from '../types/characterState.js';
import type { PlotGraph } from '../types/plotGraph.js';
import type { NarrativeArc } from '../types/narrative.js';
import {
  initializeRegistryFromGraph,
  manualUpdateCharacterState,
  buildCharacterStateContext,
} from '../context/characterStateManager.js';
import {
  createEmptyPlotGraph,
  updatePendingForeshadowing,
} from '../types/plotGraph.js';
import {
  manualAddForeshadowing,
  manualResolveForeshadowing,
  buildPlotContext,
  getGraphStats,
} from '../context/plotManager.js';
import {
  generateNarrativeArc,
  getPacingCurveData,
} from '../narrative/pacingController.js';
import { formatQCResult } from '../qc/multiDimensionalQC.js';

export const contextRoutes = new Hono<{ Bindings: Env }>();

// Helper to get AI config from headers
function getAIConfigFromHeaders(c: any): AIConfig | null {
  const provider = c.req.header('X-AI-Provider');
  const model = c.req.header('X-AI-Model');
  const apiKey = c.req.header('X-AI-Key');
  const baseUrl = c.req.header('X-AI-BaseUrl');

  if (!provider || !model || !apiKey) {
    return null;
  }

  return { provider: provider as AIConfig['provider'], model, apiKey, baseUrl };
}

// ==================== Character States API ====================

// Get character states for a project
contextRoutes.get('/projects/:name/character-states', async (c) => {
  const name = c.req.param('name');

  try {
    const result = await c.env.DB.prepare(`
      SELECT cs.registry_json, cs.last_updated_chapter
      FROM character_states cs
      JOIN projects p ON cs.project_id = p.id
      WHERE p.name = ? AND p.deleted_at IS NULL
    `).bind(name).first() as any;

    if (!result) {
      return c.json({ success: true, data: null, message: 'No character states found' });
    }

    const registry: CharacterStateRegistry = JSON.parse(result.registry_json);

    return c.json({
      success: true,
      data: {
        registry,
        lastUpdatedChapter: result.last_updated_chapter,
        stats: {
          totalCharacters: Object.keys(registry.snapshots).length,
          pendingUpdates: registry.pendingUpdates.length,
        },
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Initialize character states from character graph
contextRoutes.post('/projects/:name/character-states/initialize', async (c) => {
  const name = c.req.param('name');

  try {
    const project = await c.env.DB.prepare(`
      SELECT p.id, c.characters_json
      FROM projects p
      LEFT JOIN characters c ON p.id = c.project_id
      WHERE p.name = ? AND p.deleted_at IS NULL
    `).bind(name).first() as any;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    if (!project.characters_json) {
      return c.json({ success: false, error: 'No character graph found' }, 400);
    }

    const characters = JSON.parse(project.characters_json);
    const registry = initializeRegistryFromGraph(characters);

    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO character_states (project_id, registry_json, last_updated_chapter)
      VALUES (?, ?, 0)
    `).bind(project.id, JSON.stringify(registry)).run();

    return c.json({
      success: true,
      data: {
        initialized: Object.keys(registry.snapshots).length,
        characters: Object.keys(registry.snapshots),
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Manually update a character's state
contextRoutes.put('/projects/:name/character-states/:characterId', async (c) => {
  const name = c.req.param('name');
  const characterId = c.req.param('characterId');

  try {
    const updates = await c.req.json();

    const result = await c.env.DB.prepare(`
      SELECT cs.registry_json, p.id as project_id, s.next_chapter_index
      FROM character_states cs
      JOIN projects p ON cs.project_id = p.id
      JOIN states s ON p.id = s.project_id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!result) {
      return c.json({ success: false, error: 'Character states not found' }, 404);
    }

    const registry: CharacterStateRegistry = JSON.parse(result.registry_json);
    const chapterIndex = result.next_chapter_index - 1;

    const updatedRegistry = manualUpdateCharacterState(
      registry,
      characterId,
      updates,
      chapterIndex
    );

    await c.env.DB.prepare(`
      UPDATE character_states SET registry_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ?
    `).bind(JSON.stringify(updatedRegistry), result.project_id).run();

    return c.json({
      success: true,
      data: {
        updated: characterId,
        snapshot: updatedRegistry.snapshots[characterId],
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get character state context for prompt
contextRoutes.get('/projects/:name/character-states/context', async (c) => {
  const name = c.req.param('name');
  const chapterIndex = parseInt(c.req.query('chapter') || '1');

  try {
    const result = await c.env.DB.prepare(`
      SELECT cs.registry_json
      FROM character_states cs
      JOIN projects p ON cs.project_id = p.id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!result) {
      return c.json({ success: true, context: '' });
    }

    const registry: CharacterStateRegistry = JSON.parse(result.registry_json);
    const context = buildCharacterStateContext(registry, chapterIndex);

    return c.json({ success: true, context });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==================== Plot Graph API ====================

// Get plot graph for a project
contextRoutes.get('/projects/:name/plot-graph', async (c) => {
  const name = c.req.param('name');

  try {
    const result = await c.env.DB.prepare(`
      SELECT pg.graph_json, pg.last_updated_chapter
      FROM plot_graphs pg
      JOIN projects p ON pg.project_id = p.id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!result) {
      return c.json({ success: true, data: null, message: 'No plot graph found' });
    }

    const graph: PlotGraph = JSON.parse(result.graph_json);
    const stats = getGraphStats(graph);

    return c.json({
      success: true,
      data: {
        graph,
        lastUpdatedChapter: result.last_updated_chapter,
        stats,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Initialize empty plot graph
contextRoutes.post('/projects/:name/plot-graph/initialize', async (c) => {
  const name = c.req.param('name');

  try {
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL
    `).bind(name).first() as any;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const graph = createEmptyPlotGraph();

    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO plot_graphs (project_id, graph_json, last_updated_chapter)
      VALUES (?, ?, 0)
    `).bind(project.id, JSON.stringify(graph)).run();

    return c.json({ success: true, data: graph });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Add foreshadowing manually
contextRoutes.post('/projects/:name/plot-graph/foreshadowing', async (c) => {
  const name = c.req.param('name');

  try {
    const { content, characters, importance = 5 } = await c.req.json();

    const result = await c.env.DB.prepare(`
      SELECT pg.graph_json, p.id as project_id, s.next_chapter_index, s.total_chapters
      FROM plot_graphs pg
      JOIN projects p ON pg.project_id = p.id
      JOIN states s ON p.id = s.project_id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!result) {
      return c.json({ success: false, error: 'Plot graph not found' }, 404);
    }

    const graph: PlotGraph = JSON.parse(result.graph_json);
    const chapterIndex = result.next_chapter_index - 1;

    const updatedGraph = manualAddForeshadowing(
      graph,
      content,
      characters || [],
      importance,
      chapterIndex,
      result.total_chapters
    );

    await c.env.DB.prepare(`
      UPDATE plot_graphs SET graph_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ?
    `).bind(JSON.stringify(updatedGraph), result.project_id).run();

    return c.json({
      success: true,
      data: {
        added: content,
        pendingForeshadowing: updatedGraph.pendingForeshadowing.length,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Resolve foreshadowing
contextRoutes.post('/projects/:name/plot-graph/foreshadowing/:nodeId/resolve', async (c) => {
  const name = c.req.param('name');
  const nodeId = c.req.param('nodeId');

  try {
    const result = await c.env.DB.prepare(`
      SELECT pg.graph_json, p.id as project_id, s.next_chapter_index, s.total_chapters
      FROM plot_graphs pg
      JOIN projects p ON pg.project_id = p.id
      JOIN states s ON p.id = s.project_id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!result) {
      return c.json({ success: false, error: 'Plot graph not found' }, 404);
    }

    const graph: PlotGraph = JSON.parse(result.graph_json);
    const chapterIndex = result.next_chapter_index - 1;

    const updatedGraph = manualResolveForeshadowing(graph, nodeId, chapterIndex, result.total_chapters);

    await c.env.DB.prepare(`
      UPDATE plot_graphs SET graph_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ?
    `).bind(JSON.stringify(updatedGraph), result.project_id).run();

    return c.json({
      success: true,
      data: {
        resolved: nodeId,
        remainingForeshadowing: updatedGraph.pendingForeshadowing.length,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get urgent foreshadowing reminders
contextRoutes.get('/projects/:name/plot-graph/foreshadowing/urgent', async (c) => {
  const name = c.req.param('name');

  try {
    const result = await c.env.DB.prepare(`
      SELECT pg.graph_json, s.next_chapter_index, s.total_chapters
      FROM plot_graphs pg
      JOIN projects p ON pg.project_id = p.id
      JOIN states s ON p.id = s.project_id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!result) {
      return c.json({ success: true, data: [] });
    }

    const graph: PlotGraph = JSON.parse(result.graph_json);
    const chapterIndex = result.next_chapter_index;

    // Update ages and get updated pending foreshadowing
    const updatedPending = updatePendingForeshadowing(graph, chapterIndex, result.total_chapters);
    const urgent = updatedPending.filter(
      (f) => f.urgency === 'critical' || f.urgency === 'high'
    );

    return c.json({
      success: true,
      data: urgent,
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get plot context for prompt
contextRoutes.get('/projects/:name/plot-graph/context', async (c) => {
  const name = c.req.param('name');
  const chapterIndex = parseInt(c.req.query('chapter') || '1');
  const totalChapters = parseInt(c.req.query('total') || '100');

  try {
    const result = await c.env.DB.prepare(`
      SELECT pg.graph_json
      FROM plot_graphs pg
      JOIN projects p ON pg.project_id = p.id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!result) {
      return c.json({ success: true, context: '' });
    }

    const graph: PlotGraph = JSON.parse(result.graph_json);
    const context = buildPlotContext(graph, chapterIndex, totalChapters);

    return c.json({ success: true, context });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==================== Narrative Config API ====================

// Get narrative config for a project
contextRoutes.get('/projects/:name/narrative', async (c) => {
  const name = c.req.param('name');

  try {
    const result = await c.env.DB.prepare(`
      SELECT nc.pacing_curve_json, nc.narrative_arc_json, s.total_chapters
      FROM narrative_config nc
      JOIN projects p ON nc.project_id = p.id
      JOIN states s ON p.id = s.project_id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!result) {
      return c.json({ success: true, data: null, message: 'No narrative config found' });
    }

    const narrativeArc = result.narrative_arc_json ? JSON.parse(result.narrative_arc_json) : null;
    const pacingCurve = result.pacing_curve_json ? JSON.parse(result.pacing_curve_json) : null;

    let pacingData = null;

    if (narrativeArc) {
      pacingData = getPacingCurveData(narrativeArc);
    }

    return c.json({
      success: true,
      data: {
        narrativeArc,
        pacingCurve,
        pacingData,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Generate narrative arc from outline
contextRoutes.post('/projects/:name/narrative/generate', async (c) => {
  const name = c.req.param('name');

  try {
    const result = await c.env.DB.prepare(`
      SELECT p.id, o.outline_json, s.total_chapters
      FROM projects p
      LEFT JOIN outlines o ON p.id = o.project_id
      JOIN states s ON p.id = s.project_id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!result) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    if (!result.outline_json) {
      return c.json({ success: false, error: 'Outline not found' }, 400);
    }

    const outline = JSON.parse(result.outline_json);
    const narrativeArc = generateNarrativeArc(outline.volumes || [], result.total_chapters);

    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO narrative_config (project_id, narrative_arc_json)
      VALUES (?, ?)
    `).bind(result.id, JSON.stringify(narrativeArc)).run();

    return c.json({
      success: true,
      data: {
        narrativeArc,
        volumeCount: narrativeArc.volumePacing.length,
        totalChapters: result.total_chapters,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get pacing curve visualization data
contextRoutes.get('/projects/:name/narrative/pacing-curve', async (c) => {
  const name = c.req.param('name');

  try {
    const result = await c.env.DB.prepare(`
      SELECT nc.narrative_arc_json, s.total_chapters
      FROM narrative_config nc
      JOIN projects p ON nc.project_id = p.id
      JOIN states s ON p.id = s.project_id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!result || !result.narrative_arc_json) {
      return c.json({ success: true, data: null });
    }

    const narrativeArc: NarrativeArc = JSON.parse(result.narrative_arc_json);
    const curveData = getPacingCurveData(narrativeArc);

    return c.json({
      success: true,
      data: curveData,
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==================== QC Results API ====================

// Get QC results for a project
contextRoutes.get('/projects/:name/qc', async (c) => {
  const name = c.req.param('name');

  try {
    const { results } = await c.env.DB.prepare(`
      SELECT qc.chapter_index, qc.passed, qc.score, qc.qc_json, qc.created_at
      FROM chapter_qc qc
      JOIN projects p ON qc.project_id = p.id
      WHERE p.name = ?
      ORDER BY qc.chapter_index
    `).bind(name).all();

    // Calculate summary stats
    const totalChecked = results.length;
    const passed = results.filter((r: any) => r.passed === 1).length;
    const avgScore = totalChecked > 0
      ? results.reduce((sum: number, r: any) => sum + r.score, 0) / totalChecked
      : 0;

    return c.json({
      success: true,
      data: {
        chapters: results.map((r: any) => ({
          chapter: r.chapter_index,
          passed: r.passed === 1,
          score: r.score,
          createdAt: r.created_at,
        })),
        summary: {
          totalChecked,
          passed,
          failed: totalChecked - passed,
          passRate: totalChecked > 0 ? (passed / totalChecked * 100).toFixed(1) + '%' : 'N/A',
          averageScore: avgScore.toFixed(1),
        },
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get detailed QC result for a specific chapter
contextRoutes.get('/projects/:name/qc/:chapter', async (c) => {
  const name = c.req.param('name');
  const chapter = parseInt(c.req.param('chapter'));

  try {
    const result = await c.env.DB.prepare(`
      SELECT qc.qc_json, qc.passed, qc.score
      FROM chapter_qc qc
      JOIN projects p ON qc.project_id = p.id
      WHERE p.name = ? AND qc.chapter_index = ?
    `).bind(name, chapter).first() as any;

    if (!result) {
      return c.json({ success: true, data: null, message: 'No QC result for this chapter' });
    }

    const qcResult = JSON.parse(result.qc_json);
    const formatted = formatQCResult(qcResult);

    return c.json({
      success: true,
      data: {
        chapter,
        passed: result.passed === 1,
        score: result.score,
        details: qcResult,
        formatted,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get context engineering overview for a project
contextRoutes.get('/projects/:name/context-overview', async (c) => {
  const name = c.req.param('name');

  try {
    const result = await c.env.DB.prepare(`
      SELECT
        p.id,
        s.next_chapter_index,
        s.total_chapters,
        cs.last_updated_chapter as char_states_chapter,
        pg.last_updated_chapter as plot_graph_chapter,
        nc.narrative_arc_json IS NOT NULL as has_narrative_arc
      FROM projects p
      JOIN states s ON p.id = s.project_id
      LEFT JOIN character_states cs ON p.id = cs.project_id
      LEFT JOIN plot_graphs pg ON p.id = pg.project_id
      LEFT JOIN narrative_config nc ON p.id = nc.project_id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!result) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // Get QC summary
    const qcResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total, SUM(passed) as passed, AVG(score) as avg_score
      FROM chapter_qc WHERE project_id = ?
    `).bind(result.id).first() as any;

    return c.json({
      success: true,
      data: {
        currentChapter: result.next_chapter_index - 1,
        totalChapters: result.total_chapters,
        systems: {
          characterStates: {
            enabled: result.char_states_chapter !== null,
            lastUpdated: result.char_states_chapter || 0,
          },
          plotGraph: {
            enabled: result.plot_graph_chapter !== null,
            lastUpdated: result.plot_graph_chapter || 0,
          },
          narrativeArc: {
            enabled: result.has_narrative_arc === 1,
          },
          qc: {
            chaptersChecked: qcResult?.total || 0,
            passed: qcResult?.passed || 0,
            averageScore: qcResult?.avg_score?.toFixed(1) || 'N/A',
          },
        },
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});
