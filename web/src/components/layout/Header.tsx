import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from './ThemeToggle';
import type { ProjectDetail } from '@/lib/types';

interface HeaderProps {
  project: ProjectDetail | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onRefresh: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onSettings: () => void;
}

const tabs = [
  { id: 'dashboard', label: '仪表盘', icon: '📊' },
  { id: 'outline', label: '大纲', icon: '📋' },
  { id: 'generate', label: '生成', icon: '✍️' },
  { id: 'chapters', label: '章节', icon: '📖' },
  { id: 'bible', label: '设定', icon: '📕' },
];

export function Header({ 
  project, 
  activeTab, 
  onTabChange, 
  onRefresh,
  onDownload,
  onDelete,
  onSettings,
}: HeaderProps) {
  if (!project) {
    return (
      <header className="h-16 border-b border-border flex items-center justify-between px-6">
        <div className="text-muted-foreground">选择一个项目开始</div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onSettings}>
            ⚙️ 设置
          </Button>
          <ThemeToggle />
        </div>
      </header>
    );
  }

  const progress = ((project.state.next_chapter_index - 1) / project.state.total_chapters) * 100;

  return (
    <header className="border-b border-border">
      {/* Top Bar */}
      <div className="h-16 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="font-bold text-lg">{project.name}</h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{project.state.next_chapter_index - 1} / {project.state.total_chapters} 章</span>
              <span>•</span>
              <span>{Math.round(progress)}% 完成</span>
              {project.outline && (
                <>
                  <span>•</span>
                  <Badge variant="secondary" className="text-xs">
                    {project.outline.targetWordCount} 万字
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            🔄 刷新
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onDownload}
            disabled={project.chapters.length === 0}
          >
            📥 下载
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
            🗑️ 删除
          </Button>
          <div className="w-px h-6 bg-border mx-2" />
          <Button variant="ghost" size="sm" onClick={onSettings}>
            ⚙️ 设置
          </Button>
          <ThemeToggle />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="px-6 flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              px-4 py-2.5 text-sm font-medium rounded-t-lg transition-all
              ${activeTab === tab.id
                ? 'bg-card text-foreground border-t border-x border-border -mb-px'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }
            `}
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>
    </header>
  );
}
