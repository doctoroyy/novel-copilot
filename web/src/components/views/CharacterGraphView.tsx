import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchCharacters, generateCharacters, type ProjectDetail } from '@/lib/api';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';
import type { CharacterProfile, CharacterRelationGraph, Relationship } from '@/types/characters';
import { Loader2, Network, RefreshCw, Sparkles, UserRound, UsersRound, X } from 'lucide-react';

interface CharacterGraphViewProps {
  project: ProjectDetail;
}

type GraphNode = CharacterProfile & {
  group: 'protagonist' | 'main';
  val: number;
  color: string;
};

type GraphLink = Relationship & {
  source: string;
  target: string;
  value: number;
};

type GraphEndpoint = string | number | NodeObject<GraphNode> | undefined;

const NODE_R = 8;

function endpointId(endpoint: GraphEndpoint): string | null {
  if (endpoint === undefined) return null;
  if (typeof endpoint === 'string' || typeof endpoint === 'number') return String(endpoint);
  return endpoint.id === undefined ? null : String(endpoint.id);
}

function characterCount(data: CharacterRelationGraph | null): number {
  if (!data) return 0;
  return data.protagonists.length + data.mainCharacters.length;
}

function latestEventLabel(data: CharacterRelationGraph | null): string {
  const latest = data?.relationshipEvents?.at(-1);
  if (!latest) return '暂无事件';
  return `第 ${latest.chapter} 章`;
}

export function CharacterGraphView({ project }: CharacterGraphViewProps) {
  const [data, setData] = useState<CharacterRelationGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const graphShellRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const { config: aiConfig } = useAIConfig();
  const [dimensions, setDimensions] = useState({ width: 360, height: 560 });

  useEffect(() => {
    const updateDims = () => {
      const shell = graphShellRef.current;
      if (!shell) return;
      const measuredWidth = shell.getBoundingClientRect().width || shell.clientWidth || window.innerWidth;
      const measuredHeight = shell.getBoundingClientRect().height || shell.clientHeight || 560;
      setDimensions({
        width: Math.max(320, Math.floor(measuredWidth)),
        height: Math.max(520, Math.floor(measuredHeight)),
      });
    };

    const observer = new ResizeObserver(updateDims);
    if (graphShellRef.current) observer.observe(graphShellRef.current);
    updateDims();
    const firstFrame = window.requestAnimationFrame(updateDims);
    const delayed = window.setTimeout(updateDims, 250);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(firstFrame);
      window.clearTimeout(delayed);
    };
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const crg = await fetchCharacters(project.id);
      setData(crg);
      setSelectedNode(null);
      setHoverNode(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleGenerate = async () => {
    try {
      setLoading(true);
      setError(null);
      const crg = await generateCharacters(project.id, getAIConfigHeaders(aiConfig));
      setData(crg);
      setSelectedNode(null);
      setHoverNode(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const graphData = useMemo(() => {
    if (!data) return { nodes: [] as GraphNode[], links: [] as GraphLink[] };

    const nodes: GraphNode[] = [
      ...data.protagonists.map((character) => ({
        ...character,
        group: 'protagonist' as const,
        val: 30,
        color: '#f97316',
      })),
      ...data.mainCharacters.map((character) => ({
        ...character,
        group: 'main' as const,
        val: 20,
        color: '#0f766e',
      })),
    ];

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const nodeByName = new Map(nodes.map((node) => [node.name, node]));

    const resolveNodeId = (ref: string): string | null => {
      if (nodeById.has(ref)) return ref;
      const named = nodeByName.get(ref);
      if (named) return named.id;
      const lowerRef = ref.toLowerCase();
      const matched = nodes.find((node) => node.id.toLowerCase() === lowerRef || node.name.toLowerCase() === lowerRef);
      return matched?.id || null;
    };

    const links = data.relationships.flatMap((relationship) => {
      const source = resolveNodeId(relationship.from);
      const target = resolveNodeId(relationship.to);
      if (!source || !target) return [];
      return [{
        ...relationship,
        source,
        target,
        value: relationship.bondStrength,
      }];
    });

    return { nodes, links };
  }, [data]);

  useEffect(() => {
    if (graphData.nodes.length === 0) return;
    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit(600, dimensions.width < 520 ? 48 : 72);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dimensions.width, graphData.nodes.length]);

  const activeNode = hoverNode || selectedNode;

  const highlightLinkIds = useMemo(() => {
    if (!activeNode) return new Set<string>();
    return new Set(
      graphData.links
        .filter((link) => endpointId(link.source) === activeNode.id || endpointId(link.target) === activeNode.id)
        .map((link) => link.id)
    );
  }, [activeNode, graphData.links]);

  const highlightNodeIds = useMemo(() => {
    if (!activeNode) return new Set<string>();
    const nodeIds = new Set<string>([activeNode.id]);
    graphData.links.forEach((link) => {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (source === activeNode.id && target) nodeIds.add(target);
      if (target === activeNode.id && source) nodeIds.add(source);
    });
    return nodeIds;
  }, [activeNode, graphData.links]);

  const paintNode = useCallback((node: NodeObject<GraphNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const nodeId = endpointId(node);
    const isHover = nodeId ? highlightNodeIds.has(nodeId) : false;
    const isSelected = selectedNode?.id === nodeId;
    const isDimmed = Boolean(activeNode && !isHover);
    const radius = isSelected ? 8 : 6;
    const fontSize = 12 / globalScale;
    const label = node.name;

    ctx.globalAlpha = isDimmed ? 0.18 : 1;
    if (isHover || isSelected) {
      ctx.beginPath();
      ctx.arc(node.x || 0, node.y || 0, radius * 2.2, 0, 2 * Math.PI, false);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = isDimmed ? 0.1 : 0.22;
      ctx.fill();
    }

    ctx.globalAlpha = isDimmed ? 0.28 : 1;
    ctx.beginPath();
    ctx.arc(node.x || 0, node.y || 0, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = node.color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 / globalScale;
    ctx.stroke();

    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(label).width;
    const labelWidth = textWidth + fontSize * 0.9;
    const labelHeight = fontSize * 1.55;
    const labelX = (node.x || 0) - labelWidth / 2;
    const labelY = (node.y || 0) + radius + 5;

    ctx.globalAlpha = isDimmed ? 0.2 : 0.92;
    ctx.fillStyle = '#fff7ed';
    ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
    ctx.strokeStyle = 'rgba(249, 115, 22, 0.18)';
    ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);

    ctx.globalAlpha = isDimmed ? 0.35 : 1;
    ctx.fillStyle = '#18181b';
    ctx.fillText(label, node.x || 0, labelY + labelHeight / 2);
    ctx.globalAlpha = 1;
  }, [activeNode, highlightNodeIds, selectedNode]);

  const handleSelectNode = (node: GraphNode & { x?: number; y?: number }) => {
    setSelectedNode(node);
    graphRef.current?.centerAt(node.x, node.y, 700);
    graphRef.current?.zoom(3, 900);
  };

  const totalCharacters = characterCount(data);
  const relationCount = data?.relationships.length || 0;

  if (loading && !data) {
    return (
      <div className="grid h-full place-items-center bg-[linear-gradient(to_bottom,var(--background),hsl(var(--muted)/0.35))]">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">正在读取人物关系...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid h-full place-items-center bg-[linear-gradient(to_bottom,var(--background),hsl(var(--muted)/0.35))] p-4 lg:p-6">
        <div className="w-full max-w-xl rounded-lg border bg-background p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-lg bg-primary/10">
            <Network className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-semibold tracking-normal">暂无人物关系图谱</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            生成图谱后，可以在这里查看主角、配角、阵营关系和角色弧光。
          </p>
          <Button onClick={handleGenerate} disabled={loading} className="mt-6">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            生成图谱
          </Button>
          {error && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-[linear-gradient(to_bottom,var(--background),hsl(var(--muted)/0.35))] p-4 lg:p-6">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4">
        <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Network className="h-4 w-4 text-primary" />
              角色网络
            </div>
            <h2 className="truncate text-2xl font-semibold tracking-normal">人物关系</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              点击节点查看角色档案，拖动画布检查人物之间的关系强弱和冲突来源。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="h-9 rounded-md px-3">{totalCharacters} 人物</Badge>
            <Badge variant="secondary" className="h-9 rounded-md px-3">{relationCount} 关系</Badge>
            <Badge variant="outline" className="h-9 rounded-md px-3">最新事件：{latestEventLabel(data)}</Badge>
            <Button variant="outline" size="sm" onClick={handleGenerate} disabled={loading} className="h-9">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              重新生成
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid min-h-[640px] flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section ref={graphShellRef} className="relative min-h-[520px] overflow-hidden rounded-lg border bg-background shadow-sm">
            <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2">
              <Badge className="rounded-md bg-orange-500 text-white hover:bg-orange-500">
                <UserRound className="mr-1 h-3 w-3" />
                主角
              </Badge>
              <Badge className="rounded-md bg-teal-700 text-white hover:bg-teal-700">
                <UsersRound className="mr-1 h-3 w-3" />
                重要配角
              </Badge>
            </div>
            <div ref={containerRef} className="h-full min-h-[520px]">
              <ForceGraph2D
                ref={graphRef}
                width={dimensions.width}
                height={dimensions.height}
                graphData={graphData}
                cooldownTicks={100}
                d3AlphaDecay={0.02}
                d3VelocityDecay={0.3}
                onEngineStop={() => graphRef.current?.zoomToFit(500, dimensions.width < 520 ? 48 : 72)}
                nodeCanvasObject={paintNode}
                nodeRelSize={NODE_R}
                linkColor={(link: LinkObject<GraphNode, GraphLink>) => (
                  highlightLinkIds.has(String(link.id)) ? '#f97316' : 'rgba(24, 24, 27, 0.18)'
                )}
                linkWidth={(link: LinkObject<GraphNode, GraphLink>) => (highlightLinkIds.has(String(link.id)) ? 2 : 1)}
                linkDirectionalParticles={(link: LinkObject<GraphNode, GraphLink>) => (highlightLinkIds.has(String(link.id)) ? 3 : 0)}
                linkDirectionalParticleWidth={2}
                linkDirectionalParticleSpeed={0.006}
                linkCurvature={0.18}
                onNodeClick={(node) => handleSelectNode(node as GraphNode & { x?: number; y?: number })}
                onNodeHover={(node) => setHoverNode(node ? (node as GraphNode) : null)}
                onBackgroundClick={() => setSelectedNode(null)}
                backgroundColor="#fffaf5"
              />
            </div>
            <div className="absolute bottom-4 left-4 right-4 rounded-md border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
              拖拽移动视图，滚轮缩放，点击节点打开角色档案。
            </div>
          </section>

          <aside className="min-h-0 rounded-lg border bg-background shadow-sm">
            {selectedNode ? (
              <div className="flex h-full min-h-[520px] flex-col">
                <div className="flex items-start justify-between gap-3 border-b p-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-xl font-semibold">{selectedNode.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedNode.basic?.identity || '角色'}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedNode(null)}
                    aria-label="关闭角色详情"
                    title="关闭角色详情"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-5 p-4">
                    <div className="flex flex-wrap gap-2">
                      {selectedNode.personality?.traits?.length ? (
                        selectedNode.personality.traits.map((trait) => (
                          <Badge key={trait} variant="secondary" className="rounded-md">{trait}</Badge>
                        ))
                      ) : (
                        <Badge variant="outline" className="rounded-md">无特质</Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">年龄</p>
                        <p className="mt-1 text-sm font-medium">{selectedNode.basic?.age || '未知'}</p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">初登场</p>
                        <p className="mt-1 text-sm font-medium">第 {selectedNode.debutChapter || 1} 章</p>
                      </div>
                    </div>

                    <section>
                      <h4 className="text-sm font-semibold">外貌特征</h4>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedNode.basic?.appearance || '暂无描述'}</p>
                    </section>

                    <section>
                      <h4 className="text-sm font-semibold">内心驱动</h4>
                      <div className="mt-2 space-y-2 text-sm">
                        <p><span className="text-muted-foreground">欲望：</span>{selectedNode.personality?.desires?.join('、') || '无'}</p>
                        <p><span className="text-muted-foreground">恐惧：</span>{selectedNode.personality?.fears?.join('、') || '无'}</p>
                        <p><span className="text-muted-foreground">缺陷：</span>{selectedNode.personality?.flaws?.join('、') || '无'}</p>
                      </div>
                    </section>

                    <section>
                      <h4 className="text-sm font-semibold">角色弧光</h4>
                      <div className="mt-3 space-y-3 border-l-2 border-primary/20 pl-4">
                        <div>
                          <p className="text-xs font-medium text-primary">起点</p>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">{selectedNode.arc?.start || '未知'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-primary">中点</p>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">{selectedNode.arc?.middle || '未知'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-primary">终点</p>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">{selectedNode.arc?.end || '未知'}</p>
                        </div>
                      </div>
                    </section>
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="flex h-full min-h-[520px] flex-col">
                <div className="border-b p-4">
                  <h3 className="text-base font-semibold">角色列表</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    点击图谱节点或从列表选择人物。
                  </p>
                </div>
                <div className="space-y-2 p-4">
                  {graphData.nodes.map((node) => (
                    <Button
                      key={node.id}
                      variant="outline"
                      className="h-auto w-full justify-start px-3 py-3 text-left"
                      onClick={() => handleSelectNode(node)}
                    >
                      <span className="mr-3 h-3 w-3 rounded-full" style={{ backgroundColor: node.color }} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{node.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{node.basic?.identity || '角色'}</span>
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
