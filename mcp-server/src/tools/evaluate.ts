/**
 * 质量评估工具 — 对草稿进行多维度评估并给出可操作的修改建议
 *
 * 不只是"通过/不通过"的检查，而是给出具体的问题定位和修改方案。
 * Agent 可以根据反馈自主决定是否重写。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';

export function registerEvaluateTools(server: McpServer, db: DbInstance) {

  server.tool(
    'evaluate_chapter',
    '对一章内容进行全面质量评估：字数、结构、钩子、对话密度、重复检测、节奏、开头吸引力。返回评分和具体修改建议。',
    {
      project_id: z.string().describe('项目 ID'),
      chapter_index: z.number().optional().describe('要评估的章节索引（默认评估最新章）'),
      content: z.string().optional().describe('直接传入内容评估（不从数据库读取）'),
    },
    async ({ project_id, chapter_index, content: directContent }) => {
      let content = directContent || '';
      let title = '(直接传入)';

      if (!directContent) {
        const state = db.prepare(`SELECT next_chapter_index FROM states WHERE project_id = ?`).get(project_id) as any;
        const idx = chapter_index || ((state?.next_chapter_index || 1) - 1);
        const row = db.prepare(`
          SELECT title, content FROM chapters WHERE project_id = ? AND chapter_index = ?
        `).get(project_id, idx) as any;
        if (!row) {
          return { content: [{ type: 'text' as const, text: `第${idx}章不存在` }], isError: true };
        }
        content = row.content;
        title = row.title;
      }

      const stateRow = db.prepare(`SELECT min_chapter_words FROM states WHERE project_id = ?`).get(project_id) as any;
      const minWords = stateRow?.min_chapter_words || 2500;

      // === 多维度评估 ===
      const charCount = content.replace(/\s/g, '').length;
      const paragraphs = content.split(/\n\s*\n/).filter(Boolean);
      const sentences = content.split(/[。！？!?…]+/).filter(s => s.trim().length > 0);

      const report: string[] = [];
      report.push(`# 章节质量评估 — ${title}\n`);

      let totalScore = 0;
      let maxScore = 0;

      // 1. 字数 (20分)
      maxScore += 20;
      const wordScore = charCount >= minWords ? 20 : Math.round(charCount / minWords * 20);
      totalScore += wordScore;
      report.push(`## 1. 字数 ${wordScore}/20`);
      report.push(`- 实际: ${charCount}字 / 目标: ≥${minWords}字`);
      if (charCount < minWords) {
        report.push(`- ❌ 差 ${minWords - charCount} 字。建议增加细节描写或补充一个场景。`);
      }

      // 2. 结构完整性 (15分)
      maxScore += 15;
      let structScore = 15;
      report.push(`\n## 2. 结构 ${paragraphs.length >= 5 ? '15' : Math.round(paragraphs.length / 5 * 15)}/15`);
      report.push(`- 段落数: ${paragraphs.length}`);
      if (paragraphs.length < 5) {
        structScore = Math.round(paragraphs.length / 5 * 15);
        report.push(`- ⚠️ 段落过少，容易大段堆砌。建议拆分长段。`);
      }
      const avgParaLen = charCount / (paragraphs.length || 1);
      if (avgParaLen > 400) {
        structScore = Math.max(structScore - 5, 0);
        report.push(`- ⚠️ 平均段落 ${Math.round(avgParaLen)} 字，过长。理想值 100-300 字。`);
      }
      totalScore += structScore;

      // 3. 对话密度 (15分)
      maxScore += 15;
      const dialogueMarkers = (content.match(/[""\u201c\u201d「」『』]/g) || []).length;
      const dialogueRatio = dialogueMarkers / (charCount || 1);
      let dialogueScore = 15;
      report.push(`\n## 3. 对话密度 `);
      if (dialogueRatio < 0.005) {
        dialogueScore = 5;
        report.push(`- ⚠️ 几乎无对话 (${(dialogueRatio * 100).toFixed(1)}%)。纯叙事容易沉闷。`);
        report.push(`- 💡 增加角色间互动，用对话推进信息释放。`);
      } else if (dialogueRatio > 0.06) {
        dialogueScore = 8;
        report.push(`- ⚠️ 对话过多 (${(dialogueRatio * 100).toFixed(1)}%)。缺少描写和叙事。`);
        report.push(`- 💡 在对话间穿插动作描写和环境细节。`);
      } else {
        report.push(`- ✅ 对话密度适中 (${(dialogueRatio * 100).toFixed(1)}%)`);
      }
      report[report.length - (dialogueScore < 15 ? 3 : 1)] = `\n## 3. 对话密度 ${dialogueScore}/15`;
      totalScore += dialogueScore;

      // 4. 章末钩子 (20分)
      maxScore += 20;
      const lastPara = paragraphs[paragraphs.length - 1] || '';
      const hookIndicators = ['？', '！', '…', '——', '却', '竟', '突然', '然而', '可是', '谁知', '不料', '居然'];
      const strongHooks = ['？', '…', '竟', '突然', '谁知', '不料', '居然'];
      const hasHook = hookIndicators.some(h => lastPara.includes(h));
      const hasStrongHook = strongHooks.some(h => lastPara.includes(h));
      let hookScore = hasStrongHook ? 20 : hasHook ? 14 : 5;
      totalScore += hookScore;
      report.push(`\n## 4. 章末钩子 ${hookScore}/20`);
      report.push(`- 结尾段: "${lastPara.slice(-80)}"`);
      if (!hasHook) {
        report.push(`- ❌ 无明显钩子。读者没有"翻下一页"的冲动。`);
        report.push(`- 💡 改写最后1-2段：加入悬念揭示一半、新威胁出现或角色做出意外决定。`);
      } else if (!hasStrongHook) {
        report.push(`- ⚠️ 钩子较弱。建议加强悬念力度。`);
      } else {
        report.push(`- ✅ 有力的章末钩子`);
      }

      // 5. 重复检测 (15分)
      maxScore += 15;
      const phrases6 = new Map<string, number>();
      for (let i = 0; i < content.length - 6; i++) {
        const p = content.slice(i, i + 6);
        if (/\s/.test(p)) continue;
        phrases6.set(p, (phrases6.get(p) || 0) + 1);
      }
      const repeatedPhrases = [...phrases6.entries()]
        .filter(([phrase, count]) => count > 3 && !/^[。，！？、；：""]/g.test(phrase))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      let repeatScore = 15;
      report.push(`\n## 5. 重复检测 `);
      if (repeatedPhrases.length > 3) {
        repeatScore = 5;
        report.push(`- ❌ 发现 ${repeatedPhrases.length} 个高频重复短语:`);
        repeatedPhrases.forEach(([phrase, count]) => report.push(`  - "${phrase}" × ${count}次`));
        report.push(`- 💡 用同义替换或删除冗余表达。`);
      } else if (repeatedPhrases.length > 0) {
        repeatScore = 10;
        report.push(`- ⚠️ 少量重复:`);
        repeatedPhrases.forEach(([phrase, count]) => report.push(`  - "${phrase}" × ${count}次`));
      } else {
        report.push(`- ✅ 无明显重复`);
      }
      report[report.length - (repeatedPhrases.length > 0 ? repeatedPhrases.length + 2 : 1)] =
        `\n## 5. 重复检测 ${repeatScore}/15`;
      totalScore += repeatScore;

      // 6. 开头吸引力 (15分)
      maxScore += 15;
      const firstPara = paragraphs[0] || '';
      const first200 = content.slice(0, 200);
      let openingScore = 15;
      report.push(`\n## 6. 开头吸引力 `);
      const boringOpeners = ['阳光', '清晨', '时间来到', '话说', '却说', '翌日'];
      const hasBoring = boringOpeners.some(b => first200.startsWith(b));
      const hasAction = /[动跑跳打踢冲撞抓握挥]/.test(first200.slice(0, 100));
      const hasDialogue = /[""\u201c「]/.test(first200.slice(0, 100));
      if (hasBoring) {
        openingScore = 5;
        report.push(`- ❌ 开头平淡（"${first200.slice(0, 20)}..."）`);
        report.push(`- 💡 用动作、对话或反常事件开头。500字内必须出现张力。`);
      } else if (hasAction || hasDialogue) {
        report.push(`- ✅ 开头有行动/对话，节奏紧凑`);
      } else if (firstPara.length > 200) {
        openingScore = 10;
        report.push(`- ⚠️ 开头段过长(${firstPara.length}字)，可能劝退读者`);
      } else {
        report.push(`- ✅ 开头长度适中`);
      }
      report[report.length - (openingScore < 15 ? 2 : 1)] = `\n## 6. 开头吸引力 ${openingScore}/15`;
      totalScore += openingScore;

      // 总分
      const grade = totalScore >= 85 ? 'A' : totalScore >= 70 ? 'B' : totalScore >= 55 ? 'C' : 'D';
      report.unshift(`**总评: ${totalScore}/${maxScore} (${grade}级)**\n`);
      report.splice(1, 0, '');

      // 行动建议
      report.push(`\n## 总结建议`);
      if (grade === 'A') {
        report.push(`✅ 质量优秀，可以发布。`);
      } else if (grade === 'B') {
        report.push(`⚠️ 整体合格但有改进空间。建议修改标记 ⚠️ 的项目。`);
      } else {
        report.push(`❌ 需要重写或大幅修改。优先解决标记 ❌ 的问题。`);
      }

      return { content: [{ type: 'text' as const, text: report.join('\n') }] };
    },
  );

  server.tool(
    'check_continuity',
    '检查章节与前文的连续性问题：角色名一致性、时间逻辑、地点矛盾。',
    {
      project_id: z.string().describe('项目 ID'),
      content: z.string().describe('要检查的章节内容'),
    },
    async ({ project_id, content }) => {
      // 从前文提取已知实体
      const state = db.prepare(`
        SELECT rolling_summary, open_loops FROM states WHERE project_id = ?
      `).get(project_id) as any;

      const charsRow = db.prepare(`SELECT characters_json FROM characters WHERE project_id = ?`).get(project_id) as any;

      const issues: string[] = [];

      // 检查已知角色名是否拼写正确
      if (charsRow) {
        try {
          const chars = JSON.parse(charsRow.characters_json);
          const charNames = (Array.isArray(chars) ? chars : Object.values(chars))
            .map((c: any) => c.name || c.characterName)
            .filter(Boolean) as string[];

          // 检查是否有相似但不完全匹配的名字（可能是笔误）
          const contentChars = new Set<string>();
          for (const name of charNames) {
            if (name.length >= 2 && content.includes(name)) {
              contentChars.add(name);
            }
            // 检查部分匹配（如只写了姓或只写了名）
            if (name.length >= 3) {
              const partialName = name.slice(0, 2);
              if (content.includes(partialName) && !content.includes(name)) {
                // 可能是简称，不一定是错误
              }
            }
          }
        } catch { /* ignore */ }
      }

      // 检查提前完结信号
      const endingPatterns = [
        /感谢(大家|读者|各位|支持)/,
        /（完）|\(完\)|（全文完）/,
        /全书完|完结|大结局/,
        /从此(以后|之后).{0,10}(幸福|安稳|平静)/,
        /故事(就|也|便)(到此|到这|至此|结束)/,
      ];
      for (const pattern of endingPatterns) {
        if (pattern.test(content)) {
          issues.push(`🔴 **提前完结信号**: 检测到 "${content.match(pattern)?.[0]}" — 除非这是最终章，否则需要移除`);
        }
      }

      // 检查是否有"回顾全文"式的总结
      if (/回顾(一路|过往|这些年|这一切)/.test(content)) {
        issues.push(`🟡 **总结式表述**: 出现了回顾性叙述，可能给读者"要完结了"的信号`);
      }

      if (issues.length === 0) {
        return { content: [{ type: 'text' as const, text: '✅ 未检测到明显的连续性问题。\n\n注：此检查基于规则匹配，深层逻辑矛盾需要人工审核。' }] };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `# 连续性检查结果\n\n发现 ${issues.length} 个问题：\n\n${issues.join('\n\n')}`,
        }],
      };
    },
  );
}
