/**
 * 写作准备工具 — 获取 agent 开始写作前需要的一切上下文
 *
 * 设计哲学：一次调用获得完整的创作 briefing，而不是让 agent
 * 自己拼装零散的 CRUD 结果。工具的输出是"可以直接用来写作"的，
 * 不是原始数据。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerPrepareTools(server: McpServer, db: DbInstance) {

  server.tool(
    'prepare_writing_context',
    '获取写下一章所需的完整创作上下文 briefing。输出是经过组织的叙事信息，而非原始数据。一次调用替代多次 CRUD 查询。',
    {
      project_id: z.string().describe('项目 ID'),
      chapter_index: z.number().optional().describe('要写的章节索引（默认取下一章）'),
    },
    async ({ project_id, chapter_index }) => {
      const project = db.prepare(`
        SELECT p.*, s.total_chapters, s.next_chapter_index, s.min_chapter_words,
               s.rolling_summary, s.open_loops, s.need_human, s.need_human_reason
        FROM projects p
        LEFT JOIN states s ON s.project_id = p.id
        WHERE p.id = ? AND p.deleted_at IS NULL
      `).get(project_id) as any;

      if (!project) {
        return { content: [{ type: 'text' as const, text: `项目不存在: ${project_id}` }], isError: true };
      }

      const targetIdx = chapter_index || project.next_chapter_index || 1;
      const openLoops = JSON.parse(project.open_loops || '[]') as string[];

      // 最近 2 章全文（保持连续性）
      const recentChapters = db.prepare(`
        SELECT chapter_index, title, content FROM chapters
        WHERE project_id = ? AND chapter_index >= ? AND chapter_index < ?
        ORDER BY chapter_index ASC
      `).all(project_id, Math.max(1, targetIdx - 2), targetIdx) as any[];

      // 大纲
      const outlineRow = db.prepare(`SELECT outline_json FROM outlines WHERE project_id = ?`).get(project_id) as any;
      let chapterGoal = '';
      let volumeContext = '';
      if (outlineRow) {
        try {
          const outline = JSON.parse(outlineRow.outline_json);
          // 尝试提取本章的大纲目标
          if (outline.chapters && outline.chapters[targetIdx - 1]) {
            const ch = outline.chapters[targetIdx - 1];
            chapterGoal = ch.goal || ch.summary || ch.title || '';
          }
          if (outline.volumes) {
            // 找到本章所在的卷
            for (const vol of outline.volumes) {
              if (vol.startChapter <= targetIdx && vol.endChapter >= targetIdx) {
                volumeContext = `当前卷: ${vol.title || vol.name} (第${vol.startChapter}~${vol.endChapter}章)\n卷目标: ${vol.goal || vol.summary || ''}`;
                break;
              }
            }
          }
        } catch { /* ignore */ }
      }

      // 角色
      const charsRow = db.prepare(`SELECT characters_json FROM characters WHERE project_id = ?`).get(project_id) as any;

      // 组装 briefing
      const sections: string[] = [];

      sections.push(`# 创作 Briefing — 第${targetIdx}章\n`);

      // 基本信息
      sections.push(`## 项目概况`);
      sections.push(`- 书名: ${project.name}`);
      sections.push(`- 进度: 第${targetIdx}章 / 共${project.total_chapters}章 (${Math.round((targetIdx - 1) / project.total_chapters * 100)}%)`);
      sections.push(`- 最低字数: ${project.min_chapter_words || 2500} 字`);
      sections.push(`- 风格模板: ${project.chapter_prompt_profile || 'web_novel_light'}`);
      if (project.need_human) {
        sections.push(`\n⚠️ **需要人工决策**: ${project.need_human_reason}`);
      }

      // 核心设定（精简版）
      if (project.bible) {
        const bible = project.bible.length > 3000 ? project.bible.slice(0, 3000) + '\n...(设定过长已截断)' : project.bible;
        sections.push(`\n## 核心设定\n${bible}`);
      }

      // 本章目标
      if (chapterGoal || volumeContext) {
        sections.push(`\n## 本章定位`);
        if (volumeContext) sections.push(volumeContext);
        if (chapterGoal) sections.push(`本章目标: ${chapterGoal}`);
      }

      // 滚动摘要
      if (project.rolling_summary) {
        sections.push(`\n## 剧情摘要（截至第${targetIdx - 1}章）\n${project.rolling_summary}`);
      }

      // 未解伏笔
      if (openLoops.length > 0) {
        sections.push(`\n## 未解伏笔 (${openLoops.length}条)`);
        openLoops.forEach((loop, i) => sections.push(`${i + 1}. ${loop}`));
        if (openLoops.length >= 10) {
          sections.push(`\n💡 伏笔积压较多，建议本章回收 1-2 条。`);
        }
      }

      // 最近章节
      if (recentChapters.length > 0) {
        sections.push(`\n## 最近章节`);
        for (const ch of recentChapters) {
          // 只保留章节的结尾段落（为连续性）和标题
          const content = ch.content as string;
          const lastPortion = content.length > 1500 ? '...\n\n' + content.slice(-1500) : content;
          sections.push(`\n### 第${ch.chapter_index}章 ${ch.title}\n${lastPortion}`);
        }
      }

      // 角色信息（简要）
      if (charsRow) {
        try {
          const chars = JSON.parse(charsRow.characters_json);
          const charList = Array.isArray(chars) ? chars : Object.values(chars);
          if (charList.length > 0) {
            sections.push(`\n## 主要角色`);
            for (const c of (charList as any[]).slice(0, 8)) {
              const name = c.name || c.characterName || '?';
              const desc = c.description || c.role || c.personality || '';
              sections.push(`- **${name}**: ${typeof desc === 'string' ? desc.slice(0, 100) : JSON.stringify(desc).slice(0, 100)}`);
            }
          }
        } catch { /* ignore */ }
      }

      // 写作提示
      sections.push(`\n## 写作提示`);
      const progress = targetIdx / project.total_chapters;
      if (targetIdx <= 3) {
        sections.push(`📌 黄金三章阶段 — 必须在 500 字内引爆读者好奇心，禁止大段设定介绍`);
      } else if (progress < 0.25) {
        sections.push(`📌 开局铺垫阶段 — 建立角色和冲突，每章必须有进展`);
      } else if (progress > 0.9) {
        sections.push(`📌 收尾阶段 — 回收伏笔，收束主线，不要引入新的长线`);
      } else {
        sections.push(`📌 正常推进 — 保持冲突密度和节奏变化`);
      }

      return { content: [{ type: 'text' as const, text: sections.join('\n') }] };
    },
  );

  server.tool(
    'list_projects',
    '列出所有可用的小说项目',
    {},
    async () => {
      const rows = db.prepare(`
        SELECT p.id, p.name, s.total_chapters, s.next_chapter_index, s.min_chapter_words
        FROM projects p
        LEFT JOIN states s ON s.project_id = p.id
        WHERE p.deleted_at IS NULL
        ORDER BY p.created_at DESC
      `).all() as any[];

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: '没有项目。请先通过 GUI 应用创建项目。' }] };
      }

      const text = rows.map(r =>
        `- **${r.name}** (id: ${r.id}) — 进度 ${(r.next_chapter_index || 1) - 1}/${r.total_chapters}章`
      ).join('\n');

      return { content: [{ type: 'text' as const, text: `# 项目列表\n\n${text}` }] };
    },
  );
}
