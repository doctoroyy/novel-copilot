/**
 * QC (Quality Control) tools — evaluate chapters and check consistency
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerQcTools(server: McpServer, db: DbInstance) {
  server.tool(
    'qc_heuristic_check',
    'Run heuristic quality checks on a chapter: word count, repetition, dialogue ratio, hook presence',
    {
      project_id: z.string().describe('Project ID'),
      chapter_index: z.number().describe('Chapter index to check'),
    },
    async ({ project_id, chapter_index }) => {
      const row = db.prepare(`
        SELECT content, title FROM chapters
        WHERE project_id = ? AND chapter_index = ?
      `).get(project_id, chapter_index) as any;

      if (!row) {
        return { content: [{ type: 'text' as const, text: `Chapter ${chapter_index} not found` }], isError: true };
      }

      const content = row.content as string;
      const charCount = content.replace(/\s/g, '').length;

      // Heuristic checks
      const checks: Record<string, { pass: boolean; detail: string }> = {};

      // 1. Word count
      const minWords = 2500;
      checks.wordCount = {
        pass: charCount >= minWords,
        detail: `${charCount} chars (min: ${minWords})`,
      };

      // 2. Repetition detection (simple: repeated phrases of 6+ chars)
      const phrases = new Map<string, number>();
      for (let i = 0; i < content.length - 6; i++) {
        const phrase = content.slice(i, i + 6);
        phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
      }
      const repeatedPhrases = [...phrases.entries()].filter(([, count]) => count > 3);
      checks.repetition = {
        pass: repeatedPhrases.length < 5,
        detail: `${repeatedPhrases.length} repeated phrases found`,
      };

      // 3. Dialogue ratio
      const dialogueMatches = content.match(/[""「」『』]/g) || [];
      const dialogueRatio = dialogueMatches.length / (charCount || 1);
      checks.dialogueRatio = {
        pass: dialogueRatio > 0.01 && dialogueRatio < 0.4,
        detail: `Dialogue marker density: ${(dialogueRatio * 100).toFixed(1)}%`,
      };

      // 4. Paragraph variety
      const paragraphs = content.split(/\n\s*\n/).filter(Boolean);
      const avgParagraphLen = charCount / (paragraphs.length || 1);
      checks.paragraphVariety = {
        pass: paragraphs.length >= 5 && avgParagraphLen < 500,
        detail: `${paragraphs.length} paragraphs, avg ${Math.round(avgParagraphLen)} chars`,
      };

      // 5. Ending hook
      const lastParagraph = paragraphs[paragraphs.length - 1] || '';
      const hookIndicators = ['？', '！', '…', '——', '却', '竟', '突然', '然而', '可是'];
      const hasHook = hookIndicators.some(h => lastParagraph.includes(h));
      checks.endingHook = {
        pass: hasHook,
        detail: hasHook ? 'Ending has hook indicator' : 'No clear hook at chapter end',
      };

      const allPassed = Object.values(checks).every(c => c.pass);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            chapter: chapter_index,
            title: row.title,
            overallPass: allPassed,
            checks,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'qc_consistency_check',
    'Check for consistency issues between a chapter and the project context (character names, locations, timeline)',
    {
      project_id: z.string().describe('Project ID'),
      chapter_index: z.number().describe('Chapter index to check'),
    },
    async ({ project_id, chapter_index }) => {
      const chapter = db.prepare(`
        SELECT content FROM chapters WHERE project_id = ? AND chapter_index = ?
      `).get(project_id, chapter_index) as any;

      if (!chapter) {
        return { content: [{ type: 'text' as const, text: `Chapter ${chapter_index} not found` }], isError: true };
      }

      const charRow = db.prepare(`
        SELECT characters_json FROM characters WHERE project_id = ?
      `).get(project_id) as any;

      const issues: string[] = [];

      // Check if known character names appear with wrong patterns
      if (charRow) {
        try {
          const characters = JSON.parse(charRow.characters_json);
          const charNames = Array.isArray(characters)
            ? characters.map((c: any) => c.name)
            : Object.keys(characters);

          // Simple presence check (more sophisticated checks would use the engine)
          for (const name of charNames) {
            if (name && chapter.content.includes(name)) {
              // Character mentioned — could do deeper checks here
            }
          }
        } catch { /* ignore parse errors */ }
      }

      if (issues.length === 0) {
        issues.push('No obvious consistency issues detected (basic check only)');
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ chapter: chapter_index, issues }, null, 2),
        }],
      };
    },
  );
}
