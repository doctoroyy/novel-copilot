/**
 * 写作准备工具 — 获取 agent 开始写作前需要的一切上下文
 *
 * 设计哲学：一次调用获得完整的创作 briefing，包含：
 * - 项目状态和设定
 * - 滚动摘要和伏笔
 * - 最近章节结尾（承接用）
 * - 大纲目标
 * - 角色信息
 * - 写作规则（根据章节位置动态生成）
 * - 节奏指导（三幕结构计算）
 * - 一致性护栏（不可矛盾的事实）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';
import { buildCoreWritingRules, type NarrativeType } from '../bridge/writingRules.js';
import { getChapterPacingGuidance } from '../bridge/pacing.js';

export function registerPrepareTools(server: McpServer, db: DbInstance) {

  server.tool(
    'prepare_writing_context',
    '获取写下一章所需的完整创作上下文 briefing。包含设定、摘要、伏笔、规则、节奏指导、一致性护栏。一次调用替代多次查询。',
    {
      project_id: z.string().describe('项目 ID'),
      chapter_index: z.number().optional().describe('要写的章节索引（默认取下一章）'),
      narrative_type: z.enum(['action', 'climax', 'tension', 'revelation', 'emotional', 'transition'])
        .optional().describe('叙事类型（不传则自动推导）'),
    },
    async ({ project_id, chapter_index, narrative_type }) => {
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
      const totalChapters = project.total_chapters || 100;
      const minWords = project.min_chapter_words || 2500;
      const openLoops = JSON.parse(project.open_loops || '[]') as string[];
      const isFinal = targetIdx >= totalChapters;

      // 计算节奏指导
      const volumeSize = 30;
      const volumeStart = Math.floor((targetIdx - 1) / volumeSize) * volumeSize + 1;
      const volumeEnd = Math.min(volumeStart + volumeSize - 1, totalChapters);

      // 尝试从大纲获取真实卷范围
      let realVolumeStart = volumeStart;
      let realVolumeEnd = volumeEnd;
      const outlineRow = db.prepare(`SELECT outline_json FROM outlines WHERE project_id = ?`).get(project_id) as any;
      let chapterGoal = '';
      let volumeContext = '';
      if (outlineRow) {
        try {
          const outline = JSON.parse(outlineRow.outline_json);
          if (outline.volumes) {
            for (const vol of outline.volumes) {
              if (vol.startChapter <= targetIdx && vol.endChapter >= targetIdx) {
                realVolumeStart = vol.startChapter;
                realVolumeEnd = vol.endChapter;
                volumeContext = `当前卷: ${vol.title || vol.name} (第${vol.startChapter}~${vol.endChapter}章)\n卷目标: ${vol.goal || vol.summary || ''}`;
                break;
              }
            }
          }
          if (outline.chapters && outline.chapters[targetIdx - 1]) {
            const ch = outline.chapters[targetIdx - 1];
            chapterGoal = ch.goal || ch.summary || ch.title || '';
          }
        } catch { /* ignore */ }
      }

      const pacingGuidance = getChapterPacingGuidance(targetIdx, realVolumeStart, realVolumeEnd, minWords);
      const resolvedNarrative = (narrative_type || pacingGuidance.pacingType) as NarrativeType;
      const isArcOpening = (targetIdx - 1) % volumeSize === 0 && targetIdx > 3;

      // 最近 2 章（保持连续性）
      const recentChapters = db.prepare(`
        SELECT chapter_index, title, content FROM chapters
        WHERE project_id = ? AND chapter_index >= ? AND chapter_index < ?
        ORDER BY chapter_index ASC
      `).all(project_id, Math.max(1, targetIdx - 2), targetIdx) as any[];

      // 角色
      const charsRow = db.prepare(`SELECT characters_json FROM characters WHERE project_id = ?`).get(project_id) as any;

      // === 组装 Briefing ===
      const sections: string[] = [];

      sections.push(`# 创作 Briefing — 第${targetIdx}章\n`);

      // 基本信息
      sections.push(`## 项目概况`);
      sections.push(`- 书名: ${project.name}`);
      sections.push(`- 进度: 第${targetIdx}章 / 共${totalChapters}章 (${Math.round((targetIdx - 1) / totalChapters * 100)}%)`);
      sections.push(`- 最低字数: ${minWords} 字`);
      sections.push(`- 建议字数: ${pacingGuidance.wordCountRange[0]}~${pacingGuidance.wordCountRange[1]} 字`);
      if (project.need_human) {
        sections.push(`\n⚠️ **需要人工决策**: ${project.need_human_reason}`);
      }

      // 节奏指导
      sections.push(`\n## 节奏指导`);
      sections.push(pacingGuidance.guidance);
      if (pacingGuidance.isClimaxChapter) {
        sections.push(`⚡ **本卷高潮章** — 伏笔集中触发，爆点最大化！`);
      }

      // 本章定位
      if (chapterGoal || volumeContext) {
        sections.push(`\n## 本章定位`);
        if (volumeContext) sections.push(volumeContext);
        if (chapterGoal) sections.push(`本章目标: ${chapterGoal}`);
      }

      // 核心设定
      if (project.bible) {
        const bible = project.bible.length > 2500 ? project.bible.slice(0, 2500) + '\n...(设定过长已截断)' : project.bible;
        sections.push(`\n## 核心设定\n${bible}`);
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

      // 一致性护栏
      const guardrails: string[] = [];
      if (recentChapters.length > 0) {
        const lastContent = recentChapters[recentChapters.length - 1].content as string;
        const lastEnding = lastContent.slice(-300).trim();
        guardrails.push(`[上章结尾锚点] ${lastEnding}`);
        guardrails.push('[衔接自检] 本章第1段必须从这个结尾的状态/位置/情绪继续，不得跳转或复原');
      }
      if (guardrails.length > 0) {
        sections.push(`\n## 一致性护栏 — 不可矛盾`);
        guardrails.forEach((g, i) => sections.push(`${i + 1}. ${g}`));
      }

      // 最近章节结尾
      if (recentChapters.length > 0) {
        sections.push(`\n## 最近章节结尾`);
        for (const ch of recentChapters) {
          const content = ch.content as string;
          const lastPortion = content.length > 1200 ? '...\n\n' + content.slice(-1200) : content;
          sections.push(`\n### 第${ch.chapter_index}章 ${ch.title}\n${lastPortion}`);
        }
      }

      // 角色信息
      if (charsRow) {
        try {
          const chars = JSON.parse(charsRow.characters_json);
          const charList = Array.isArray(chars) ? chars : Object.values(chars);
          if (charList.length > 0) {
            sections.push(`\n## 主要角色`);
            for (const c of (charList as any[]).slice(0, 8)) {
              const name = c.name || c.characterName || '?';
              const desc = c.description || c.role || c.personality || '';
              sections.push(`- **${name}**: ${typeof desc === 'string' ? desc.slice(0, 120) : JSON.stringify(desc).slice(0, 120)}`);
            }
          }
        } catch { /* ignore */ }
      }

      // 写作规则（根据章节位置动态生成）
      const rules = buildCoreWritingRules({
        chapterIndex: targetIdx,
        totalChapters,
        isFinalChapter: isFinal,
        narrativeType: resolvedNarrative,
        pacingTarget: pacingGuidance.pacingTarget,
        isArcOpening,
      });
      sections.push(`\n## 写作规则\n${rules}`);

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
