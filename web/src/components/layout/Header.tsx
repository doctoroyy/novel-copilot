import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from './ThemeToggle';
import type { ProjectDetail } from '@/lib/api';

interface HeaderProps {
  project: ProjectDetail | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onRefresh: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onSettings: () => void;
  onToggleSidebar: () => void;
  onToggleActivityPanel: () => void;
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
  onToggleSidebar,
  onToggleActivityPanel,
}: HeaderProps) {
  if (!project) {
    return (
      <header className="h-16 border-b border-border flex items-center justify-between px-4 lg:px-6">
        {/* Mobile menu button */}
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onToggleSidebar}
          className="lg:hidden"
        >
          ☰
        </Button>
        <div className="text-muted-foreground text-sm lg:text-base">选择一个项目开始</div>
        <div className="flex items-center gap-1 lg:gap-2">
          <Button variant="ghost" size="sm" onClick={onSettings} className="text-xs lg:text-sm">
            <span className="hidden sm:inline">⚙️ 设置</span>
            <span className="sm:hidden">⚙️</span>
          </Button>
          <ThemeToggle />
        </div>
      </header>
    );
  }

  const progress = ((project.state.nextChapterIndex - 1) / project.state.totalChapters) * 100;

  return (
    <header className="border-b border-border">
      {/* Top Bar */}
      <div className="h-16 flex items-center justify-between px-4 lg:px-6 gap-2">
        {/* Mobile menu button */}
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onToggleSidebar}
          className="lg:hidden p-2"
        >
          ☰
        </Button>

        <div className="flex items-center gap-2 lg:gap-4 flex-1 min-w-0">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-base lg:text-lg truncate">{project.name}</h2>
            <div className="flex items-center gap-1 lg:gap-2 text-xs lg:text-sm text-muted-foreground">
              <span>{project.state.nextChapterIndex - 1} / {project.state.totalChapters}</span>
              <span className="hidden sm:inline">章</span>
              <span className="hidden md:inline">•</span>
              <span className="hidden md:inline">{Math.round(progress)}% 完成</span>
              {project.outline && (
                <>
                  <span className="hidden lg:inline">•</span>
                  <Badge variant="secondary" className="text-xs hidden lg:inline-flex">
                    {project.outline.targetWordCount} 万字
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 lg:gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh} className="hidden sm:flex text-xs lg:text-sm">
            <span className="hidden lg:inline">🔄 刷新</span>
            <span className="lg:hidden">🔄</span>
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onDownload}
            disabled={project.chapters.length === 0}
            className="hidden sm:flex text-xs lg:text-sm"
          >
            <span className="hidden lg:inline">📥 下载</span>
            <span className="lg:hidden">📥</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive hidden md:flex text-xs lg:text-sm">
            <span className="hidden lg:inline">🗑️ 删除</span>
            <span className="lg:hidden">🗑️</span>
          </Button>
          <div className="w-px h-6 bg-border mx-1 hidden sm:block" />
          <Button variant="ghost" size="sm" onClick={onSettings} className="text-xs lg:text-sm">
            <span className="hidden lg:inline">⚙️ 设置</span>
            <span className="lg:hidden">⚙️</span>
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onToggleActivityPanel}
            className="lg:hidden"
          >
            📊
          </Button>
          <ThemeToggle />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="px-2 lg:px-6 flex gap-0.5 lg:gap-1 overflow-x-auto scrollbar-thin">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              px-2 lg:px-4 py-2 lg:py-2.5 text-xs lg:text-sm font-medium rounded-t-lg transition-all whitespace-nowrap
              ${activeTab === tab.id
                ? 'bg-card text-foreground border-t border-x border-border -mb-px'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }
            `}
          >
            <span className="mr-1 lg:mr-1.5">{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>
    </header>
  );
}
