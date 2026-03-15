/**
 * ExploreAgent 工具执行器
 *
 * 5 个工具：
 *   search_cached_templates — 搜索已有模板快照
 *   search_fanqie_rank     — 实时爬取番茄热榜
 *   search_web             — Bing 网页搜索
 *   analyze_and_generate   — AI 综合分析 + 生成 Bible
 *   finish                 — 确认最终输出
 */

import type { ToolCall } from '../types.js';
import type { ExploreToolContext } from './tools.js';
import {
  scrapeFanqieHotListWithPlaywright,
  getImagineTemplateSnapshot,
  type FanqieHotItem,
  type ImagineTemplate,
  type ImagineTemplateSnapshot,
} from '../../services/imagineTemplateService.js';
import { searchWebWithBing, type WebSearchResult } from '../../services/webSearchService.js';
import {
  generateTextWithRetry,
  generateTextWithFallback,
  AICallTracer,
  type FallbackConfig,
} from '../../services/aiClient.js';

const FINISH_SIGNAL = '[FINISH_SIGNAL]';

function buildFallbackConfig(ctx: ExploreToolContext): FallbackConfig {
  return {
    primary: ctx.aiConfig,
    fallback: ctx.fallbackConfigs,
    switchConditions: ['rate_limit', 'server_error', 'timeout', 'unknown'] as FallbackConfig['switchConditions'],
  };
}

export class ExploreToolExecutor {
  constructor(private ctx: ExploreToolContext) {}

  async execute(call: ToolCall): Promise<string> {
    switch (call.tool) {
      case 'search_cached_templates':
        return this.searchCachedTemplates(call.args.query as string);
      case 'search_fanqie_rank':
        return this.searchFanqieRank(call.args.category as string | undefined);
      case 'search_web':
        return this.searchWeb(call.args.query as string);
      case 'analyze_and_generate':
        return this.analyzeAndGenerate(
          call.args.search_data as string,
          call.args.user_concept as string,
        );
      case 'finish':
        return `${FINISH_SIGNAL}${call.args.bible || ''}`;
      default:
        return `[ERROR] 未知工具: ${call.tool}`;
    }
  }

  // ========== search_cached_templates ==========

  private async searchCachedTemplates(query: string): Promise<string> {
    if (!query) return '搜索关键词为空，无结果。';

    const keywords = query.toLowerCase().split(/[\s,，、]+/).filter(Boolean);

    // 获取最近的快照
    const rows = await this.ctx.db.prepare(`
      SELECT snapshot_date, templates_json, ranking_json
      FROM ai_imagine_template_snapshots
      WHERE status = 'ready'
      ORDER BY snapshot_date DESC
      LIMIT 5
    `).all();

    if (!rows.results?.length) {
      return '没有找到已缓存的模板快照数据。';
    }

    const matchedTemplates: Array<{ date: string; template: ImagineTemplate }> = [];
    const matchedRankings: Array<{ date: string; item: FanqieHotItem }> = [];

    for (const row of rows.results as any[]) {
      const date = row.snapshot_date as string;

      // 搜索模板
      try {
        const templates: ImagineTemplate[] = JSON.parse(row.templates_json || '[]');
        for (const tpl of templates) {
          const searchable = [
            tpl.name, tpl.genre, tpl.coreTheme,
            tpl.oneLineSellingPoint, ...(tpl.keywords || []),
            ...(tpl.sourceBooks || []),
          ].join(' ').toLowerCase();

          if (keywords.some(kw => searchable.includes(kw))) {
            matchedTemplates.push({ date, template: tpl });
          }
        }
      } catch { /* ignore parse errors */ }

      // 搜索排行
      try {
        const rankings: FanqieHotItem[] = JSON.parse(row.ranking_json || '[]');
        for (const item of rankings) {
          const searchable = [
            item.title, item.author, item.summary, item.category,
          ].filter(Boolean).join(' ').toLowerCase();

          if (keywords.some(kw => searchable.includes(kw))) {
            matchedRankings.push({ date, item });
          }
        }
      } catch { /* ignore parse errors */ }
    }

    // 格式化结果
    const parts: string[] = [];

    if (matchedTemplates.length > 0) {
      const tplTexts = matchedTemplates.slice(0, 5).map(({ date, template: t }) =>
        `[${date}] ${t.name} | 类型:${t.genre} | 主题:${t.coreTheme} | 卖点:${t.oneLineSellingPoint} | 关键词:${(t.keywords || []).join('、')} | 参考书:${(t.sourceBooks || []).join('、')}`
      );
      parts.push(`**匹配模板 (${matchedTemplates.length})**:\n${tplTexts.join('\n')}`);
    }

    if (matchedRankings.length > 0) {
      const rankTexts = matchedRankings.slice(0, 10).map(({ date, item }) =>
        `[${date}] #${item.rank} ${item.title}${item.author ? ` (${item.author})` : ''} | ${item.category || '未知'} | ${item.summary?.slice(0, 60) || '无摘要'}...`
      );
      parts.push(`**匹配排行书目 (${matchedRankings.length})**:\n${rankTexts.join('\n')}`);
    }

    if (parts.length === 0) {
      return `搜索"${query}"未找到匹配的缓存模板或排行数据。`;
    }

    return parts.join('\n\n');
  }

  // ========== search_fanqie_rank ==========

  private async searchFanqieRank(category?: string): Promise<string> {
    if (!this.ctx.browserBinding) {
      return '[SKIP] FANQIE_BROWSER 不可用，跳过番茄热榜爬取。';
    }

    try {
      const hotItems = await scrapeFanqieHotListWithPlaywright(
        { DB: this.ctx.db, FANQIE_BROWSER: this.ctx.browserBinding },
        { limit: 30 },
      );

      let filtered = hotItems;
      if (category) {
        const catLower = category.toLowerCase();
        filtered = hotItems.filter(item =>
          item.category?.toLowerCase().includes(catLower)
        );
        // 如果过滤后太少，返回全部
        if (filtered.length < 3) {
          filtered = hotItems;
        }
      }

      if (filtered.length === 0) {
        return '番茄热榜爬取完成，但未获取到有效数据。';
      }

      const lines = filtered.slice(0, 20).map(item =>
        `#${item.rank} ${item.title}${item.author ? ` (${item.author})` : ''} | ${item.category || '未知'} | ${item.summary?.slice(0, 80) || '无摘要'}`
      );

      return `**番茄热榜 (${filtered.length} 本${category ? `, 筛选: ${category}` : ''})**:\n${lines.join('\n')}`;
    } catch (err) {
      return `[ERROR] 番茄热榜爬取失败: ${(err as Error).message}`;
    }
  }

  // ========== search_web ==========

  private async searchWeb(query: string): Promise<string> {
    if (!this.ctx.browserBinding) {
      return '[SKIP] FANQIE_BROWSER 不可用，跳过网页搜索。';
    }

    if (!query) return '搜索关键词为空。';

    try {
      const results = await searchWebWithBing(this.ctx.browserBinding, query, 8);

      if (results.length === 0) {
        return `Bing 搜索"${query}"未返回结果。`;
      }

      const lines = results.map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`
      );

      return `**网页搜索结果 (${results.length})**:\n${lines.join('\n')}`;
    } catch (err) {
      return `[ERROR] 网页搜索失败: ${(err as Error).message}`;
    }
  }

  // ========== analyze_and_generate ==========

  private async analyzeAndGenerate(searchData: string, userConcept: string): Promise<string> {
    const { concept, genre, theme, keywords } = this.ctx;

    const system = `你是番茄/起点爆款网文策划专家。根据用户创意和实时市场数据，设计一部具有差异化竞争力的网文。

【市场数据】
${searchData}

【差异化要求】
- 不要照搬热门书的设定，要在热门赛道中找到未被充分开发的细分切口
- 参考热门书的结构模式（钩子手法、爽点节奏），但人设和世界观必须独创
- 如果搜索数据显示该赛道已过度饱和，主动建议融合其他元素制造差异

【输出格式 - Markdown】

# 《书名》

## 一句话卖点
（30字内，能让读者立刻想点进去的核心吸引力）

## 核心爽点设计
1. 爽点一：（描述 + 预计出现时机）
2. 爽点二：（描述 + 预计出现时机）
3. 爽点三：（描述 + 预计出现时机）

## 主角设定
- 姓名：
- 身份/职业：
- 前世/背景：
- 性格特点：
- 核心动机：（什么驱动他不断前进？）
- 金手指/系统：（详细描述能力、限制、成长空间）

## 配角矩阵
### 助力型配角
1. 配角A：（身份、与主角关系、作用）
### 反派/竞争者
1. 反派A：（身份、与主角的冲突、结局预期）

## 力量体系/社会阶层
（从最底层到最顶层的"天梯"设计，让读者能感受到主角的攀升路径）

## 世界观设定
（简洁但完整的世界背景）

## 主线剧情节点
1. 开篇危机：（第1-5章，主角遭遇什么困境？如何激发读者同情/好奇？）
2. 金手指觉醒：（主角如何获得能力？第一次使用的震撼感）
3. 第一次打脸：（谁看不起主角？主角如何证明自己？）
4. 中期高潮：（更大的挑战和更强的敌人）
5. 低谷转折：（主角遭遇挫折，如何逆转？）
6. 终极对决：（最终boss和主线冲突的解决）

## 开篇钩子设计
（第一章前100字应该怎么写？用什么场景/冲突/悬念抓住读者？给出具体的开篇思路）`;

    const prompt = `【用户创意】
${userConcept || concept}

【用户需求】
${genre ? `- 类型: ${genre}` : '- 类型: 未指定，请根据创意推断最适合的类型'}
${theme ? `- 主题/核心创意: ${theme}` : ''}
${keywords ? `- 关键词/元素: ${keywords}` : ''}

请基于以上市场数据和用户创意，生成一个能在番茄获得流量的完整 Story Bible：`;

    const tracer = new AICallTracer();

    let bible: string;
    if (this.ctx.fallbackConfigs?.length) {
      bible = await generateTextWithFallback(
        buildFallbackConfig(this.ctx),
        { system, prompt, temperature: 0.9 },
        2,
        { tracer, phase: 'outline', timeoutMs: 120_000 },
      );
    } else {
      bible = await generateTextWithRetry(
        this.ctx.aiConfig,
        { system, prompt, temperature: 0.9 },
        3,
        { tracer, phase: 'outline', timeoutMs: 120_000 },
      );
    }

    // 直接返回 FINISH_SIGNAL，省掉 finish 步骤
    return `${FINISH_SIGNAL}${bible}`;
  }
}
