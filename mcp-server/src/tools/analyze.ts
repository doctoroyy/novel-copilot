/**
 * 创作分析工具 — 帮助 agent 做出创作决策
 *
 * 这些工具不是简单的数据查询，而是提供"创作洞察"：
 * 读者期待分析、冲突密度诊断、伏笔管理建议、节奏评估。
 * Agent 用这些洞察来决定"这一章应该写什么"。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerAnalyzeTools(server: McpServer, db: DbInstance) {

  server.tool(
    'analyze_story_health',
    '诊断当前故事的"健康度"：冲突密度、伏笔状态、节奏曲线、角色活跃度。给出可执行的建议。',
    {
      project_id: z.string().describe('项目 ID'),
      lookback_chapters: z.number().default(5).describe('回看最近几章来分析'),
    },
    async ({ project_id, lookback_chapters }) => {
      const state = db.prepare(`
        SELECT s.*, p.total_chapters as plan_total
        FROM states s JOIN projects p ON p.id = s.project_id
        WHERE s.project_id = ?
      `).get(project_id) as any;

      if (!state) {
        return { content: [{ type: 'text' as const, text: '项目不存在' }], isError: true };
      }

      const nextIdx = state.next_chapter_index || 1;
      const openLoops = JSON.parse(state.open_loops || '[]') as string[];
      const progress = (nextIdx - 1) / (state.total_chapters || 100);

      // 最近章节字数和标题
      const recentChapters = db.prepare(`
        SELECT chapter_index, title, word_count, content FROM chapters
        WHERE project_id = ? AND chapter_index >= ? AND chapter_index < ?
        ORDER BY chapter_index ASC
      `).all(project_id, Math.max(1, nextIdx - lookback_chapters), nextIdx) as any[];

      const diagnostics: string[] = [];
      diagnostics.push(`# 故事健康度诊断\n`);
      diagnostics.push(`**进度**: 第${nextIdx - 1}章 / 共${state.total_chapters}章 (${Math.round(progress * 100)}%)\n`);

      // 1. 字数稳定性
      const wordCounts = recentChapters.map((c: any) => c.word_count || 0);
      const avgWords = wordCounts.length > 0 ? Math.round(wordCounts.reduce((a: number, b: number) => a + b, 0) / wordCounts.length) : 0;
      const minWords = Math.min(...wordCounts, Infinity);
      const maxWords = Math.max(...wordCounts, 0);
      diagnostics.push(`## 字数分析`);
      diagnostics.push(`- 近${recentChapters.length}章平均: ${avgWords}字`);
      diagnostics.push(`- 范围: ${minWords} ~ ${maxWords}字`);
      if (avgWords < (state.min_chapter_words || 2500)) {
        diagnostics.push(`- ⚠️ 平均字数低于目标 ${state.min_chapter_words || 2500}字`);
      }

      // 2. 伏笔健康度
      diagnostics.push(`\n## 伏笔管理`);
      diagnostics.push(`- 当前未解伏笔: ${openLoops.length}条`);
      if (openLoops.length === 0 && progress > 0.1) {
        diagnostics.push(`- ⚠️ 无任何伏笔，故事缺乏悬念张力`);
        diagnostics.push(`- 💡 建议: 本章至少埋设1条伏笔`);
      } else if (openLoops.length > 10) {
        diagnostics.push(`- ⚠️ 伏笔积压过多，读者可能已遗忘早期伏笔`);
        diagnostics.push(`- 💡 建议: 优先回收最老的2-3条伏笔`);
      } else if (openLoops.length > 0) {
        diagnostics.push(`- ✅ 伏笔数量健康`);
      }
      if (openLoops.length > 0) {
        diagnostics.push(`- 具体伏笔:`);
        openLoops.forEach((l, i) => diagnostics.push(`  ${i + 1}. ${l}`));
      }

      // 3. 结尾钩子检查
      diagnostics.push(`\n## 章末钩子`);
      const hookIndicators = ['？', '！', '…', '——', '却', '竟', '突然', '然而', '可是', '不料', '谁知'];
      let hookHits = 0;
      for (const ch of recentChapters) {
        const content = (ch.content as string) || '';
        const lastPara = content.split(/\n\s*\n/).filter(Boolean).pop() || '';
        if (hookIndicators.some(h => lastPara.includes(h))) hookHits++;
      }
      const hookRate = recentChapters.length > 0 ? hookHits / recentChapters.length : 0;
      diagnostics.push(`- 近${recentChapters.length}章有钩子的比例: ${Math.round(hookRate * 100)}%`);
      if (hookRate < 0.6) {
        diagnostics.push(`- ⚠️ 钩子率偏低，追读可能下降`);
        diagnostics.push(`- 💡 建议: 每章结尾必须有悬念、转折或新威胁`);
      }

      // 4. 节奏评估（简化）
      diagnostics.push(`\n## 节奏评估`);
      if (recentChapters.length >= 3) {
        // 通过对话密度变化粗略判断节奏
        const dialogueDensities = recentChapters.map((ch: any) => {
          const content = (ch.content as string) || '';
          const markers = (content.match(/[""「」『』]/g) || []).length;
          return markers / (content.length || 1);
        });
        const isMonotone = dialogueDensities.every((d: number) => Math.abs(d - dialogueDensities[0]) < 0.01);
        if (isMonotone) {
          diagnostics.push(`- ⚠️ 近几章节奏单调（对话/叙事比例变化不大）`);
          diagnostics.push(`- 💡 建议: 下一章切换叙事模式（如从对话密集转为动作场景）`);
        } else {
          diagnostics.push(`- ✅ 节奏有变化`);
        }
      }

      // 5. 阶段性建议
      diagnostics.push(`\n## 阶段性建议`);
      if (progress < 0.05) {
        diagnostics.push(`- 开局阶段: 快速建立核心冲突，展示主角独特性`);
      } else if (progress < 0.25) {
        diagnostics.push(`- 铺垫阶段: 扩展世界观，建立角色关系网，埋设长线伏笔`);
      } else if (progress < 0.5) {
        diagnostics.push(`- 中盘阶段: 保持冲突升级，避免中盘疲软，每卷要有明确高潮`);
      } else if (progress < 0.75) {
        diagnostics.push(`- 后半段: 开始收束支线，加速主线推进，准备高潮`);
      } else {
        diagnostics.push(`- 收尾阶段: 集中回收伏笔，不开新坑，走向终战/大结局`);
      }

      return { content: [{ type: 'text' as const, text: diagnostics.join('\n') }] };
    },
  );

  server.tool(
    'analyze_last_chapter_ending',
    '分析上一章的结尾，帮助决定本章如何开头、如何承接。',
    { project_id: z.string().describe('项目 ID') },
    async ({ project_id }) => {
      const state = db.prepare(`SELECT next_chapter_index FROM states WHERE project_id = ?`).get(project_id) as any;
      if (!state) return { content: [{ type: 'text' as const, text: '项目不存在' }], isError: true };

      const lastIdx = (state.next_chapter_index || 1) - 1;
      if (lastIdx < 1) {
        return { content: [{ type: 'text' as const, text: '这是第一章，无前文可分析。直接开始写作即可。' }] };
      }

      const lastChapter = db.prepare(`
        SELECT title, content FROM chapters WHERE project_id = ? AND chapter_index = ?
      `).get(project_id, lastIdx) as any;

      if (!lastChapter) {
        return { content: [{ type: 'text' as const, text: `第${lastIdx}章不存在` }], isError: true };
      }

      const content = lastChapter.content as string;
      const paragraphs = content.split(/\n\s*\n/).filter(Boolean);
      const lastThreeParagraphs = paragraphs.slice(-3).join('\n\n');

      // 分析结尾类型
      const ending = paragraphs[paragraphs.length - 1] || '';
      const signals: string[] = [];
      if (ending.includes('？') || ending.includes('?')) signals.push('疑问/悬念');
      if (ending.includes('！') || ending.includes('!')) signals.push('惊讶/震撼');
      if (ending.includes('…') || ending.includes('——')) signals.push('未完待续/暗示');
      if (/突然|忽然|猛然/.test(ending)) signals.push('突发事件');
      if (/然而|但是|可是|谁知/.test(ending)) signals.push('转折');

      const analysis: string[] = [];
      analysis.push(`# 上一章结尾分析 — 第${lastIdx}章《${lastChapter.title}》\n`);
      analysis.push(`## 结尾原文（最后3段）\n\n${lastThreeParagraphs}\n`);
      analysis.push(`## 结尾信号: ${signals.length > 0 ? signals.join('、') : '无明显钩子⚠️'}\n`);

      analysis.push(`## 本章开头建议`);
      if (signals.includes('突发事件') || signals.includes('转折')) {
        analysis.push(`- 直接从事件结果/反应开始，不要重复描述事件本身`);
        analysis.push(`- 可以从另一个角色的视角切入，增加信息层次`);
      } else if (signals.includes('疑问/悬念')) {
        analysis.push(`- 不要立刻揭晓答案，先给部分信息或新角度`);
        analysis.push(`- 可以先写其他事推进，让悬念发酵1-2个场景再揭示`);
      } else {
        analysis.push(`- 上一章结尾较平，本章开头需要强切入`);
        analysis.push(`- 用动作或对话直接开始，500字内必须出现张力`);
      }

      return { content: [{ type: 'text' as const, text: analysis.join('\n') }] };
    },
  );

  server.tool(
    'suggest_chapter_direction',
    '根据当前故事状态，给出本章的写作方向建议（包含场景序列、伏笔操作、钩子方向）。',
    {
      project_id: z.string().describe('项目 ID'),
      constraints: z.string().optional().describe('额外约束（如"本章必须有打斗"、"需要回收某个伏笔"等）'),
    },
    async ({ project_id, constraints }) => {
      const state = db.prepare(`
        SELECT s.*, p.name, p.bible FROM states s
        JOIN projects p ON p.id = s.project_id
        WHERE s.project_id = ?
      `).get(project_id) as any;

      if (!state) return { content: [{ type: 'text' as const, text: '项目不存在' }], isError: true };

      const nextIdx = state.next_chapter_index || 1;
      const openLoops = JSON.parse(state.open_loops || '[]') as string[];
      const progress = (nextIdx - 1) / (state.total_chapters || 100);

      // 获取大纲中本章目标
      const outlineRow = db.prepare(`SELECT outline_json FROM outlines WHERE project_id = ?`).get(project_id) as any;
      let outlineGoal = '';
      if (outlineRow) {
        try {
          const outline = JSON.parse(outlineRow.outline_json);
          if (outline.chapters?.[nextIdx - 1]) {
            outlineGoal = outline.chapters[nextIdx - 1].goal || outline.chapters[nextIdx - 1].summary || '';
          }
        } catch { /* ignore */ }
      }

      const suggestions: string[] = [];
      suggestions.push(`# 第${nextIdx}章 方向建议\n`);

      // 大纲目标
      if (outlineGoal) {
        suggestions.push(`## 大纲目标\n${outlineGoal}\n`);
      }

      // 伏笔操作建议
      suggestions.push(`## 伏笔操作`);
      if (openLoops.length > 8) {
        const toResolve = openLoops.slice(0, 2);
        suggestions.push(`建议回收: ${toResolve.map((l, i) => `\n  ${i + 1}. ${l}`).join('')}`);
      } else if (openLoops.length < 3 && progress < 0.8) {
        suggestions.push(`建议埋设: 1-2 条新伏笔（当前仅${openLoops.length}条，悬念不足）`);
      } else {
        suggestions.push(`当前${openLoops.length}条伏笔，可选择性回收1条或维持现状`);
      }

      // 节奏建议
      suggestions.push(`\n## 节奏建议`);
      const chapterInVolume = ((nextIdx - 1) % 30) + 1; // 假设每卷30章
      if (chapterInVolume <= 3) {
        suggestions.push(`- 卷首阶段: 建立新冲突，承接上卷余波`);
      } else if (chapterInVolume % 5 === 0) {
        suggestions.push(`- 小高潮节点: 应有明确的爽点或转折`);
      } else if (chapterInVolume >= 25) {
        suggestions.push(`- 接近卷末: 推进到卷级高潮，提升紧张度`);
      }

      // 场景序列建议
      suggestions.push(`\n## 建议场景序列（2-4个场景）`);
      suggestions.push(`1. [承接/切入] — 从上章结尾自然过渡或视角切换`);
      suggestions.push(`2. [推进] — 本章核心事件发生，推动主线或支线`);
      suggestions.push(`3. [升级/转折] — 情况变化，压力增加或新信息揭示`);
      suggestions.push(`4. [钩子] — 章末设置悬念或引出下一章冲突`);

      // 钩子方向
      suggestions.push(`\n## 章末钩子方向`);
      if (progress < 0.3) {
        suggestions.push(`- 新威胁浮现 / 主角发现更大秘密`);
      } else if (progress < 0.7) {
        suggestions.push(`- 关键选择即将到来 / 对手行动升级`);
      } else {
        suggestions.push(`- 最终决战逼近 / 核心真相即将揭晓`);
      }

      if (constraints) {
        suggestions.push(`\n## 用户额外约束\n${constraints}`);
      }

      return { content: [{ type: 'text' as const, text: suggestions.join('\n') }] };
    },
  );
}
