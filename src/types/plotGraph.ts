/**
 * 剧情图谱系统 - 类型定义
 *
 * 用于追踪剧情事件、伏笔、因果链，解决剧情漂移和伏笔遗忘问题
 */

/**
 * 剧情节点类型
 */
export type PlotNodeType =
  | 'event'          // 重要事件
  | 'foreshadowing'  // 伏笔
  | 'secret'         // 秘密
  | 'conflict'       // 冲突
  | 'resolution'     // 解决
  | 'revelation'     // 揭示
  | 'turning_point'; // 转折点

/**
 * 剧情节点状态
 */
export type PlotNodeStatus =
  | 'active'       // 活跃中
  | 'resolved'     // 已解决/回收
  | 'abandoned'    // 已放弃
  | 'transformed'; // 已转化为其他形式

/**
 * 剧情节点
 */
export type PlotNode = {
  /** 唯一ID */
  id: string;

  /** 节点类型 */
  type: PlotNodeType;

  /** 节点内容/描述 */
  content: string;

  /** 涉及的角色ID列表 */
  characters: string[];

  /** 引入/发生的章节 */
  introducedAt: number;

  /** 解决/回收的章节 (如果已解决) */
  resolvedAt?: number;

  /** 重要程度 1-10 */
  importance: number;

  /** 当前状态 */
  status: PlotNodeStatus;

  /** 标签 (用于分类和搜索) */
  tags: string[];

  /** 备注 (人工添加的补充说明) */
  notes?: string;
};

/**
 * 剧情边的关系类型
 */
export type PlotEdgeRelation =
  | 'causes'       // A 导致 B
  | 'enables'      // A 使 B 成为可能
  | 'blocks'       // A 阻止 B
  | 'foreshadows'  // A 暗示/预示 B
  | 'resolves'     // A 解决 B
  | 'contradicts'  // A 与 B 矛盾
  | 'parallels';   // A 与 B 并行/对照

/**
 * 剧情边 (节点间的关系)
 */
export type PlotEdge = {
  /** 唯一ID */
  id: string;

  /** 起始节点ID */
  from: string;

  /** 目标节点ID */
  to: string;

  /** 关系类型 */
  relation: PlotEdgeRelation;

  /** 关系描述 */
  description: string;

  /** 建立关系的章节 */
  establishedAt: number;
};

/**
 * 伏笔紧迫程度
 */
export type ForeshadowingUrgency = 'low' | 'medium' | 'high' | 'critical';

/**
 * 待回收伏笔
 */
export type PendingForeshadowing = {
  /** 伏笔节点ID */
  id: string;

  /** 紧迫程度 */
  urgency: ForeshadowingUrgency;

  /** 建议回收的章节范围 */
  suggestedResolutionRange: [number, number];

  /** 距离埋下已过的章节数 */
  ageInChapters: number;

  /** 伏笔内容摘要 */
  summary: string;
};

/**
 * 剧情图谱
 */
export type PlotGraph = {
  /** 数据版本 */
  version: string;

  /** 最后更新章节 */
  lastUpdatedChapter: number;

  /** 所有剧情节点 */
  nodes: PlotNode[];

  /** 所有剧情边 */
  edges: PlotEdge[];

  /** 当前活跃的主线剧情节点ID */
  activeMainPlots: string[];

  /** 当前活跃的支线剧情节点ID */
  activeSubPlots: string[];

  /** 待回收的伏笔 (按紧迫程度排序) */
  pendingForeshadowing: PendingForeshadowing[];
};

/**
 * AI 分析返回的剧情变化
 */
export type AIPlotAnalysis = {
  /** 新增的节点 */
  newNodes: Omit<PlotNode, 'id'>[];

  /** 新增的边 */
  newEdges: Omit<PlotEdge, 'id'>[];

  /** 状态更新 */
  statusUpdates: {
    nodeId: string;
    newStatus: PlotNodeStatus;
    resolvedAt?: number;
  }[];

  /** 伏笔回收 */
  foreshadowingResolutions: {
    foreshadowingId: string;
    resolutionNodeId?: string;
    resolvedAt: number;
  }[];
};

/**
 * 创建空的剧情图谱
 */
export function createEmptyPlotGraph(): PlotGraph {
  return {
    version: '1.0.0',
    lastUpdatedChapter: 0,
    nodes: [],
    edges: [],
    activeMainPlots: [],
    activeSubPlots: [],
    pendingForeshadowing: [],
  };
}

/**
 * 生成节点ID
 */
export function generateNodeId(type: PlotNodeType, chapter: number): string {
  return `${type}_ch${chapter}_${Date.now().toString(36)}`;
}

/**
 * 生成边ID
 */
export function generateEdgeId(from: string, to: string, relation: PlotEdgeRelation): string {
  return `edge_${from}_${relation}_${to}`;
}

/**
 * 计算伏笔的紧迫程度
 */
export function calculateForeshadowingUrgency(
  node: PlotNode,
  currentChapter: number
): ForeshadowingUrgency {
  const age = currentChapter - node.introducedAt;

  // 根据重要程度调整阈值
  const importanceMultiplier = node.importance >= 8 ? 0.7 : node.importance >= 5 ? 1 : 1.3;

  const adjustedAge = age / importanceMultiplier;

  if (adjustedAge > 80) return 'critical';
  if (adjustedAge > 50) return 'high';
  if (adjustedAge > 20) return 'medium';
  return 'low';
}

/**
 * 计算建议回收章节范围
 */
export function calculateSuggestedResolutionRange(
  node: PlotNode,
  currentChapter: number,
  totalChapters: number
): [number, number] {
  const age = currentChapter - node.introducedAt;

  // 基于重要程度计算理想回收时间
  let idealAge: number;
  if (node.importance >= 8) {
    // 高重要度：可以延后到高潮
    idealAge = Math.min(100, totalChapters * 0.8);
  } else if (node.importance >= 5) {
    // 中等重要度：50章内回收
    idealAge = 50;
  } else {
    // 低重要度：30章内回收
    idealAge = 30;
  }

  const minChapter = Math.max(currentChapter + 1, node.introducedAt + idealAge - 10);
  const maxChapter = Math.min(totalChapters, node.introducedAt + idealAge + 20);

  return [minChapter, maxChapter];
}

/**
 * 获取活跃的伏笔列表
 */
export function getActiveForeshadowing(graph: PlotGraph): PlotNode[] {
  return graph.nodes.filter(
    (n) => n.type === 'foreshadowing' && n.status === 'active'
  );
}

/**
 * 更新待回收伏笔列表
 */
export function updatePendingForeshadowing(
  graph: PlotGraph,
  currentChapter: number,
  totalChapters: number
): PendingForeshadowing[] {
  const activeForeshadowing = getActiveForeshadowing(graph);

  return activeForeshadowing
    .map((node) => ({
      id: node.id,
      urgency: calculateForeshadowingUrgency(node, currentChapter),
      suggestedResolutionRange: calculateSuggestedResolutionRange(
        node,
        currentChapter,
        totalChapters
      ),
      ageInChapters: currentChapter - node.introducedAt,
      summary: node.content,
    }))
    .sort((a, b) => {
      // 按紧迫程度排序
      const urgencyOrder: Record<ForeshadowingUrgency, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    });
}

/**
 * 格式化伏笔提醒为 Prompt 片段
 */
export function formatForeshadowingReminder(
  pending: PendingForeshadowing[],
  maxItems: number = 5
): string {
  const critical = pending.filter((p) => p.urgency === 'critical');
  const high = pending.filter((p) => p.urgency === 'high');

  if (critical.length === 0 && high.length === 0) {
    return '';
  }

  const parts: string[] = ['【伏笔回收提醒】'];

  if (critical.length > 0) {
    parts.push('⚠️ 紧急 - 以下伏笔已超时，请尽快回收：');
    critical.slice(0, 3).forEach((p, i) => {
      parts.push(`  ${i + 1}. ${p.summary} (埋下已${p.ageInChapters}章)`);
    });
  }

  if (high.length > 0) {
    parts.push('📌 重要 - 以下伏笔建议近期回收：');
    high.slice(0, maxItems - critical.length).forEach((p, i) => {
      parts.push(
        `  ${i + 1}. ${p.summary} (建议在第${p.suggestedResolutionRange[0]}-${p.suggestedResolutionRange[1]}章回收)`
      );
    });
  }

  return parts.join('\n');
}

/**
 * 格式化活跃剧情线为 Prompt 片段
 */
export function formatActivePlotLines(graph: PlotGraph): string {
  const mainPlots = graph.activeMainPlots
    .map((id) => graph.nodes.find((n) => n.id === id))
    .filter(Boolean);

  const subPlots = graph.activeSubPlots
    .map((id) => graph.nodes.find((n) => n.id === id))
    .filter(Boolean);

  if (mainPlots.length === 0 && subPlots.length === 0) {
    return '';
  }

  const parts: string[] = ['【当前活跃剧情线】'];

  if (mainPlots.length > 0) {
    parts.push('主线：');
    mainPlots.slice(0, 3).forEach((p, i) => {
      parts.push(`  ${i + 1}. [${p!.type}] ${p!.content}`);
    });
  }

  if (subPlots.length > 0) {
    parts.push('支线：');
    subPlots.slice(0, 3).forEach((p, i) => {
      parts.push(`  ${i + 1}. [${p!.type}] ${p!.content}`);
    });
  }

  return parts.join('\n');
}

/**
 * 添加节点到图谱
 */
export function addNodeToGraph(
  graph: PlotGraph,
  node: Omit<PlotNode, 'id'>,
  isMainPlot: boolean = false
): PlotGraph {
  const id = generateNodeId(node.type, node.introducedAt);
  const newNode: PlotNode = { ...node, id };

  const updated: PlotGraph = {
    ...graph,
    nodes: [...graph.nodes, newNode],
  };

  if (isMainPlot) {
    updated.activeMainPlots = [...graph.activeMainPlots, id];
  } else if (node.type !== 'foreshadowing') {
    updated.activeSubPlots = [...graph.activeSubPlots, id];
  }

  return updated;
}

/**
 * 添加边到图谱
 */
export function addEdgeToGraph(
  graph: PlotGraph,
  edge: Omit<PlotEdge, 'id'>
): PlotGraph {
  const id = generateEdgeId(edge.from, edge.to, edge.relation);
  const newEdge: PlotEdge = { ...edge, id };

  return {
    ...graph,
    edges: [...graph.edges, newEdge],
  };
}

/**
 * 更新节点状态
 */
export function updateNodeStatus(
  graph: PlotGraph,
  nodeId: string,
  newStatus: PlotNodeStatus,
  resolvedAt?: number
): PlotGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === nodeId
        ? { ...n, status: newStatus, resolvedAt: resolvedAt ?? n.resolvedAt }
        : n
    ),
    // 如果节点已解决，从活跃列表中移除
    activeMainPlots:
      newStatus === 'resolved' || newStatus === 'abandoned'
        ? graph.activeMainPlots.filter((id) => id !== nodeId)
        : graph.activeMainPlots,
    activeSubPlots:
      newStatus === 'resolved' || newStatus === 'abandoned'
        ? graph.activeSubPlots.filter((id) => id !== nodeId)
        : graph.activeSubPlots,
  };
}

/**
 * 获取节点的相关边
 */
export function getRelatedEdges(graph: PlotGraph, nodeId: string): PlotEdge[] {
  return graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
}

/**
 * 获取因果链 (从某节点出发的所有后果)
 */
export function getCausalChain(
  graph: PlotGraph,
  nodeId: string,
  maxDepth: number = 3
): PlotNode[] {
  const visited = new Set<string>();
  const result: PlotNode[] = [];

  function traverse(id: string, depth: number) {
    if (depth > maxDepth || visited.has(id)) return;
    visited.add(id);

    const node = graph.nodes.find((n) => n.id === id);
    if (node) result.push(node);

    const outEdges = graph.edges.filter(
      (e) => e.from === id && (e.relation === 'causes' || e.relation === 'enables')
    );

    for (const edge of outEdges) {
      traverse(edge.to, depth + 1);
    }
  }

  traverse(nodeId, 0);
  return result;
}
