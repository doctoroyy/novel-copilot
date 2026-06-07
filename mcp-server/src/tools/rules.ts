/**
 * 写作规则与节奏工具 — 提供章节特定的创作规则和节奏指导
 *
 * 这是 MCP server 最重要的工具组：把经过验证的方法论规则
 * 根据章节位置动态生成，让 agent 在写作时有明确的质量标准。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DbInstance } from '../bridge/db.js';
import { buildCoreWritingRules, NARRATIVE_RECIPES, type NarrativeType } from '../bridge/writingRules.js';
import { getChapterPacingGuidance, getPacingTypeFromLevel } from '../bridge/pacing.js';

export function registerRulesTools(server: McpServer, db: DbInstance) {

  server.tool(
    'get_writing_rules',
    '获取当前章节应遵守的写作规则。规则根据章节位置（黄金三章/正常/收尾）、节奏类型（动作/高潮/揭示/情感/过渡）动态生成。写作前必须调用。',
    {
      project_id: z.string().describe('项目 ID'),
      chapter_index: z.number().optional().describe('章节索引（默认取下一章）'),
      narrative_type: z.enum(['action', 'climax', 'tension', 'revelation', 'emotional', 'transition'])
        .optional().describe('叙事类型（可选，不传则根据节奏曲线自动推导）'),
      pacing_target: z.number().optional().describe('紧张度目标 0-10（可选，不传则自动计算）'),
    },
    async ({ project_id, chapter_index, narrative_type, pacing_target }) => {
      const state = db.prepare(`
        SELECT s.*, p.total_chapters
        FROM states s JOIN projects p ON p.id = s.project_id
        WHERE s.project_id = ?
      `).get(project_id) as any;

      if (!state) {
        return { content: [{ type: 'text' as const, text: '项目不存在' }], isError: true };
      }

      const totalChapters = state.total_chapters || 100;
      const targetIdx = chapter_index || state.next_chapter_index || 1;
      const isFinal = targetIdx >= totalChapters;

      // 如果没指定 pacing/narrative，从卷结构推导
      let resolvedPacing = pacing_target;
      let resolvedNarrative = narrative_type as NarrativeType | undefined;

      if (resolvedPacing == null) {
        // 推导卷范围（简化：按 30 章一卷）
        const volumeSize = 30;
        const volumeStart = Math.floor((targetIdx - 1) / volumeSize) * volumeSize + 1;
        const volumeEnd = Math.min(volumeStart + volumeSize - 1, totalChapters);
        const guidance = getChapterPacingGuidance(targetIdx, volumeStart, volumeEnd, state.min_chapter_words || 2500);
        resolvedPacing = guidance.pacingTarget;
        if (!resolvedNarrative) {
          resolvedNarrative = guidance.pacingType;
        }
      } else if (!resolvedNarrative) {
        resolvedNarrative = getPacingTypeFromLevel(resolvedPacing);
      }

      // 检查是否是新弧起点
      const isArcOpening = (targetIdx - 1) % 30 === 0 && targetIdx > 3;

      const rules = buildCoreWritingRules({
        chapterIndex: targetIdx,
        totalChapters,
        isFinalChapter: isFinal,
        narrativeType: resolvedNarrative,
        pacingTarget: resolvedPacing,
        isArcOpening,
      });

      return { content: [{ type: 'text' as const, text: rules }] };
    },
  );

  server.tool(
    'get_pacing_guidance',
    '获取当前章节的节奏指导：紧张度目标、叙事类型、卷内位置、建议字数。基于三幕结构节奏曲线计算。',
    {
      project_id: z.string().describe('项目 ID'),
      chapter_index: z.number().optional().describe('章节索引（默认取下一章）'),
    },
    async ({ project_id, chapter_index }) => {
      const state = db.prepare(`
        SELECT s.*, p.total_chapters
        FROM states s JOIN projects p ON p.id = s.project_id
        WHERE s.project_id = ?
      `).get(project_id) as any;

      if (!state) {
        return { content: [{ type: 'text' as const, text: '项目不存在' }], isError: true };
      }

      const totalChapters = state.total_chapters || 100;
      const targetIdx = chapter_index || state.next_chapter_index || 1;
      const minWords = state.min_chapter_words || 2500;

      // 从大纲尝试获取真实卷范围
      let volumeStart = 1;
      let volumeEnd = totalChapters;

      const outlineRow = db.prepare(`SELECT outline_json FROM outlines WHERE project_id = ?`).get(project_id) as any;
      if (outlineRow) {
        try {
          const outline = JSON.parse(outlineRow.outline_json);
          if (outline.volumes) {
            for (const vol of outline.volumes) {
              if (vol.startChapter <= targetIdx && vol.endChapter >= targetIdx) {
                volumeStart = vol.startChapter;
                volumeEnd = vol.endChapter;
                break;
              }
            }
          }
        } catch { /* fallback to full book */ }
      }

      // 如果没有找到卷信息，按 30 章一卷
      if (volumeStart === 1 && volumeEnd === totalChapters && totalChapters > 40) {
        const volumeSize = 30;
        volumeStart = Math.floor((targetIdx - 1) / volumeSize) * volumeSize + 1;
        volumeEnd = Math.min(volumeStart + volumeSize - 1, totalChapters);
      }

      const guidance = getChapterPacingGuidance(targetIdx, volumeStart, volumeEnd, minWords);

      const output: string[] = [];
      output.push(`# 第${targetIdx}章 节奏指导\n`);
      output.push(guidance.guidance);
      output.push(`\n## 叙事类型说明`);
      output.push(NARRATIVE_RECIPES[guidance.pacingType]);

      // 提供前后章对比
      if (targetIdx > volumeStart) {
        const prevGuidance = getChapterPacingGuidance(targetIdx - 1, volumeStart, volumeEnd, minWords);
        const diff = guidance.pacingTarget - prevGuidance.pacingTarget;
        if (Math.abs(diff) >= 1) {
          output.push(`\n## 节奏变化`);
          output.push(`相对上一章: ${diff > 0 ? '↑' : '↓'} ${Math.abs(diff).toFixed(1)} (${prevGuidance.pacingTarget.toFixed(1)} → ${guidance.pacingTarget.toFixed(1)})`);
          if (diff > 2) {
            output.push(`💡 紧张度大幅提升 — 注意节奏切换不要太突兀，用开头 1-2 段完成过渡`);
          } else if (diff < -2) {
            output.push(`💡 紧张度大幅下降 — 这是喘息章，但仍需要微爽点维持兴趣`);
          }
        }
      }

      return { content: [{ type: 'text' as const, text: output.join('\n') }] };
    },
  );

  server.tool(
    'list_narrative_types',
    '列出所有可用的叙事类型及其写作要点。帮助选择合适的节奏类型。',
    {},
    async () => {
      const lines: string[] = ['# 叙事类型参考\n'];
      for (const [type, recipe] of Object.entries(NARRATIVE_RECIPES)) {
        lines.push(`## ${type}`);
        lines.push(recipe);
        lines.push('');
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
