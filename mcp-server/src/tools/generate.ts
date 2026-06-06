/**
 * Generate tools — invoke the actual AI engine for chapter generation
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';
import type { EnhancedWriteChapterResult } from '../types.js';
import { resolveAiConfig, resolveFallbackConfigs, loadProjectForGeneration } from '../bridge/engine.js';

export function registerGenerateTools(server: McpServer, db: DbInstance) {
  server.tool(
    'generate_chapter_engine',
    'Generate a chapter using the full AI engine (enhanced chapter engine with planning, QC, and auto-repair). Requires AI provider configured in the database or environment.',
    {
      project_id: z.string().describe('Project ID'),
      chapter_index: z.number().optional().describe('Chapter index (defaults to next chapter)'),
      goal_hint: z.string().optional().describe('Optional creative direction for this chapter'),
      enable_qc: z.boolean().default(true).describe('Enable quality checks and auto-repair'),
    },
    async ({ project_id, chapter_index, goal_hint, enable_qc }) => {
      // Resolve AI config
      const aiConfig = resolveAiConfig(db);
      if (!aiConfig) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No AI configuration found. Set AI_API_KEY/AI_MODEL env vars or configure a provider in the database.',
          }],
          isError: true,
        };
      }

      // Load project data
      const projectData = loadProjectForGeneration(db, project_id);
      if (!projectData) {
        return {
          content: [{ type: 'text' as const, text: `Project not found: ${project_id}` }],
          isError: true,
        };
      }

      const targetIndex = chapter_index || projectData.chapterIndex;

      try {
        // Dynamic import of the engine (it has heavy dependencies)
        const enginePath = new URL('../../../src/enhancedChapterEngine.js', import.meta.url).pathname;
        const { writeEnhancedChapter } = await import(enginePath);

        const fallbackConfigs = resolveFallbackConfigs(db, aiConfig.model);

        const result = await writeEnhancedChapter({
          aiConfig,
          fallbackConfigs,
          bible: projectData.bible,
          rollingSummary: projectData.rollingSummary,
          openLoops: projectData.openLoops,
          lastChapters: projectData.lastChapters,
          chapterIndex: targetIndex,
          totalChapters: projectData.totalChapters,
          minChapterWords: projectData.minChapterWords,
          chapterGoalHint: goal_hint,
          chapterPromptProfile: projectData.chapterPromptProfile,
          chapterPromptCustom: projectData.chapterPromptCustom,
          enableFullQC: enable_qc,
          enableAutoRepair: enable_qc,
          enablePlanning: true,
          enableSelfReview: true,
          enableContextOptimization: true,
        }) as EnhancedWriteChapterResult;

        // Save the chapter
        const title = result.chapterText.split('\n')[0]?.replace(/^#+\s*/, '').trim() || `第${targetIndex}章`;
        const content = result.chapterText;
        const wordCount = content.replace(/\s/g, '').length;

        db.prepare(`
          INSERT INTO chapters (project_id, chapter_index, title, content, word_count, created_at)
          VALUES (?, ?, ?, ?, ?, unixepoch() * 1000)
          ON CONFLICT(project_id, chapter_index) DO UPDATE SET
            title = excluded.title, content = excluded.content, word_count = excluded.word_count
        `).run(project_id, targetIndex, title, content, wordCount);

        // Update state
        db.prepare(`
          UPDATE states SET
            next_chapter_index = ?,
            rolling_summary = ?,
            open_loops = ?
          WHERE project_id = ?
        `).run(targetIndex + 1, result.updatedSummary, JSON.stringify(result.updatedOpenLoops), project_id);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              chapterIndex: targetIndex,
              title,
              wordCount,
              wasRewritten: result.wasRewritten,
              rewriteCount: result.rewriteCount,
              generationDurationMs: result.generationDurationMs,
              qcPassed: result.qcResult ? result.qcResult.overallPass : null,
              updatedOpenLoops: result.updatedOpenLoops,
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text' as const,
            text: `Engine generation failed: ${error.message}\n\nFallback: use chapter_write to manually save a chapter.`,
          }],
          isError: true,
        };
      }
    },
  );
}
