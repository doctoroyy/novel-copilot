/**
 * ReAct Agent 工具执行器
 *
 * 包装现有模块（plotManager, characterStateManager, timelineManager 等），
 * 暴露为 Agent 可调用的工具函数。
 */

import type { ToolCall } from './types.js';
import type { ToolContext } from './tools.js';
import type { AIConfig, AICallOptions } from '../services/aiClient.js';
import { generateTextWithRetry } from '../services/aiClient.js';
import { buildPlotContext } from '../context/plotManager.js';
import { optimizePlotContext } from '../contextOptimizer.js';
import { getActiveCharacterSnapshots, formatSnapshotForPrompt } from '../types/characterState.js';
import { getRecentlyCompletedEvents, getActiveEvents, getCompletedEvents } from '../types/timeline.js';
import { formatTimelineContext } from '../types/timeline.js';
import { quickChapterFormatHeuristic } from '../qc.js';

export class ToolExecutor {
  private currentDraft: string | null = null;

  constructor(
    private ctx: ToolContext,
    private aiConfig: AIConfig,
    private callOptions?: AICallOptions,
  ) {}

  setCurrentDraft(draft: string | null): void {
    this.currentDraft = draft;
  }

  getCurrentDraft(): string | null {
    return this.currentDraft;
  }

  /**
   * Short-output structured tools (design_scene_sequence, evaluate_draft,
   * query_reader_expectations) only return ~600-1000 tokens of JSON. They
   * should not consume the full 5-minute AI timeout × 2 retries — that puts
   * a single tool call within reach of the 12-minute chapter task stale
   * threshold. Cap them at 90s × 1 retry so each tool call cannot exceed
   * ~3 minutes total.
   */
  private get shortToolCallOptions(): AICallOptions {
    return { ...(this.callOptions || {}), timeoutMs: 90_000, maxRetries: 1 };
  }

  async execute(call: ToolCall): Promise<string> {
    switch (call.tool) {
      // ---- Native agent tools (Phase 0 Direct Adapter) ----
      case 'read_story_vault':
        return this.queryPlotGraph(call.args.aspect || 'full_summary');
      case 'read_chapter':
        return this.readChapter(call.args.chapter_index);
      case 'read_summary':
        return this.readSummary(call.args.scope || 'recent_3');
      case 'run_qc':
        return this.runQc(call.args.chapter_text);
      case 'search_references':
        return this.searchReferences(call.args.query || '');

      // ---- Legacy ReAct tools (kept for explore / compatibility) ----
      case 'query_plot_graph':
        return this.queryPlotGraph(call.args.aspect);
      case 'query_character_state':
        return this.queryCharacterState(call.args.character_name);
      case 'query_timeline':
        return this.queryTimeline(call.args.scope);
      case 'query_reader_expectations':
        return this.queryReaderExpectations();
      case 'analyze_conflict_density':
        return this.analyzeConflictDensity(call.args.lookback_chapters ?? 5);
      case 'check_foreshadowing_opportunities':
        return this.checkForeshadowingOpportunities();
      case 'design_scene_sequence':
        return this.designSceneSequence(call.args.goal, call.args.constraints);
      case 'evaluate_draft':
        return this.evaluateDraft(call.args.focus ?? 'all');
      case 'soft_validate':
        return this.softValidate();
      case 'rewrite_section':
        return this.rewriteSection(call.args.section, call.args.guidance);
      case 'write_chapter':
        return this.writeChapter(call.args.scene_plan, call.args.writing_notes);
      case 'finish':
        return '[FINISH_SIGNAL]' + (call.args.chapter_text || '');
      default:
        return `Unknown tool: ${call.tool}`;
    }
  }

  // ========== 纯数据查询工具（不消耗 AI 调用） ==========

  private readChapter(chapterIndex: number): string {
    const { lastChapters, chapterIndex: currentIndex } = this.ctx;
    if (!Number.isFinite(chapterIndex) || chapterIndex < 1) {
      return '章节序号无效。请传入 >= 1 的整数。';
    }

    // lastChapters 通常是最近 N 章正文，按章节号倒推定位
    if (lastChapters.length > 0) {
      const offsetFromCurrent = currentIndex - chapterIndex;
      const idxFromEnd = offsetFromCurrent - 1;
      if (idxFromEnd >= 0 && idxFromEnd < lastChapters.length) {
        const text = lastChapters[lastChapters.length - 1 - idxFromEnd];
        return JSON.stringify({
          chapter_index: chapterIndex,
          available: true,
          text: text.slice(0, 12000),
          truncated: text.length > 12000,
        }, null, 2);
      }
    }

    return JSON.stringify({
      chapter_index: chapterIndex,
      available: false,
      message: `当前上下文中没有第 ${chapterIndex} 章原文。可用最近章节序号大致范围：${Math.max(1, currentIndex - lastChapters.length)} ~ ${currentIndex - 1}`,
    }, null, 2);
  }

  private readSummary(scope: string): string {
    const { rollingSummary, openLoops, chapterIndex } = this.ctx;
    const summary = rollingSummary || '（暂无滚动摘要）';

    if (scope === 'all_major') {
      return JSON.stringify({
        scope,
        chapterIndex,
        rollingSummary: summary,
        openLoops,
      }, null, 2);
    }

    // recent_3 / recent_10：摘要本身已是压缩记忆，直接返回并附带 open loops
    return JSON.stringify({
      scope,
      chapterIndex,
      rollingSummary: summary,
      openLoops: openLoops.slice(0, scope === 'recent_10' ? 12 : 6),
      note: '滚动摘要已按近详远略压缩；如需原文细节请调用 read_chapter。',
    }, null, 2);
  }

  private async runQc(chapterText: string): Promise<string> {
    if (!chapterText || chapterText.replace(/\s/g, '').length < 20) {
      return '章节文本过短，无法进行质量检查。';
    }

    this.setCurrentDraft(chapterText);
    const heuristicRaw = this.softValidate();
    let heuristic: unknown = heuristicRaw;
    try {
      heuristic = JSON.parse(heuristicRaw);
    } catch {
      // keep raw string
    }

    try {
      const llmEval = await this.evaluateDraft('all');
      return JSON.stringify({
        heuristic,
        llmEvaluation: llmEval,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        heuristic,
        llmEvaluationError: (error as Error).message,
      }, null, 2);
    }
  }

  private searchReferences(query: string): string {
    const q = (query || '').trim().toLowerCase();
    if (!q) return '请提供搜索关键词。';

    const hits: Array<{ source: string; snippet: string }> = [];
    const { bible, characterStates, plotGraph, enhancedOutline } = this.ctx;

    if (bible) {
      const lines = bible.split('\n').filter(line => line.toLowerCase().includes(q));
      for (const line of lines.slice(0, 8)) {
        hits.push({ source: 'bible', snippet: line.trim().slice(0, 300) });
      }
    }

    if (characterStates) {
      for (const snap of Object.values(characterStates.snapshots || {})) {
        const blob = `${snap.characterName} ${snap.physical?.location || ''} ${snap.psychological?.motivation || ''}`.toLowerCase();
        if (blob.includes(q) || snap.characterName.toLowerCase().includes(q)) {
          hits.push({
            source: 'character_state',
            snippet: `${snap.characterName}: ${snap.physical?.location || '?'} / ${snap.psychological?.mood || '?'} / ${snap.psychological?.motivation || '?'}`,
          });
        }
      }
    }

    if (plotGraph) {
      for (const node of plotGraph.nodes || []) {
        if ((node.content || '').toLowerCase().includes(q)) {
          hits.push({
            source: 'plot_graph',
            snippet: `[${node.type}] ${node.content}`.slice(0, 300),
          });
        }
      }
      for (const f of plotGraph.pendingForeshadowing || []) {
        const text = f.summary || '';
        if (text.toLowerCase().includes(q)) {
          hits.push({
            source: 'foreshadowing',
            snippet: `[${f.urgency}] ${text}`.slice(0, 300),
          });
        }
      }
    }

    if (enhancedOutline) {
      const outlineText = JSON.stringify(enhancedOutline);
      if (outlineText.toLowerCase().includes(q)) {
        hits.push({
          source: 'chapter_outline',
          snippet: `本章大纲命中关键词「${query}」：goal=${enhancedOutline.goal?.primary || ''} hook=${enhancedOutline.hook?.content || ''}`.slice(0, 300),
        });
      }
    }

    return JSON.stringify({
      query,
      hitCount: hits.length,
      hits: hits.slice(0, 20),
      message: hits.length === 0 ? '未找到匹配参考资料。可尝试更短关键词，或改用 read_story_vault。' : undefined,
    }, null, 2);
  }

  private queryPlotGraph(aspect: string): string {
    const { plotGraph, chapterIndex, totalChapters, bible } = this.ctx;
    if (!plotGraph || plotGraph.nodes.length === 0) {
      return [
        '剧情图谱为空，这可能是故事的开头部分。',
        bible ? `【Story Bible 摘要】\n${bible.slice(0, 2000)}` : '',
      ].filter(Boolean).join('\n\n');
    }

    switch (aspect) {
      case 'active_plots': {
        const mainPlots = plotGraph.activeMainPlots
          .map(id => plotGraph.nodes.find(n => n.id === id))
          .filter(Boolean);
        const subPlots = plotGraph.activeSubPlots
          .map(id => plotGraph.nodes.find(n => n.id === id))
          .filter(Boolean);
        return JSON.stringify({ mainPlots, subPlots }, null, 2);
      }
      case 'pending_foreshadowing':
        return JSON.stringify(plotGraph.pendingForeshadowing, null, 2);
      case 'recent_events':
        return JSON.stringify(
          plotGraph.nodes
            .filter(n => n.status === 'active' && chapterIndex - n.introducedAt <= 10)
            .sort((a, b) => b.introducedAt - a.introducedAt)
            .slice(0, 8),
          null, 2,
        );
      case 'causal_chains': {
        // 获取活跃节点的因果链
        const activeNodes = plotGraph.nodes.filter(n => n.status === 'active');
        const relevantEdges = plotGraph.edges.filter(
          e => e.relation === 'causes' || e.relation === 'enables' || e.relation === 'foreshadows',
        );
        return JSON.stringify({
          activeNodes: activeNodes.slice(0, 10).map(n => ({ id: n.id, content: n.content, type: n.type })),
          causalEdges: relevantEdges.slice(0, 15).map(e => ({
            from: e.from, to: e.to, relation: e.relation, description: e.description,
          })),
        }, null, 2);
      }
      case 'full_summary':
        return buildPlotContext(plotGraph, chapterIndex, totalChapters);
      default:
        return optimizePlotContext(plotGraph, chapterIndex, 2000);
    }
  }

  private queryCharacterState(name: string): string {
    const { characterStates, chapterIndex } = this.ctx;
    if (!characterStates) return '角色状态系统未初始化。';

    if (name === 'all') {
      const snapshots = getActiveCharacterSnapshots(characterStates, chapterIndex, 10);
      return JSON.stringify(
        snapshots.map(s => ({
          name: s.characterName,
          location: s.physical.location,
          condition: s.physical.condition,
          mood: s.psychological.mood,
          motivation: s.psychological.motivation,
          recentChanges: s.recentChanges.slice(-2),
        })),
        null, 2,
      );
    }

    const snapshot = Object.values(characterStates.snapshots)
      .find(s => s.characterName.includes(name) || s.characterId.includes(name));
    if (!snapshot) return `未找到角色: ${name}`;
    return formatSnapshotForPrompt(snapshot);
  }

  private queryTimeline(scope: string): string {
    const { timeline, chapterIndex } = this.ctx;
    if (!timeline || timeline.events.length === 0) return '时间线为空。';

    switch (scope) {
      case 'recent_5': {
        const recent = getRecentlyCompletedEvents(timeline, chapterIndex, 5);
        const active = getActiveEvents(timeline);
        return JSON.stringify({ recentCompleted: recent, activeEvents: active }, null, 2);
      }
      case 'recent_10': {
        const recent = getRecentlyCompletedEvents(timeline, chapterIndex, 10);
        const active = getActiveEvents(timeline);
        return JSON.stringify({ recentCompleted: recent, activeEvents: active }, null, 2);
      }
      case 'all_major': {
        const completed = getCompletedEvents(timeline);
        return JSON.stringify(completed.slice(-20), null, 2);
      }
      default:
        return formatTimelineContext(timeline, chapterIndex, new Map());
    }
  }

  private analyzeConflictDensity(lookback: number): string {
    const { plotGraph, chapterIndex } = this.ctx;
    if (!plotGraph) return '无剧情图谱数据。';

    const recentConflicts = plotGraph.nodes
      .filter(n =>
        (n.type === 'conflict' || n.type === 'turning_point') &&
        chapterIndex - n.introducedAt <= lookback,
      );
    const recentResolutions = plotGraph.nodes
      .filter(n =>
        n.type === 'resolution' &&
        n.resolvedAt != null && chapterIndex - n.resolvedAt <= lookback,
      );

    const density = lookback > 0 ? recentConflicts.length / lookback : 0;
    return JSON.stringify({
      lookbackChapters: lookback,
      conflictCount: recentConflicts.length,
      resolutionCount: recentResolutions.length,
      conflicts: recentConflicts.map(c => ({
        content: c.content, chapter: c.introducedAt, importance: c.importance,
      })),
      resolutions: recentResolutions.map(r => ({
        content: r.content, chapter: r.resolvedAt,
      })),
      density,
      assessment: density < 0.5
        ? 'LOW - 冲突密度偏低，故事可能显得平淡'
        : density > 1.5
          ? 'HIGH - 冲突过密，读者可能疲劳'
          : 'NORMAL - 冲突密度适中',
    }, null, 2);
  }

  private checkForeshadowingOpportunities(): string {
    const { plotGraph, chapterIndex, totalChapters, enhancedOutline } = this.ctx;
    if (!plotGraph) return '无剧情图谱数据。';

    const canResolve = plotGraph.pendingForeshadowing
      .filter(f => chapterIndex >= f.suggestedResolutionRange[0]);

    const shouldPlant = chapterIndex < totalChapters * 0.8;

    return JSON.stringify({
      canResolveNow: canResolve.map(f => ({
        id: f.id,
        summary: f.summary,
        urgency: f.urgency,
        age: f.ageInChapters,
      })),
      shouldPlantNew: shouldPlant,
      currentForeshadowingCount: plotGraph.pendingForeshadowing.length,
      chapterGoal: enhancedOutline?.goal?.primary ?? '(无大纲目标)',
    }, null, 2);
  }

  // ========== AI 增强工具（消耗 AI 调用） ==========

  private async queryReaderExpectations(): Promise<string> {
    const { rollingSummary, openLoops, lastChapters } = this.ctx;
    const lastChapterEnding = lastChapters.length
      ? lastChapters[lastChapters.length - 1].slice(-800)
      : '(无)';

    const prompt = `基于以下故事状态，模拟一个读者的视角分析：

【剧情摘要】
${rollingSummary.slice(0, 2000)}

【未解伏笔】
${openLoops.map((l, i) => `${i + 1}. ${l}`).join('\n') || '(无)'}

【上一章结尾】
${lastChapterEnding}

请以 JSON 输出：
{
  "predictions": ["读者最可能预测的3个剧情走向"],
  "burning_questions": ["读者最想知道答案的3个问题"],
  "emotional_state": "读者此刻的情感状态",
  "engagement_risk": "当前最大的脱离风险（可能让读者弃读的因素）",
  "desire": "读者最渴望看到什么"
}`;

    return generateTextWithRetry(this.aiConfig, {
      system: '你是一个资深网文读者模拟器。请从读者视角分析故事状态。只输出 JSON。',
      prompt,
      temperature: 0.5,
      maxTokens: 600,
    }, 2, this.shortToolCallOptions);
  }

  private async designSceneSequence(goal: string, constraints?: string): Promise<string> {
    const { chapterIndex, totalChapters, rollingSummary, narrativeGuide } = this.ctx;

    const prompt = `请为本章设计详细的场景序列。

【章节信息】第${chapterIndex}/${totalChapters}章
【章节目标】${goal}
【节奏要求】${narrativeGuide
    ? `${narrativeGuide.pacingType} (${narrativeGuide.pacingTarget}/10)`
    : '默认'}
${constraints ? `【额外约束】${constraints}` : ''}

【剧情摘要】
${rollingSummary.slice(0, 1500)}

请输出 JSON：
{
  "scenes": [
    {
      "order": 1,
      "purpose": "场景目的",
      "viewpoint": "视角角色",
      "conflict": "本场景的冲突/张力来源",
      "new_information": "场景引入的新信息",
      "emotional_beat": "情感节拍(如: 紧张→震惊→决意)",
      "estimated_words": 800
    }
  ],
  "chapter_arc": "本章的情感弧线描述",
  "hook_design": "章末钩子设计"
}`;

    return generateTextWithRetry(this.aiConfig, {
      system: '你是专业的小说结构设计师。设计的场景序列要确保冲突推进、信息密度和情感波动。只输出 JSON。',
      prompt,
      temperature: 0.6,
      maxTokens: 1000,
    }, 2, this.shortToolCallOptions);
  }

  private async evaluateDraft(focus: string): Promise<string> {
    if (!this.currentDraft) return '当前没有草稿可评估。请先调用 write_chapter 生成草稿。';

    const prompt = `请评估以下章节草稿的质量。

【章节草稿】
${this.currentDraft.slice(0, 6000)}

${focus !== 'all' ? `【重点评估】${focus}` : ''}

请输出 JSON：
{
  "scores": {
    "conflict_intensity": { "score": 7, "reason": "..." },
    "character_consistency": { "score": 7, "reason": "..." },
    "pacing": { "score": 7, "reason": "..." },
    "reader_engagement": { "score": 7, "reason": "..." },
    "hook_quality": { "score": 7, "reason": "..." }
  },
  "overall": 7,
  "critical_issues": ["必须修复的问题"],
  "improvement_suggestions": ["可以更好的建议"],
  "strongest_part": "最成功的部分",
  "weakest_part": "最需要改进的部分"
}`;

    return generateTextWithRetry(this.aiConfig, {
      system: '你是资深小说编辑。请客观评估章节质量。只输出 JSON。',
      prompt,
      temperature: 0.3,
      maxTokens: 800,
    }, 2, this.shortToolCallOptions);
  }

  /**
   * write_chapter 和 rewrite_section 返回特殊信号，
   * 由 Orchestrator 拦截后触发实际写作。
   */
  private writeChapter(scenePlan: string, writingNotes: string): string {
    return '[WRITE_CHAPTER_SIGNAL]' + JSON.stringify({ scenePlan, writingNotes });
  }

  private rewriteSection(section: string, guidance: string): string {
    return '[REWRITE_SECTION_SIGNAL]' + JSON.stringify({ section, guidance });
  }

  /** 本地快速校验草稿（不消耗 AI 调用） */
  private softValidate(): string {
    if (!this.currentDraft) return '当前没有草稿可校验。请先调用 write_chapter 生成草稿。';
    const minWords = this.ctx.minChapterWords || 2500;
    const minChars = minWords * 2; // 中文 1 字 ≈ 2 字符
    const result = quickChapterFormatHeuristic(this.currentDraft, { minBodyChars: minChars });

    // 提取正文字数（去掉标题行）
    const lines = this.currentDraft.split('\n');
    const bodyStartIndex = lines.findIndex((l, i) => i > 0 && l.trim().length > 0);
    const bodyText = bodyStartIndex > 0 ? lines.slice(bodyStartIndex).join('\n') : this.currentDraft;
    const wordCount = bodyText.replace(/\s/g, '').length;

    return JSON.stringify({
      wordCount,
      targetMinWords: minWords,
      wordCountStatus: wordCount >= minWords ? 'PASS' : `FAIL - 差 ${minWords - wordCount} 字`,
      heuristicIssues: result.blockingReasons.concat(result.reviewReasons),
      totalChars: this.currentDraft.length,
    }, null, 2);
  }
}
