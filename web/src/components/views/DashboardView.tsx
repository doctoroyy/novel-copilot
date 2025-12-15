import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { ProjectDetail } from '@/lib/api';

interface DashboardViewProps {
  project: ProjectDetail;
  onGenerateOutline: () => void;
  onGenerateChapters: () => void;
  loading: boolean;
}

export function DashboardView({ project, onGenerateOutline, onGenerateChapters, loading }: DashboardViewProps) {
  const progress = ((project.state.nextChapterIndex - 1) / project.state.totalChapters) * 100;
  const chaptersGenerated = project.state.nextChapterIndex - 1;
  const chaptersRemaining = project.state.totalChapters - chaptersGenerated;

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Progress Ring Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        {/* Main Progress Card */}
        <Card className="lg:col-span-1 glass-card">
          <CardContent className="p-4 lg:p-6 flex flex-col items-center justify-center">
            <div className="relative w-32 h-32 lg:w-40 lg:h-40">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="none"
                  className="text-muted lg:hidden"
                />
                <circle
                  cx="80"
                  cy="80"
                  r="70"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="none"
                  className="text-muted hidden lg:block"
                />
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="url(#progressGradient)"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 56}`}
                  strokeDashoffset={`${2 * Math.PI * 56 * (1 - progress / 100)}`}
                  className="transition-all duration-1000 lg:hidden"
                />
                <circle
                  cx="80"
                  cy="80"
                  r="70"
                  stroke="url(#progressGradient)"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 70}`}
                  strokeDashoffset={`${2 * Math.PI * 70 * (1 - progress / 100)}`}
                  className="transition-all duration-1000 hidden lg:block"
                />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#667eea" />
                    <stop offset="100%" stopColor="#a855f7" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl lg:text-3xl font-bold gradient-text">{Math.round(progress)}%</span>
                <span className="text-xs text-muted-foreground">完成进度</span>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {chaptersGenerated} / {project.state.totalChapters} 章
            </p>
          </CardContent>
        </Card>

        {/* Stats Cards */}
        <div className="lg:col-span-2 grid grid-cols-2 gap-3 lg:gap-4">
          <Card className="glass-card hover-lift">
            <CardContent className="p-4 lg:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs lg:text-sm text-muted-foreground">已生成</p>
                  <p className="text-2xl lg:text-3xl font-bold">{chaptersGenerated}</p>
                </div>
                <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-green-500/20 flex items-center justify-center text-xl lg:text-2xl shrink-0">
                  ✅
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card hover-lift">
            <CardContent className="p-4 lg:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs lg:text-sm text-muted-foreground">待生成</p>
                  <p className="text-2xl lg:text-3xl font-bold">{chaptersRemaining}</p>
                </div>
                <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-amber-500/20 flex items-center justify-center text-xl lg:text-2xl shrink-0">
                  ⏳
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card hover-lift">
            <CardContent className="p-4 lg:p-6">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-xs lg:text-sm text-muted-foreground">目标字数</p>
                  <p className="text-2xl lg:text-3xl font-bold truncate">{project.outline?.targetWordCount || '--'}</p>
                  <p className="text-xs text-muted-foreground">万字</p>
                </div>
                <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-xl lg:text-2xl shrink-0">
                  📝
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card hover-lift">
            <CardContent className="p-4 lg:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs lg:text-sm text-muted-foreground">卷数</p>
                  <p className="text-2xl lg:text-3xl font-bold">{project.outline?.volumes.length || '--'}</p>
                </div>
                <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-purple-500/20 flex items-center justify-center text-xl lg:text-2xl shrink-0">
                  📚
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Quick Actions */}
      <Card className="glass-card">
        <CardContent className="p-4 lg:p-6">
          <h3 className="font-medium mb-4 text-sm lg:text-base">快速操作</h3>
          <div className="flex flex-wrap gap-2 lg:gap-3">
            {!project.outline && (
              <Button 
                onClick={onGenerateOutline} 
                disabled={loading}
                className="gradient-bg hover:opacity-90 text-sm lg:text-base"
              >
                {loading ? '⏳ 生成中...' : '📋 生成大纲'}
              </Button>
            )}
            {project.outline && (
              <Button 
                onClick={onGenerateChapters} 
                disabled={loading}
                className="gradient-bg hover:opacity-90 text-sm lg:text-base"
              >
                {loading ? '⏳ 生成中...' : '✍️ 生成下一章'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Outline Summary */}
      {project.outline && (
        <Card className="glass-card">
          <CardContent className="p-4 lg:p-6">
            <h3 className="font-medium mb-2 text-sm lg:text-base">大纲概览</h3>
            <p className="text-xs lg:text-sm text-muted-foreground mb-4">{project.outline.mainGoal}</p>
            <div className="flex flex-wrap gap-2">
              {project.outline.volumes.map((vol, i) => (
                <div 
                  key={i}
                  className="px-2 lg:px-3 py-1 lg:py-1.5 rounded-lg bg-muted/50 text-xs"
                >
                  <span className="font-medium">{vol.title}</span>
                  <span className="text-muted-foreground ml-2">
                    第{vol.startChapter}-{vol.endChapter}章
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Need Human Intervention Warning */}
      {project.state.needHuman && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="p-4 lg:p-6">
            <div className="flex items-center gap-3">
              <div className="text-xl lg:text-2xl shrink-0">⚠️</div>
              <div className="min-w-0">
                <h3 className="font-medium text-destructive text-sm lg:text-base">需要人工介入</h3>
                <p className="text-xs lg:text-sm text-muted-foreground">{project.state.needHumanReason}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
