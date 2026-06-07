/**
 * 质量评估工具 — 使用引擎级文风启发式 + 多维度结构分析
 *
 * 核心能力: 零 AI 调用的8项量化指标 + 弃书红线检测 + 可操作修复建议。
 * 使用与内部引擎完全相同的 analyzeWritingStyle 逻辑。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';
import { analyzeWritingStyle } from '../bridge/styleHeuristics.js';

export function registerEvaluateTools(server: McpServer, db: DbInstance) {

  server.tool(
    'evaluate_chapter',
    '对章节进行引擎级质量评估：8项量化指标 + 弃书红线检测 + CHST四要素检查。返回 blocking/review 级别问题和具体修改建议。',
    {
      project_id: z.string().describe('项目 ID'),
      chapter_index: z.number().optional().describe('要评估的章节索引（默认评估最新章）'),
      content: z.string().optional().describe('直接传入内容评估（不从数据库读取）'),
      protagonist_names: z.array(z.string()).optional().describe('主角名字/别名列表（用于检测主角主动性）'),
    },
    async ({ project_id, chapter_index, content: directContent, protagonist_names }) => {
      let content = directContent || '';
      let title = '(直接传入)';
      let chapterIdx = chapter_index;

      if (!directContent) {
        const state = db.prepare(`SELECT next_chapter_index FROM states WHERE project_id = ?`).get(project_id) as any;
        const idx = chapter_index || ((state?.next_chapter_index || 1) - 1);
        chapterIdx = idx;
        const row = db.prepare(`
          SELECT title, content FROM chapters WHERE project_id = ? AND chapter_index = ?
        `).get(project_id, idx) as any;
        if (!row) {
          return { content: [{ type: 'text' as const, text: `第${idx}章不存在` }], isError: true };
        }
        content = row.content;
        title = row.title;
      }

      const stateRow = db.prepare(`SELECT min_chapter_words, next_chapter_index FROM states WHERE project_id = ?`).get(project_id) as any;
      const minWords = stateRow?.min_chapter_words || 2500;
      const isOpening = (chapterIdx || 1) <= 3;

      // 获取主角名（如果未传入，从角色表获取）
      let aliases = protagonist_names;
      if (!aliases || aliases.length === 0) {
        const charsRow = db.prepare(`SELECT characters_json FROM characters WHERE project_id = ?`).get(project_id) as any;
        if (charsRow) {
          try {
            const chars = JSON.parse(charsRow.characters_json);
            const charList = Array.isArray(chars) ? chars : Object.values(chars);
            // 取前2个角色作为主角
            aliases = (charList as any[]).slice(0, 2)
              .map((c: any) => c.name || c.characterName)
              .filter(Boolean);
          } catch { /* ignore */ }
        }
      }

      // === 核心：使用引擎级文风分析 ===
      const styleResult = analyzeWritingStyle(content, {
        protagonistAliases: aliases,
        isOpeningChapter: isOpening,
      });

      const { metrics, blockingReasons, reviewReasons } = styleResult;

      // === 构建评估报告 ===
      const report: string[] = [];
      report.push(`# 章节质量评估 — ${title}\n`);

      // 量化指标面板
      report.push(`## 量化指标`);
      report.push(`| 指标 | 值 | 状态 |`);
      report.push(`|------|-----|------|`);
      report.push(`| 字数 | ${metrics.bodyChars} | ${metrics.bodyChars >= minWords ? '✅' : '❌'} (目标≥${minWords}) |`);
      report.push(`| 段落数 | ${metrics.paragraphCount} | ${metrics.paragraphCount >= 8 ? '✅' : '⚠️'} |`);
      report.push(`| 长句占比 | ${(metrics.longSentenceRatio * 100).toFixed(0)}% | ${metrics.longSentenceRatio <= 0.25 ? '✅' : '⚠️'} (≤25%) |`);
      report.push(`| 最长无对白段 | ${metrics.maxSettingRunChars}字 | ${metrics.maxSettingRunChars <= 300 ? '✅' : metrics.maxSettingRunChars <= 500 ? '⚠️' : '❌'} (≤300) |`);
      report.push(`| 对话占比 | ${(metrics.dialoguePercent * 100).toFixed(0)}% | ${metrics.dialoguePercent >= 0.15 ? '✅' : '⚠️'} (≥15%) |`);
      report.push(`| 形容词堆砌 | ${metrics.adjectivePileupHits}处 | ${metrics.adjectivePileupHits < 3 ? '✅' : '⚠️'} (<3) |`);
      report.push(`| 章末钩子 | ${metrics.endingHookScore}/3 | ${metrics.endingHookScore >= 2 ? '✅' : metrics.endingHookScore >= 1 ? '⚠️' : '❌'} |`);
      report.push(`| 主角主动性 | ${(metrics.protagonistAgencyScore * 100).toFixed(0)}% | ${metrics.protagonistAgencyScore >= 0.2 ? '✅' : '⚠️'} (≥20%) |`);

      // 综合评分
      let score = 100;
      score -= blockingReasons.length * 20;
      score -= reviewReasons.length * 8;
      if (metrics.bodyChars < minWords) score -= 15;
      score = Math.max(0, Math.min(100, score));
      const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';

      report.splice(1, 0, `**总评: ${score}/100 (${grade}级)** ${blockingReasons.length > 0 ? '🚫 有弃书红线' : ''}\n`);

      // Blocking 问题（弃书红线）
      if (blockingReasons.length > 0) {
        report.push(`\n## 🚫 弃书红线（必须修复）`);
        blockingReasons.forEach((r, i) => report.push(`${i + 1}. ${r}`));
      }

      // Review 建议
      if (reviewReasons.length > 0) {
        report.push(`\n## ⚠️ 质量建议（建议修复）`);
        reviewReasons.forEach((r, i) => report.push(`${i + 1}. ${r}`));
      }

      // CHST 四要素自检提示
      report.push(`\n## CHST 四要素自检`);
      report.push(`请确认本章是否达成以下至少3项：`);
      report.push(`- [ ] **C 冲突**: 有明确的冲突（人vs人/环境/自我/势力）`);
      report.push(`- [ ] **H 钩子**: 章末属于12类钩子之一（钩子得分${metrics.endingHookScore}/3）`);
      report.push(`- [ ] **S 爽点**: 主角有进展/展示能力/赢得冲突`);
      report.push(`- [ ] **T 转折**: 有微转折让读者"没想到"`);

      // 提前完结检测
      const endingPatterns = [
        /感谢(大家|读者|各位|支持)/,
        /（完）|\(完\)|（全文完）/,
        /全书完|完结|大结局/,
        /从此(以后|之后).{0,10}(幸福|安稳|平静)/,
        /故事(就|也|便)(到此|到这|至此|结束)/,
      ];
      const endingHits = endingPatterns.filter(p => p.test(content));
      if (endingHits.length > 0) {
        report.push(`\n## 🔴 提前完结信号`);
        for (const pattern of endingHits) {
          const match = content.match(pattern);
          if (match) report.push(`- 检测到: "${match[0]}" — 除非最终章，否则必须移除`);
        }
      }

      // 行动建议
      report.push(`\n## 行动建议`);
      if (grade === 'A' && blockingReasons.length === 0) {
        report.push(`✅ 质量优秀，可以发布。`);
      } else if (blockingReasons.length > 0) {
        report.push(`❌ 存在弃书红线，必须重写相关段落。优先修复：`);
        report.push(`   ${blockingReasons[0]}`);
      } else if (grade === 'B') {
        report.push(`⚠️ 整体合格，建议优化 ⚠️ 项目以提升追读率。`);
      } else {
        report.push(`❌ 评分偏低，建议重写。重点关注字数、钩子和对话密度。`);
      }

      return { content: [{ type: 'text' as const, text: report.join('\n') }] };
    },
  );

  server.tool(
    'check_continuity',
    '检查章节连续性：提前完结信号、角色一致性、总结式表述。配合 evaluate_chapter 使用。',
    {
      project_id: z.string().describe('项目 ID'),
      content: z.string().describe('要检查的章节内容'),
      chapter_index: z.number().optional().describe('章节索引（用于判断是否最终章）'),
    },
    async ({ project_id, content, chapter_index }) => {
      const state = db.prepare(`
        SELECT s.rolling_summary, s.open_loops, s.next_chapter_index, p.total_chapters
        FROM states s JOIN projects p ON p.id = s.project_id
        WHERE s.project_id = ?
      `).get(project_id) as any;

      const charsRow = db.prepare(`SELECT characters_json FROM characters WHERE project_id = ?`).get(project_id) as any;

      const issues: string[] = [];
      const currentIdx = chapter_index || state?.next_chapter_index || 1;
      const isFinal = currentIdx >= (state?.total_chapters || 9999);

      // 1. 提前完结信号检测（非最终章）
      if (!isFinal) {
        const endingPatterns = [
          { re: /感谢(大家|读者|各位|支持)/, desc: '感谢读者式收尾' },
          { re: /（完）|\(完\)|（全文完）/, desc: '完结标记' },
          { re: /全书完|完结|大结局/, desc: '完结标记' },
          { re: /从此(以后|之后).{0,10}(幸福|安稳|平静)/, desc: '大团圆收束' },
          { re: /故事(就|也|便)(到此|到这|至此|结束)/, desc: '故事结束式表述' },
          { re: /这一切.{0,10}(结束|完结|落幕)/, desc: '落幕式表述' },
        ];
        for (const { re, desc } of endingPatterns) {
          const match = content.match(re);
          if (match) {
            issues.push(`🔴 **提前完结 [${desc}]**: "${match[0]}" — 这不是最终章(第${currentIdx}/${state?.total_chapters}章)，必须移除`);
          }
        }
      }

      // 2. 回顾/总结式表述
      const summaryPatterns = [
        /回顾(一路|过往|这些年|这一切)/,
        /这(些年|段时间|一路|一切)来/,
        /从.*到.*一步步/,
      ];
      for (const re of summaryPatterns) {
        if (re.test(content) && !isFinal) {
          issues.push(`🟡 **总结式表述**: 出现回顾性叙述，给读者"要完结了"的信号`);
          break;
        }
      }

      // 3. 角色名一致性检查
      if (charsRow) {
        try {
          const chars = JSON.parse(charsRow.characters_json);
          const charNames = (Array.isArray(chars) ? chars : Object.values(chars))
            .map((c: any) => c.name || c.characterName)
            .filter(Boolean) as string[];

          // 检查内容中是否出现了类似但不完全匹配的名字
          for (const name of charNames) {
            if (name.length >= 3) {
              // 检查是否只出现了姓而没有全名（可能的笔误）
              const surname = name.slice(0, 1);
              const givenName = name.slice(1);
              // 找是否有"姓+其他字"的模式（不是原名）
              const fuzzyRe = new RegExp(`${surname}[\\u4e00-\\u9fa5]{1,2}(?!${givenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g');
              const matches = content.match(fuzzyRe);
              if (matches) {
                const suspicious = matches.filter(m => m !== name && m.length === name.length);
                if (suspicious.length > 0) {
                  const unique = [...new Set(suspicious)];
                  for (const s of unique.slice(0, 2)) {
                    if (!charNames.includes(s)) {
                      issues.push(`🟡 **角色名疑问**: 出现"${s}"，是否应为"${name}"？`);
                    }
                  }
                }
              }
            }
          }
        } catch { /* ignore */ }
      }

      // 4. 上下文锚点检查（前文摘要中的关键信息）
      if (state?.rolling_summary) {
        // 检查是否有与摘要矛盾的明显信号
        const summary = state.rolling_summary as string;
        // 简化：检查"已死亡"角色是否出现
        const deathMatches = summary.match(/(.{2,4})(死亡|牺牲|身亡|丧命)/g);
        if (deathMatches) {
          for (const dm of deathMatches) {
            const deadChar = dm.replace(/(死亡|牺牲|身亡|丧命)/, '');
            if (content.includes(deadChar) && /说|道|笑|站|走|跑/.test(content.split(deadChar)[1]?.slice(0, 5) || '')) {
              issues.push(`🔴 **角色矛盾**: "${deadChar}" 在前文中已死亡/牺牲，但本章中出现了其活动描写`);
            }
          }
        }
      }

      if (issues.length === 0) {
        return { content: [{ type: 'text' as const, text: '✅ 连续性检查通过。\n\n未检测到提前完结信号、角色名矛盾或逻辑问题。\n\n注：深层逻辑矛盾仍需人工审核。' }] };
      }

      const blocking = issues.filter(i => i.startsWith('🔴'));
      const warning = issues.filter(i => i.startsWith('🟡'));

      return {
        content: [{
          type: 'text' as const,
          text: [
            `# 连续性检查结果`,
            ``,
            `发现 ${issues.length} 个问题（${blocking.length} 个严重，${warning.length} 个警告）：`,
            ``,
            ...issues,
            blocking.length > 0 ? `\n⚠️ 严重问题必须修复后才能保存。` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  );
}
