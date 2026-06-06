/**
 * Export tools — export novel content to various formats
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';
import fs from 'node:fs';
import path from 'node:path';

export function registerExportTools(server: McpServer, db: DbInstance) {
  server.tool(
    'export_txt',
    'Export all chapters of a project to a single .txt file',
    {
      project_id: z.string().describe('Project ID'),
      output_path: z.string().optional().describe('Output file path (defaults to ~/novel-copilot-exports/{name}.txt)'),
      range_start: z.number().optional().describe('Start chapter index (inclusive)'),
      range_end: z.number().optional().describe('End chapter index (inclusive)'),
    },
    async ({ project_id, output_path, range_start, range_end }) => {
      const project = db.prepare(`SELECT name FROM projects WHERE id = ?`).get(project_id) as any;
      if (!project) {
        return { content: [{ type: 'text' as const, text: 'Project not found' }], isError: true };
      }

      let query = `SELECT chapter_index, title, content FROM chapters WHERE project_id = ?`;
      const params: any[] = [project_id];

      if (range_start !== undefined) {
        query += ` AND chapter_index >= ?`;
        params.push(range_start);
      }
      if (range_end !== undefined) {
        query += ` AND chapter_index <= ?`;
        params.push(range_end);
      }
      query += ` ORDER BY chapter_index ASC`;

      const chapters = db.prepare(query).all(...params) as any[];

      if (chapters.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No chapters found' }], isError: true };
      }

      // Build text
      const lines: string[] = [
        `《${project.name}》`,
        '',
        `导出时间：${new Date().toLocaleString('zh-CN')}`,
        `章节范围：第${chapters[0].chapter_index}章 ~ 第${chapters[chapters.length - 1].chapter_index}章（共${chapters.length}章）`,
        '',
        '═'.repeat(50),
        '',
      ];

      let totalWords = 0;
      for (const ch of chapters) {
        lines.push(`第${ch.chapter_index}章 ${ch.title}`);
        lines.push('');
        lines.push(ch.content);
        lines.push('');
        lines.push('─'.repeat(30));
        lines.push('');
        totalWords += (ch.content as string).replace(/\s/g, '').length;
      }

      const text = lines.join('\n');

      // Determine output path
      const defaultDir = path.join(process.env.HOME || '~', 'novel-copilot-exports');
      if (!fs.existsSync(defaultDir)) {
        fs.mkdirSync(defaultDir, { recursive: true });
      }

      const suffix = range_start || range_end
        ? `_${range_start || 1}-${range_end || chapters[chapters.length - 1].chapter_index}`
        : '';
      const filePath = output_path || path.join(defaultDir, `${project.name}${suffix}.txt`);

      fs.writeFileSync(filePath, text, 'utf-8');

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            exported: true,
            path: filePath,
            chapters: chapters.length,
            totalWords,
            fileSize: `${(Buffer.byteLength(text, 'utf-8') / 1024).toFixed(1)} KB`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'export_chapter_list',
    'Export a structured chapter index (useful for reviewing overall structure)',
    { project_id: z.string().describe('Project ID') },
    async ({ project_id }) => {
      const project = db.prepare(`SELECT name FROM projects WHERE id = ?`).get(project_id) as any;
      if (!project) {
        return { content: [{ type: 'text' as const, text: 'Project not found' }], isError: true };
      }

      const chapters = db.prepare(`
        SELECT chapter_index, title, word_count FROM chapters
        WHERE project_id = ? ORDER BY chapter_index ASC
      `).all(project_id) as any[];

      const totalWords = chapters.reduce((sum: number, ch: any) => sum + (ch.word_count || 0), 0);

      const lines = [
        `《${project.name}》目录`,
        `共 ${chapters.length} 章 / ${totalWords} 字`,
        '',
        ...chapters.map((ch: any) =>
          `  第${String(ch.chapter_index).padStart(3, ' ')}章  ${ch.title}  (${ch.word_count}字)`
        ),
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
