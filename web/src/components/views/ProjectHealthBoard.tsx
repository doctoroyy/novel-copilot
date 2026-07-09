/**
 * ProjectHealthBoard — author-facing health dashboard.
 *
 * Phase 3: turns QC data + Story Vault state into understandable dimensions:
 * 设定一致性, 伏笔库存, 节奏与爽点, 人物弧线, AI 成本.
 */

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Heart,
  Loader2,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Library,
} from 'lucide-react';
import { fetchProjectHealth, type ProjectHealth } from '@/lib/api';

interface Props {
  projectName: string;
}

const STATUS_ICON = {
  healthy: CheckCircle2,
  warning: AlertTriangle,
  critical: AlertTriangle,
};

const STATUS_COLOR = {
  healthy: 'text-green-600 bg-green-500/10',
  warning: 'text-amber-600 bg-amber-500/10',
  critical: 'text-red-600 bg-red-500/10',
};

export function ProjectHealthBoard({ projectName }: Props) {
  const [health, setHealth] = useState<ProjectHealth | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const h = await fetchProjectHealth(projectName);
      setHealth(h);
    } catch (e) {
      console.error('Failed to load health', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [projectName]);

  if (loading && !health) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!health) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          无法加载项目健康数据。
          <Button variant="outline" size="sm" className="ml-2" onClick={load}>重试</Button>
        </CardContent>
      </Card>
    );
  }

  const OverallIcon = STATUS_ICON[health.overallStatus];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Heart className="h-4 w-4" />
          项目健康
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${STATUS_COLOR[health.overallStatus]}`}>
            <OverallIcon className="h-3 w-3" />
            {health.overallScore} 分
          </span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Dimension cards */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {health.dimensions.map((dim) => {
            const DimIcon = STATUS_ICON[dim.status];
            return (
              <div key={dim.key} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{dim.label}</span>
                  <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] ${STATUS_COLOR[dim.status]}`}>
                    <DimIcon className="h-2.5 w-2.5" />
                    {dim.score}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{dim.summary}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground/80">
                  {dim.details.map((d, i) => (
                    <span key={i}>
                      {d.label}: <span className={d.severity === 'critical' ? 'text-red-600' : d.severity === 'warning' ? 'text-amber-600' : ''}>{d.value}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Foreshadow inventory */}
        {health.foreshadowInventory.total > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Library className="h-3 w-3" />
              伏笔库存
              <Badge variant="outline" className="text-[10px]">
                {health.foreshadowInventory.open} 开放 / {health.foreshadowInventory.resolved} 回收 / {health.foreshadowInventory.overdue} 逾期
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {health.foreshadowInventory.items.slice(0, 12).map((item, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className={`text-[10px] ${item.status === 'open' ? 'border-amber-500/40 text-amber-600' : 'border-green-500/40 text-green-600'}`}
                >
                  {item.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Recent QC issues */}
        {health.recentQcIssues.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              <ShieldCheck className="h-3 w-3" />
              最近质量问题
            </div>
            <div className="space-y-1">
              {health.recentQcIssues.slice(0, 6).map((issue, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-border/60 p-2 text-xs">
                  <Badge variant="outline" className="shrink-0 text-[10px]">第{issue.chapterIndex}章</Badge>
                  <span className={`shrink-0 text-[10px] ${issue.severity === 'critical' ? 'text-red-600' : issue.severity === 'major' ? 'text-amber-600' : 'text-muted-foreground'}`}>
                    {issue.type}
                  </span>
                  <span className="text-muted-foreground">{issue.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
