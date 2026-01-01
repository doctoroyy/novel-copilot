/**
 * 剧情图谱管理器
 *
 * 负责：
 * 1. 从章节内容中提取剧情事件和伏笔
 * 2. 维护因果链关系
 * 3. 追踪伏笔状态并生成回收提醒
 */

import { generateTextWithRetry, type AIConfig } from '../services/aiClient.js';
import {
  type PlotGraph,
  type PlotNode,
  type PlotEdge,
  type AIPlotAnalysis,
  type PendingForeshadowing,
  createEmptyPlotGraph,
  generateNodeId,
  generateEdgeId,
  updatePendingForeshadowing,
  formatForeshadowingReminder,
  formatActivePlotLines,
  updateNodeStatus,
} from '../types/plotGraph.js';
import { z } from 'zod';

/**
 * AI 剧情分析结果的 Schema
 */
const PlotAnalysisSchema = z.object({
  newNodes: z.array(
    z.object({
      type: z.enum([
        'event',
        'foreshadowing',
        'secret',
        'conflict',
        'resolution',
        'revelation',
        'turning_point',
      ]),
      content: z.string(),
      characters: z.array(z.string()),
      importance: z.number().min(1).max(10),
      tags: z.array(z.string()),
      isMainPlot: z.boolean().optional(),
    })
  ),
  newEdges: z.array(
    z.object({
      fromContent: z.string(),
      toContent: z.string(),
      relation: z.enum([
        'causes',
        'enables',
        'blocks',
        'foreshadows',
        'resolves',
        'contradicts',
        'parallels',
      ]),
      description: z.string(),
    })
  ),
  statusUpdates: z.array(
    z.object({
      nodeContent: z.string(),
      newStatus: z.enum(['active', 'resolved', 'abandoned', 'transformed']),
    })
  ),
  foreshadowingResolutions: z.array(
    z.object({
      foreshadowingContent: z.string(),
      resolutionDescription: z.string(),
    })
  ),
});

/**
 * 分析章节内容，提取剧情事件和伏笔变化
 */
export async function analyzeChapterForPlotChanges(
  aiConfig: AIConfig,
  chapterText: string,
  chapterIndex: number,
  currentGraph: PlotGraph
): Promise<AIPlotAnalysis> {
  const system = `
你是一个专业的小说剧情分析师。你的任务是分析章节内容，提取重要的剧情事件、伏笔和因果关系。

【分析要点】

1. 新增节点 (newNodes):
   - event: 重要事件（战斗、相遇、离别、获得等）
   - foreshadowing: 伏笔（暗示、预兆、隐藏线索）
   - secret: 秘密（角色隐藏的信息）
   - conflict: 冲突（矛盾爆发）
   - resolution: 解决（问题被解决）
   - revelation: 揭示（真相大白）
   - turning_point: 转折点（命运改变）

2. 新增边 (newEdges):
   - causes: A导致B发生
   - enables: A使B成为可能
   - blocks: A阻止B
   - foreshadows: A预示B
   - resolves: A解决B
   - contradicts: A与B矛盾
   - parallels: A与B形成对照

3. 状态更新 (statusUpdates):
   - 之前的伏笔/事件是否被解决或改变

4. 伏笔回收 (foreshadowingResolutions):
   - 本章是否回收了之前埋下的伏笔

【重要性评分标准】
- 10: 决定整体走向的核心事件
- 7-9: 重要转折或关键发现
- 4-6: 中等重要性的剧情推进
- 1-3: 小的细节或暗示

【输出格式】
只输出 JSON，不要有任何其他文字:
{
  "newNodes": [
    {
      "type": "event|foreshadowing|secret|conflict|resolution|revelation|turning_point",
      "content": "简明描述（30字以内）",
      "characters": ["角色ID或名字"],
      "importance": 1-10,
      "tags": ["标签1", "标签2"],
      "isMainPlot": true/false
    }
  ],
  "newEdges": [
    {
      "fromContent": "起始节点内容（需与已有或新增节点匹配）",
      "toContent": "目标节点内容",
      "relation": "关系类型",
      "description": "关系说明"
    }
  ],
  "statusUpdates": [
    {
      "nodeContent": "节点内容（需与已有节点匹配）",
      "newStatus": "resolved|abandoned|transformed"
    }
  ],
  "foreshadowingResolutions": [
    {
      "foreshadowingContent": "被回收的伏笔内容",
      "resolutionDescription": "如何被回收的"
    }
  ]
}

【注意事项】
- 只提取重要的剧情点，不要记录每个细节
- 每章通常产生 1-5 个新节点
- 伏笔必须是有意义的暗示，不是普通描述
- 如果没有发现重要变化，返回空数组
`.trim();

  // 构建当前剧情概要
  const existingNodesContext = currentGraph.nodes
    .filter((n) => n.status === 'active')
    .slice(-20)
    .map((n) => `[${n.type}] ${n.content} (第${n.introducedAt}章)`)
    .join('\n');

  const pendingForeshadowing = currentGraph.pendingForeshadowing
    .slice(0, 5)
    .map((p) => `- ${p.summary} (已${p.ageInChapters}章)`)
    .join('\n');

  const prompt = `
【当前活跃剧情节点】
${existingNodesContext || '（无）'}

【待回收伏笔】
${pendingForeshadowing || '（无）'}

【本章内容 - 第${chapterIndex}章】
${chapterText.slice(0, 6000)}

请分析本章的剧情变化:
`.trim();

  try {
    const raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.3,
    });

    const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
    const parsed = PlotAnalysisSchema.parse(JSON.parse(jsonText));

    // 转换为内部格式
    return convertParsedAnalysis(parsed, chapterIndex, currentGraph);
  } catch (error) {
    console.warn('Plot analysis parsing failed:', error);
    return {
      newNodes: [],
      newEdges: [],
      statusUpdates: [],
      foreshadowingResolutions: [],
    };
  }
}

/**
 * 转换解析结果为内部格式
 */
function convertParsedAnalysis(
  parsed: z.infer<typeof PlotAnalysisSchema>,
  chapterIndex: number,
  currentGraph: PlotGraph
): AIPlotAnalysis {
  const newNodes: Omit<PlotNode, 'id'>[] = parsed.newNodes.map((n) => ({
    type: n.type,
    content: n.content,
    characters: n.characters,
    introducedAt: chapterIndex,
    importance: n.importance,
    status: 'active' as const,
    tags: n.tags,
  }));

  // 构建内容到ID的映射（包括新节点）
  const contentToId = new Map<string, string>();
  for (const node of currentGraph.nodes) {
    contentToId.set(node.content, node.id);
  }
  for (const node of newNodes) {
    const id = generateNodeId(node.type, chapterIndex);
    contentToId.set(node.content, id);
  }

  const newEdges: Omit<PlotEdge, 'id'>[] = parsed.newEdges
    .map((e) => {
      const fromId = contentToId.get(e.fromContent);
      const toId = contentToId.get(e.toContent);

      if (!fromId || !toId) return null;

      return {
        from: fromId,
        to: toId,
        relation: e.relation,
        description: e.description,
        establishedAt: chapterIndex,
      };
    })
    .filter(Boolean) as Omit<PlotEdge, 'id'>[];

  const statusUpdates = parsed.statusUpdates
    .map((u) => {
      const node = currentGraph.nodes.find((n) => n.content === u.nodeContent);
      if (!node) return null;

      return {
        nodeId: node.id,
        newStatus: u.newStatus as PlotNode['status'],
        resolvedAt: u.newStatus === 'resolved' ? chapterIndex : undefined,
      };
    })
    .filter(Boolean) as AIPlotAnalysis['statusUpdates'];

  const foreshadowingResolutions = parsed.foreshadowingResolutions
    .map((r) => {
      const foreshadowing = currentGraph.nodes.find(
        (n) => n.type === 'foreshadowing' && n.content === r.foreshadowingContent
      );
      if (!foreshadowing) return null;

      return {
        foreshadowingId: foreshadowing.id,
        resolvedAt: chapterIndex,
      };
    })
    .filter(Boolean) as AIPlotAnalysis['foreshadowingResolutions'];

  return {
    newNodes,
    newEdges,
    statusUpdates,
    foreshadowingResolutions,
  };
}

/**
 * 应用剧情分析结果到图谱
 */
export function applyPlotAnalysis(
  graph: PlotGraph,
  analysis: AIPlotAnalysis,
  chapterIndex: number,
  totalChapters: number
): PlotGraph {
  let updated = { ...graph, lastUpdatedChapter: chapterIndex };

  // 1. 添加新节点
  for (const node of analysis.newNodes) {
    const id = generateNodeId(node.type, node.introducedAt);
    const newNode: PlotNode = { ...node, id };
    updated.nodes = [...updated.nodes, newNode];

    // 根据重要程度决定是否为主线
    if (node.importance >= 7) {
      updated.activeMainPlots = [...updated.activeMainPlots, id];
    } else if (node.type !== 'foreshadowing') {
      updated.activeSubPlots = [...updated.activeSubPlots, id];
    }
  }

  // 2. 添加新边
  for (const edge of analysis.newEdges) {
    const id = generateEdgeId(edge.from, edge.to, edge.relation);
    const newEdge: PlotEdge = { ...edge, id };
    updated.edges = [...updated.edges, newEdge];
  }

  // 3. 更新状态
  for (const statusUpdate of analysis.statusUpdates) {
    updated = updateNodeStatus(
      updated,
      statusUpdate.nodeId,
      statusUpdate.newStatus,
      statusUpdate.resolvedAt
    );
  }

  // 4. 处理伏笔回收
  for (const resolution of analysis.foreshadowingResolutions) {
    updated = updateNodeStatus(
      updated,
      resolution.foreshadowingId,
      'resolved',
      resolution.resolvedAt
    );
  }

  // 5. 更新待回收伏笔列表
  updated.pendingForeshadowing = updatePendingForeshadowing(
    updated,
    chapterIndex,
    totalChapters
  );

  return updated;
}

/**
 * 生成用于章节生成 prompt 的剧情上下文
 */
export function buildPlotContext(
  graph: PlotGraph,
  chapterIndex: number,
  totalChapters: number
): string {
  if (graph.nodes.length === 0) {
    return '';
  }

  const parts: string[] = [];

  // 1. 伏笔回收提醒
  const foreshadowingReminder = formatForeshadowingReminder(
    graph.pendingForeshadowing,
    5
  );
  if (foreshadowingReminder) {
    parts.push(foreshadowingReminder);
  }

  // 2. 活跃剧情线
  const plotLines = formatActivePlotLines(graph);
  if (plotLines) {
    parts.push(plotLines);
  }

  // 3. 近期重要事件
  const recentEvents = graph.nodes
    .filter(
      (n) =>
        n.status === 'active' &&
        n.type !== 'foreshadowing' &&
        chapterIndex - n.introducedAt <= 10
    )
    .sort((a, b) => b.introducedAt - a.introducedAt)
    .slice(0, 5);

  if (recentEvents.length > 0) {
    parts.push('【近期重要事件】');
    recentEvents.forEach((e, i) => {
      parts.push(`  ${i + 1}. 第${e.introducedAt}章: ${e.content}`);
    });
  }

  // 4. 因果链提醒
  const causalChains = buildCausalChainReminder(graph, chapterIndex);
  if (causalChains) {
    parts.push(causalChains);
  }

  if (parts.length === 0) {
    return '';
  }

  return parts.join('\n\n');
}

/**
 * 构建因果链提醒
 */
function buildCausalChainReminder(
  graph: PlotGraph,
  currentChapter: number
): string {
  // 找出最近埋下的因果关系
  const recentCausalEdges = graph.edges
    .filter(
      (e) =>
        (e.relation === 'causes' || e.relation === 'enables') &&
        currentChapter - e.establishedAt <= 20
    )
    .slice(0, 3);

  if (recentCausalEdges.length === 0) {
    return '';
  }

  const parts: string[] = ['【因果链提醒】'];
  parts.push('以下因果关系需要在后续章节中体现：');

  for (const edge of recentCausalEdges) {
    const fromNode = graph.nodes.find((n) => n.id === edge.from);
    const toNode = graph.nodes.find((n) => n.id === edge.to);

    if (fromNode && toNode && toNode.status === 'active') {
      parts.push(
        `  - "${fromNode.content}" ${edge.relation === 'causes' ? '将导致' : '将使'} "${toNode.content}"`
      );
    }
  }

  return parts.join('\n');
}

/**
 * 获取图谱统计信息
 */
export function getGraphStats(graph: PlotGraph): {
  totalNodes: number;
  activeNodes: number;
  resolvedNodes: number;
  totalForeshadowing: number;
  pendingForeshadowing: number;
  totalEdges: number;
} {
  return {
    totalNodes: graph.nodes.length,
    activeNodes: graph.nodes.filter((n) => n.status === 'active').length,
    resolvedNodes: graph.nodes.filter((n) => n.status === 'resolved').length,
    totalForeshadowing: graph.nodes.filter((n) => n.type === 'foreshadowing').length,
    pendingForeshadowing: graph.pendingForeshadowing.length,
    totalEdges: graph.edges.length,
  };
}

/**
 * 手动添加伏笔
 */
export function manualAddForeshadowing(
  graph: PlotGraph,
  content: string,
  characters: string[],
  importance: number,
  chapter: number,
  totalChapters: number
): PlotGraph {
  const id = generateNodeId('foreshadowing', chapter);
  const newNode: PlotNode = {
    id,
    type: 'foreshadowing',
    content,
    characters,
    introducedAt: chapter,
    importance,
    status: 'active',
    tags: ['manual'],
  };

  const updated: PlotGraph = {
    ...graph,
    nodes: [...graph.nodes, newNode],
  };

  updated.pendingForeshadowing = updatePendingForeshadowing(
    updated,
    chapter,
    totalChapters
  );

  return updated;
}

/**
 * 手动回收伏笔
 */
export function manualResolveForeshadowing(
  graph: PlotGraph,
  foreshadowingId: string,
  chapter: number,
  totalChapters: number
): PlotGraph {
  let updated = updateNodeStatus(graph, foreshadowingId, 'resolved', chapter);
  updated.pendingForeshadowing = updatePendingForeshadowing(
    updated,
    chapter,
    totalChapters
  );
  return updated;
}
