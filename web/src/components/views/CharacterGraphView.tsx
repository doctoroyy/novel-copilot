import { useState, useEffect, useRef, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Button } from '@/components/ui/button';
import { fetchCharacters, generateCharacters, type ProjectDetail } from '@/lib/api';
import type { CharacterRelationGraph, CharacterProfile } from '@/types/characters';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface CharacterGraphViewProps {
  project: ProjectDetail;
}

export function CharacterGraphView({ project }: CharacterGraphViewProps) {
  const [data, setData] = useState<CharacterRelationGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<CharacterProfile | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { config: aiConfig } = useAIConfig();

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

    const nodes = [
      ...data.protagonists.map(c => ({ ...c, group: 'protagonist', val: 20 })),
      ...data.mainCharacters.map(c => ({ ...c, group: 'main', val: 10 })),
    ];

    const links = data.relationships.map(r => ({
      source: r.from,
      target: r.to,
      ...r
    }));

    return { nodes, links };
  }, [data]);

  const nodeColor = (node: any) => {
    if (selectedNode?.id === node.id) return '#f43f5e'; // Highlight
    return node.group === 'protagonist' ? '#f59e0b' : '#3b82f6';
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin text-4xl">⏳</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="text-6xl">🕸️</div>
        <h2 className="text-2xl font-bold">暂无人物关系图谱</h2>
        <p className="text-muted-foreground">生成图谱，让 AI 更好地理解人物羁绊。</p>
        <Button onClick={handleGenerate} disabled={loading} className="gradient-bg">
          {loading ? '生成中...' : '生成人物图谱'}
        </Button>
        {error && <p className="text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full relative overflow-hidden">
      {/* Graph Area */}
      <div className="flex-1 bg-slate-950 relative" ref={containerRef}>
        <ForceGraph2D
          width={containerRef.current?.offsetWidth || 800}
          height={containerRef.current?.offsetHeight || 600}
          graphData={graphData}
          nodeLabel="name"
          nodeColor={nodeColor}
          nodeRelSize={6}
          linkColor={() => 'rgba(255,255,255,0.2)'}
          linkWidth={2}
          onNodeClick={(node) => setSelectedNode(node as CharacterProfile)}
          backgroundColor="#020617"
        />
        
        {/* Helper Badge */}
        <div className="absolute top-4 left-4 flex gap-2">
            <Badge className="bg-amber-500">主角</Badge>
            <Badge className="bg-blue-500">重要配角</Badge>
        </div>
      </div>

      {/* Sidebar Details */}
      {selectedNode && (
        <div className="w-80 border-l bg-background/95 backdrop-blur overflow-y-auto p-4 absolute right-0 inset-y-0 shadow-xl transition-transform">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold gradient-text">{selectedNode.name}</h2>
            <Button variant="ghost" size="sm" onClick={() => setSelectedNode(null)}>✕</Button>
          </div>
          
          <div className="space-y-4">
            <Card>
                <CardHeader className="py-2">
                    <CardTitle className="text-sm">基础信息</CardTitle>
                </CardHeader>
                <CardContent className="py-2 text-sm space-y-1">
                    <p><span className="text-muted-foreground">身份:</span> {selectedNode.basic.identity}</p>
                    <p><span className="text-muted-foreground">年龄:</span> {selectedNode.basic.age}</p>
                    <p><span className="text-muted-foreground">外貌:</span> {selectedNode.basic.appearance}</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="py-2">
                    <CardTitle className="text-sm">性格模型</CardTitle>
                </CardHeader>
                <CardContent className="py-2 text-sm space-y-2">
                    <div>
                        <span className="text-muted-foreground block mb-1">特质:</span>
                        <div className="flex flex-wrap gap-1">
                            {selectedNode.personality.traits.map(t => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                        </div>
                    </div>
                    <div>
                        <span className="text-muted-foreground block mb-1">核心欲望:</span>
                        <p>{selectedNode.personality.desires.join('、')}</p>
                    </div>
                </CardContent>
            </Card>
            
            <Card>
                <CardHeader className="py-2">
                    <CardTitle className="text-sm">角色弧光</CardTitle>
                </CardHeader>
                <CardContent className="py-2 text-sm space-y-2 text-xs">
                    <p>🟢 起点: {selectedNode.arc.start}</p>
                    <p>🟡 中点: {selectedNode.arc.middle}</p>
                    <p>🔴 终点: {selectedNode.arc.end}</p>
                </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
