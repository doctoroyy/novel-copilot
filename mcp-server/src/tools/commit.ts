/**
 * 提交/保存工具 — 将 agent 写好的内容持久化并更新状态
 *
 * 设计哲学：Agent 是创作者，这些工具负责"交付"。
 * 提交时自动触发状态更新，减少 agent 的步骤。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerCommitTools(server: McpServer, db: DbInstance) {

  server.tool(
    'commit_chapter',
    '保存一章完成的内容。自动计算字数、更新进度。调用后应该更新摘要（commit_summary）。',
    {
      project_id: z.string().describe('项目 ID'),
      chapter_index: z.number().describe('章节索引'),
      title: z.string().describe('章节标题'),
      content: z.string().describe('章节正文'),
    },
    async ({ project_id, chapter_index, title, content }) => {
      const wordCount = content.replace(/\s/g, '').length;
      const minWords = (db.prepare(`SELECT min_chapter_words FROM states WHERE project_id = ?`).get(project_id) as any)?.min_chapter_words || 2500;

      // 保存
      db.prepare(`
        INSERT INTO chapters (project_id, chapter_index, title, content, word_count, created_at)
        VALUES (?, ?, ?, ?, ?, unixepoch() * 1000)
        ON CONFLICT(project_id, chapter_index) DO UPDATE SET
          title = excluded.title, content = excluded.content, word_count = excluded.word_count
      `).run(project_id, chapter_index, title, content, wordCount);

      // 更新进度
      const state = db.prepare(`SELECT next_chapter_index FROM states WHERE project_id = ?`).get(project_id) as any;
      if (state && chapter_index >= state.next_chapter_index) {
        db.prepare(`UPDATE states SET next_chapter_index = ? WHERE project_id = ?`)
          .run(chapter_index + 1, project_id);
      }

      // 简单质量预警
      const warnings: string[] = [];
      if (wordCount < minWords) {
        warnings.push(`⚠️ 字数 ${wordCount} < 目标 ${minWords}`);
      }
      const lastPara = content.split(/\n\s*\n/).filter(Boolean).pop() || '';
      const hookIndicators = ['？', '！', '…', '——', '却', '竟', '突然', '然而', '可是'];
      if (!hookIndicators.some(h => lastPara.includes(h))) {
        warnings.push(`⚠️ 章末无明显钩子`);
      }

      const result = [
        `✅ 第${chapter_index}章《${title}》已保存`,
        `   字数: ${wordCount}字`,
        warnings.length > 0 ? `\n${warnings.join('\n')}` : '',
        `\n⏭️ 下一步: 调用 commit_summary 更新滚动摘要和伏笔状态`,
      ].filter(Boolean).join('\n');

      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  server.tool(
    'commit_summary',
    '更新滚动摘要和伏笔状态。通常在 commit_chapter 后调用。摘要应该是对整体剧情的概括（800-1500字），不是单章总结。',
    {
      project_id: z.string().describe('项目 ID'),
      rolling_summary: z.string().describe('更新后的滚动摘要（概括到目前为止的所有重要剧情）'),
      open_loops: z.array(z.string()).describe('当前所有未解决的伏笔/悬念列表'),
    },
    async ({ project_id, rolling_summary, open_loops }) => {
      // 质量检查
      const summaryLen = rolling_summary.replace(/\s/g, '').length;
      const warnings: string[] = [];
      if (summaryLen < 200) {
        warnings.push(`⚠️ 摘要过短(${summaryLen}字)，可能遗漏重要信息`);
      }
      if (summaryLen > 2000) {
        warnings.push(`⚠️ 摘要过长(${summaryLen}字)，建议精简到1500字以内`);
      }
      if (open_loops.length > 12) {
        warnings.push(`⚠️ 伏笔过多(${open_loops.length}条)，考虑回收一些`);
      }

      db.prepare(`
        UPDATE states SET rolling_summary = ?, open_loops = ? WHERE project_id = ?
      `).run(rolling_summary, JSON.stringify(open_loops), project_id);

      // 保存快照到 summary_memories
      const state = db.prepare(`SELECT next_chapter_index FROM states WHERE project_id = ?`).get(project_id) as any;
      const chapterIdx = (state?.next_chapter_index || 1) - 1;
      db.prepare(`
        INSERT INTO summary_memories (project_id, chapter_index, rolling_summary, open_loops, update_reason)
        VALUES (?, ?, ?, ?, 'agent_commit')
      `).run(project_id, chapterIdx, rolling_summary, JSON.stringify(open_loops));

      const result = [
        `✅ 摘要和伏笔已更新`,
        `   摘要长度: ${summaryLen}字`,
        `   伏笔数: ${open_loops.length}条`,
        warnings.length > 0 ? `\n${warnings.join('\n')}` : '',
      ].filter(Boolean).join('\n');

      return { content: [{ type: 'text' as const, text: result }] };
    },
  );

  server.tool(
    'read_chapter',
    '读取指定章节的全文。',
    {
      project_id: z.string().describe('项目 ID'),
      chapter_index: z.number().describe('章节索引'),
    },
    async ({ project_id, chapter_index }) => {
      const row = db.prepare(`
        SELECT title, content, word_count FROM chapters
        WHERE project_id = ? AND chapter_index = ?
      `).get(project_id, chapter_index) as any;

      if (!row) {
        return { content: [{ type: 'text' as const, text: `第${chapter_index}章不存在` }], isError: true };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `# 第${chapter_index}章 ${row.title}\n\n${row.content}\n\n---\n字数: ${row.word_count}`,
        }],
      };
    },
  );

  server.tool(
    'export_novel',
    '导出小说到 TXT 文件。',
    {
      project_id: z.string().describe('项目 ID'),
      output_path: z.string().optional().describe('输出路径（默认 ~/novel-copilot-exports/）'),
    },
    async ({ project_id, output_path }) => {
      const { default: fs } = await import('node:fs');
      const { default: path } = await import('node:path');

      const project = db.prepare(`SELECT name FROM projects WHERE id = ?`).get(project_id) as any;
      if (!project) {
        return { content: [{ type: 'text' as const, text: '项目不存在' }], isError: true };
      }

      const chapters = db.prepare(`
        SELECT chapter_index, title, content FROM chapters
        WHERE project_id = ? ORDER BY chapter_index ASC
      `).all(project_id) as any[];

      if (chapters.length === 0) {
        return { content: [{ type: 'text' as const, text: '没有章节可导出' }], isError: true };
      }

      const lines = [`《${project.name}》\n\n`];
      let totalWords = 0;
      for (const ch of chapters) {
        lines.push(`第${ch.chapter_index}章 ${ch.title}\n\n`);
        lines.push(`${ch.content}\n\n`);
        lines.push('─'.repeat(20) + '\n\n');
        totalWords += (ch.content as string).replace(/\s/g, '').length;
      }

      const dir = path.join(process.env.HOME || '~', 'novel-copilot-exports');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = output_path || path.join(dir, `${project.name}.txt`);
      fs.writeFileSync(filePath, lines.join(''), 'utf-8');

      return {
        content: [{
          type: 'text' as const,
          text: `✅ 已导出到 ${filePath}\n   ${chapters.length}章 / ${totalWords}字`,
        }],
      };
    },
  );
}
