/**
 * Engine bridge — integrates with the full novel-copilot chapter generation engine.
 *
 * This module wraps the enhanced chapter engine and AI config resolution
 * so the MCP server can trigger actual AI-powered chapter generation.
 */

import type Database from 'better-sqlite3';
import type { AIConfig } from '../types.js';

export { getDb } from './db.js';

/**
 * Resolve AI config from the model registry or environment variables.
 */
export function resolveAiConfig(db: Database.Database, featureKey?: string): AIConfig | null {
  // Priority 1: Environment variables
  if (process.env.AI_API_KEY) {
    return {
      provider: (process.env.AI_PROVIDER || 'openai') as AIConfig['provider'],
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      apiKey: process.env.AI_API_KEY,
      baseUrl: process.env.AI_BASE_URL,
    };
  }

  // Priority 2: Database model registry
  try {
    const key = featureKey || 'chapter_generation';
    let model: any = null;

    const mapping = db.prepare(`
      SELECT m.*, p.api_key_encrypted as provider_api_key, p.base_url as provider_base_url, p.id as provider_id
      FROM feature_model_mappings fmm
      JOIN model_registry m ON fmm.model_id = m.id
      JOIN provider_registry p ON m.provider_id = p.id
      WHERE fmm.feature_key = ? AND m.is_active = 1
    `).get(key);

    if (mapping) {
      model = mapping;
    } else {
      model = db.prepare(`
        SELECT m.*, p.api_key_encrypted as provider_api_key, p.base_url as provider_base_url, p.id as provider_id
        FROM model_registry m
        JOIN provider_registry p ON m.provider_id = p.id
        WHERE m.is_active = 1
        ORDER BY m.is_default DESC
        LIMIT 1
      `).get();
    }

    if (!model) return null;

    return {
      provider: model.provider_id as AIConfig['provider'],
      model: model.model_name,
      apiKey: model.provider_api_key || '',
      baseUrl: model.provider_base_url || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve fallback AI configs from the registry.
 */
export function resolveFallbackConfigs(db: Database.Database, excludeModel: string): AIConfig[] {
  try {
    const results = db.prepare(`
      SELECT m.*, p.api_key_encrypted as provider_api_key, p.base_url as provider_base_url, p.id as provider_id
      FROM model_registry m
      JOIN provider_registry p ON m.provider_id = p.id
      WHERE m.is_active = 1 AND m.model_name != ?
      ORDER BY m.is_default DESC
      LIMIT 3
    `).all(excludeModel) as any[];

    return results.map((model: any) => ({
      provider: model.provider_id as AIConfig['provider'],
      model: model.model_name,
      apiKey: model.provider_api_key || '',
      baseUrl: model.provider_base_url || undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Load project data needed for chapter generation.
 */
export function loadProjectForGeneration(db: Database.Database, projectId: string) {
  const project = db.prepare(`
    SELECT p.*, s.total_chapters, s.next_chapter_index, s.min_chapter_words,
           s.rolling_summary, s.open_loops
    FROM projects p
    LEFT JOIN states s ON s.project_id = p.id
    WHERE p.id = ? AND p.deleted_at IS NULL
  `).get(projectId) as any;

  if (!project) return null;

  // Load recent chapters
  const nextIdx = project.next_chapter_index || 1;
  const recentChapters = db.prepare(`
    SELECT content FROM chapters
    WHERE project_id = ? AND chapter_index >= ? AND chapter_index < ?
    ORDER BY chapter_index ASC
  `).all(projectId, Math.max(1, nextIdx - 2), nextIdx) as any[];

  // Load outline
  const outlineRow = db.prepare(`SELECT outline_json FROM outlines WHERE project_id = ?`).get(projectId) as any;

  // Load characters
  const charsRow = db.prepare(`SELECT characters_json FROM characters WHERE project_id = ?`).get(projectId) as any;

  return {
    project,
    bible: project.bible,
    rollingSummary: project.rolling_summary || '',
    openLoops: JSON.parse(project.open_loops || '[]') as string[],
    lastChapters: recentChapters.map((r: any) => r.content),
    chapterIndex: nextIdx,
    totalChapters: project.total_chapters,
    minChapterWords: project.min_chapter_words || 2500,
    chapterPromptProfile: project.chapter_prompt_profile,
    chapterPromptCustom: project.chapter_prompt_custom,
    outline: outlineRow ? JSON.parse(outlineRow.outline_json) : null,
    characters: charsRow ? JSON.parse(charsRow.characters_json) : null,
  };
}
