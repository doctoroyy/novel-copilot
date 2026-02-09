import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Button } from '@/components/ui/button';
import { fetchCharacters, generateCharacters, type ProjectDetail } from '@/lib/api';
import type { CharacterRelationGraph, CharacterProfile } from '@/types/characters';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface CharacterGraphViewProps {
  project: ProjectDetail;
}

const NODE_R = 8;

export function CharacterGraphView({ project }: CharacterGraphViewProps) {
  const [data, setData] = useState<CharacterRelationGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<CharacterProfile | null>(null);
  const [hoverNode, setHoverNode] = useState<CharacterProfile | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const { config: aiConfig } = useAIConfig();
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Update dimensions on resize
  useEffect(() => {
    const updateDims = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        });
      }
    };
    
    window.addEventListener('resize', updateDims);
    updateDims();
    
    return () => window.removeEventListener('resize', updateDims);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const crg = await fetchCharacters(project.name);
      setData(crg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [project.name]);

  const handleGenerate = async () => {
    try {
      setLoading(true);
      setError(null);
      const crg = await generateCharacters(project.name, getAIConfigHeaders(aiConfig));
      setData(crg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };

    // Calculate node value/size based on importance
    const nodes = [
      ...data.protagonists.map(c => ({ 
        ...c, 
        group: 'protagonist', 
        val: 30,
        color: '#f59e0b' // Amber
      })),
      ...data.mainCharacters.map(c => ({ 
        ...c, 
        group: 'main', 
        val: 20,
        color: '#3b82f6' // Blue
      })),
    ];

    // Create lookup maps for robust matching (ID and Name)
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const nodeByName = new Map(nodes.map(n => [n.name, n]));

    const resolveNodeId = (ref: string): string | null => {
      if (nodeById.has(ref)) return ref;
      if (nodeByName.has(ref)) return nodeByName.get(ref)!.id;
      // Try fuzzy match or case-insensitive match if needed, but let's start with exact name match
      // Also handle potential case differences
      const lowerRef = ref.toLowerCase();
      for (const node of nodes) {
          if (node.id.toLowerCase() === lowerRef) return node.id;
          if (node.name.toLowerCase() === lowerRef) return node.id;
      }
      return null;
    };

    const links = data.relationships
      .map(r => {
        const sourceId = resolveNodeId(r.from);
        const targetId = resolveNodeId(r.to);
        return { ...r, source: sourceId, target: targetId, value: r.bondStrength };
      })
      .filter(r => r.source && r.target) // Filter out links where endpoints couldn't be resolved
      .map(r => ({
        ...r,
        source: r.source!, // TS assertion since we filtered
        target: r.target!
      }));

    return { nodes, links };
  }, [data]);

  // Highlight logic - updated to handle both string IDs and object references safely
  const highlightLinks = useMemo(() => {
    const activeNode = hoverNode || selectedNode;
    if (!activeNode) return new Set();
    
    const links = new Set();
    graphData.links.forEach(link => {
      // Safe access: d3 might have converted source/target to objects, or they might still be strings
      const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;

      if (sourceId === activeNode.id || targetId === activeNode.id) {
        links.add(link);
      }
    });
    return links;
  }, [hoverNode, selectedNode, graphData]);

  const highlightNodes = useMemo(() => {
    const activeNode = hoverNode || selectedNode;
    if (!activeNode) return new Set();

    const nodes = new Set();
    nodes.add(activeNode.id);
    graphData.links.forEach(link => {
      const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;

      if (sourceId === activeNode.id && targetId) nodes.add(targetId);
      if (targetId === activeNode.id && sourceId) nodes.add(sourceId);
    });
    return nodes;
  }, [hoverNode, selectedNode, graphData]);

  // Custom Node Rendering
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const isHover = highlightNodes.has(node.id);
    const isSelected = selectedNode?.id === node.id;
    const isDimmed = (hoverNode || selectedNode) && !isHover;
    
    const label = node.name;
    const fontSize = 12 / globalScale;
    const radius = isSelected ? 8 : 6;
    
    // Dimming effect
    ctx.globalAlpha = isDimmed ? 0.2 : 1;

    // Outer Glow
    if (isHover || isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius * 1.5, 0, 2 * Math.PI, false);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = isDimmed ? 0.1 : 0.4;
      ctx.fill();
    }

    // Main Circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = node.color;
    ctx.globalAlpha = isDimmed ? 0.2 : 1;
    ctx.fill();

    // Inner Border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / globalScale;
    ctx.stroke();

    // Label Background
    const textWidth = ctx.measureText(label).width;
    const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    if (isHover || isSelected) {
      ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y + radius + 2, bckgDimensions[0], bckgDimensions[1]);
    }

    // Label Text
    ctx.font = `${fontSize}px Sans-Serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isHover || isSelected ? '#fff' : 'rgba(255, 255, 255, 0.8)';
    ctx.fillText(label, node.x, node.y + radius + 2 + bckgDimensions[1] / 2);

    node.__bckgDimensions = bckgDimensions; // to re-use in nodePointerAreaPaint
  }, [highlightNodes, selectedNode, hoverNode]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950">
        <div className="text-center space-y-4">
            <div className="animate-spin text-4xl mb-4">🔮</div>
            <p className="text-slate-400 animate-pulse">正在编织命运之网...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-6 bg-slate-950 text-slate-100 text-center">
        <div className="relative">
            <div className="absolute inset-0 bg-blue-500 blur-3xl opacity-20 animate-pulse"></div>
            <div className="text-8xl relative z-10">🕸️</div>
        </div>
        <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
            暂无人物关系图谱
        </h2>
        <p className="text-slate-400 max-w-md text-center text-lg">
            让 AI 深度分析您的设定集，构建一张盘根错节的人物关系网，让故事脉络清晰可见。
        </p>
        <Button onClick={handleGenerate} disabled={loading} size="lg" className="gradient-bg text-lg px-8 py-6 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transition-all">
          {loading ? '生成中...' : '✨ 立即生成图谱'}
        </Button>
        {error && <p className="text-destructive bg-destructive/10 px-4 py-2 rounded">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full relative overflow-hidden bg-slate-950">
      {/* Graph Area */}
      <div className="flex-1 relative" ref={containerRef}>
        <ForceGraph2D
          ref={graphRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          // Physics
          cooldownTicks={100}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          // Rendering
          nodeCanvasObject={paintNode}
          nodeRelSize={NODE_R}
          // Link Rendering
          linkColor={(link: any) => highlightLinks.has(link) ? '#fff' : 'rgba(255,255,255,0.15)'}
          linkWidth={(link: any) => highlightLinks.has(link) ? 2 : 1}
          linkDirectionalParticles={(link: any) => highlightLinks.has(link) ? 4 : 0}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleSpeed={0.005}
          linkCurvature={0.2} // Curved links for multiple relationships
          // Interaction
          onNodeClick={(node) => {
            setSelectedNode(node as CharacterProfile);
            // Center camera on node
            graphRef.current?.centerAt(node.x, node.y, 1000);
            graphRef.current?.zoom(4, 2000);
          }}
          onNodeHover={(node) => setHoverNode(node as CharacterProfile || null)}
          onBackgroundClick={() => setSelectedNode(null)}
          backgroundColor="#020617"
        />
        
        {/* Controls Overlay */}
        <div className="absolute top-4 left-4 flex flex-col gap-2 pointer-events-none">
            <div className="flex gap-2 pointer-events-auto">
                <Badge className="bg-amber-500/80 hover:bg-amber-500 border-none backdrop-blur shadow-lg shadow-amber-500/20 px-3 py-1">主角</Badge>
                <Badge className="bg-blue-500/80 hover:bg-blue-500 border-none backdrop-blur shadow-lg shadow-blue-500/20 px-3 py-1">重要配角</Badge>
            </div>
            <div className="text-xs text-slate-500 mt-1 pl-1">
                按住左键拖拽 • 滚轮缩放 • 点击节点查看详情
            </div>
        </div>

        {/* Action Buttons */}
        <div className="absolute bottom-6 left-6 pointer-events-auto">
             <Button variant="outline" size="sm" onClick={handleGenerate} className="bg-background/50 backdrop-blur border-slate-700 hover:bg-slate-800 text-slate-300">
                🔄 重新生成
             </Button>
        </div>
      </div>

      {/* Sidebar Details - Glassmorphism Style */}
      <div className={`
        w-96 border-l border-slate-800 bg-slate-900/80 backdrop-blur-xl
        absolute right-0 inset-y-0 shadow-2xl transition-transform duration-300 ease-in-out z-10
        ${selectedNode ? 'translate-x-0' : 'translate-x-full'}
      `}>
        {selectedNode && (
            <div className="h-full flex flex-col">
                <div className="p-6 border-b border-slate-800">
                    <div className="flex justify-between items-start mb-2">
                        <div>
                            <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                                {selectedNode.name}
                            </h2>
                            <p className="text-sm text-slate-400 mt-1">{selectedNode.basic?.identity || '角色'}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-white">
                            ✕
                        </Button>
                    </div>
                     <div className="flex flex-wrap gap-2 mt-3">
                        {selectedNode.personality?.traits?.map(t => (
                            <Badge key={t} variant="outline" className="border-slate-700 text-slate-300 bg-slate-800/50">
                                {t}
                            </Badge>
                        )) || <Badge variant="outline" className="text-xs">无特质</Badge>}
                    </div>
                </div>
                
                <ScrollArea className="flex-1">
                    <div className="p-6 space-y-6">
                        {/* 基础信息 */}
                        <div className="space-y-3">
                            <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold">基础资料</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800">
                                    <div className="text-slate-500 text-xs mb-1">年龄</div>
                                    <div className="text-slate-200">{selectedNode.basic?.age || '未知'}</div>
                                </div>
                                <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800">
                                    <div className="text-slate-500 text-xs mb-1">初登场</div>
                                    <div className="text-slate-200">第 {selectedNode.debutChapter || 1} 章</div>
                                </div>
                            </div>
                            <div className="bg-slate-950/50 p-3 rounded-lg border border-slate-800">
                                <div className="text-slate-500 text-xs mb-1">外貌特征</div>
                                <div className="text-slate-200 text-sm leading-relaxed">{selectedNode.basic?.appearance || '暂无描述'}</div>
                            </div>
                        </div>

                        {/* 内心世界 */}
                        <div className="space-y-3">
                            <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold">内心世界</h3>
                            <div className="space-y-2">
                                <div className="flex gap-3 text-sm">
                                    <span className="text-rose-400 shrink-0 w-16">❤️ 欲望</span>
                                    <span className="text-slate-300">{selectedNode.personality?.desires?.join('、') || '无'}</span>
                                </div>
                                <div className="flex gap-3 text-sm">
                                    <span className="text-indigo-400 shrink-0 w-16">😱 恐惧</span>
                                    <span className="text-slate-300">{selectedNode.personality?.fears?.join('、') || '无'}</span>
                                </div>
                                <div className="flex gap-3 text-sm">
                                    <span className="text-amber-400 shrink-0 w-16">⚡️ 缺陷</span>
                                    <span className="text-slate-300">{selectedNode.personality?.flaws?.join('、') || '无'}</span>
                                </div>
                            </div>
                        </div>

                         {/* 角色弧光 */}
                        <div className="space-y-3">
                            <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold">角色弧光</h3>
                            <div className="relative pl-4 border-l-2 border-slate-800 space-y-6">
                                <div className="relative">
                                    <div className="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-slate-900"></div>
                                    <div className="text-xs text-emerald-500 font-bold mb-1">起点</div>
                                    <p className="text-sm text-slate-300">{selectedNode.arc?.start || '未知'}</p>
                                </div>
                                <div className="relative">
                                    <div className="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full bg-amber-500 ring-4 ring-slate-900"></div>
                                    <div className="text-xs text-amber-500 font-bold mb-1">中点 (转变)</div>
                                    <p className="text-sm text-slate-300">{selectedNode.arc?.middle || '未知'}</p>
                                </div>
                                <div className="relative">
                                    <div className="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full bg-purple-500 ring-4 ring-slate-900"></div>
                                    <div className="text-xs text-purple-500 font-bold mb-1">终点</div>
                                    <p className="text-sm text-slate-300">{selectedNode.arc?.end || '未知'}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
