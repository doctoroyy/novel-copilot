import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from './ThemeToggle';
import { CreditDisplay } from '@/components/CreditDisplay';
import type { ProjectDetail } from '@/lib/api';
import { 
  PanelLeftOpen, 
  PanelRightOpen, 
  LogOut,
  LayoutDashboard,
  FileText,
  Wand2,
  BookOpen,
  Network,
  Clapperboard,
  Settings,
  RefreshCw,
  Download,
  Trash2,
  User,
  type LucideIcon
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

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
  sidebarOpen?: boolean;
  activityPanelOpen?: boolean;
}

const tabs: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { id: 'outline', label: '大纲', icon: FileText },
  { id: 'generate', label: '生成', icon: Wand2 },
  { id: 'chapters', label: '章节', icon: BookOpen },
  // Knowledge tab removed
  { id: 'characters', label: '人物关系', icon: Network },
  { id: 'anime', label: 'AI动漫', icon: Clapperboard },
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
  sidebarOpen = true,
  activityPanelOpen = true
}: HeaderProps) {
  const { user, logout } = useAuth();

  if (!project) {
    return (
      <header className="h-16 border-b border-border flex items-center justify-between px-4 lg:px-6">
        {/* Mobile menu button */}
        {!sidebarOpen && (
            <Button 
            variant="ghost" 
            size="sm" 
            onClick={onToggleSidebar}
            className="lg:hidden"
            >
            <PanelLeftOpen className="h-4 w-4" />
            </Button>
        )}
        <div className="text-muted-foreground text-sm lg:text-base">选择一个项目开始</div>
        <div className="flex items-center gap-1 lg:gap-2">
          {user && (
            <>
              <span className="text-sm text-muted-foreground hidden sm:inline flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {user.username}
              </span>
              <Button variant="ghost" size="sm" onClick={logout} title="退出登录" className="text-xs lg:text-sm">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline ml-1">退出</span>
              </Button>
              <div className="w-px h-6 bg-border mx-1 hidden sm:block" />
            </>
          )}
          <CreditDisplay />
          <Button variant="ghost" size="sm" onClick={onSettings} className="text-xs lg:text-sm">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline ml-1">设置</span>
          </Button>
          <ThemeToggle />
        </div>
      </header>
    );
  }

  const generated = Math.max(0, project.state.nextChapterIndex - 1);
  const progress = project.state.totalChapters > 0
    ? Math.min(100, Math.max(0, (generated / project.state.totalChapters) * 100))
    : 0;

  return (
    <header className="border-b border-border">
      {/* Top Bar */}
      <div className="h-16 flex items-center justify-between px-4 lg:px-6 gap-2">
        {/* Sidebar Toggle (Only show if closed) */}
        {!sidebarOpen && (
            <Button 
            variant="ghost" 
            size="icon" 
            onClick={onToggleSidebar}
            className="mr-2 text-muted-foreground"
            >
            <PanelLeftOpen className="h-4 w-4" />
            </Button>
        )}

        <div className="flex items-center gap-2 lg:gap-4 flex-1 min-w-0">
          <div className="min-w-0 overflow-hidden">
            <h2 className="font-bold text-sm sm:text-base lg:text-lg truncate">{project.name}</h2>
            <div className="flex items-center gap-1.5 lg:gap-2 text-[10px] sm:text-xs lg:text-sm text-muted-foreground whitespace-nowrap overflow-hidden">
              <span className="shrink-0">{generated} / {project.state.totalChapters} 章</span>
              <span className="hidden sm:inline" aria-hidden="true">•</span>
              <span className="hidden sm:inline shrink-0">{Math.round(progress)}% 完成</span>
              {project.outline && (
                <>
                  <span className="hidden lg:inline" aria-hidden="true">•</span>
                  <Badge variant="secondary" className="text-[10px] lg:text-xs hidden lg:inline-flex px-1.5 py-0">
                    {project.outline.targetWordCount} 万字
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 lg:gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={onRefresh} className="hidden md:flex text-xs lg:text-sm items-center gap-1 px-2">
            <RefreshCw className="h-4 w-4" />
            <span className="hidden xl:inline">刷新</span>
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onDownload}
            disabled={project.chapters.length === 0}
            className="hidden sm:flex text-xs lg:text-sm items-center gap-1 px-2"
          >
            <Download className="h-4 w-4" />
            <span className="hidden xl:inline">下载</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive hidden sm:flex text-xs lg:text-sm items-center gap-1 px-2">
            <Trash2 className="h-4 w-4" />
            <span className="hidden xl:inline">删除</span>
          </Button>
          <div className="w-px h-6 bg-border mx-0.5 hidden sm:block" />
          <CreditDisplay />
          <Button variant="ghost" size="sm" onClick={onSettings} className="text-xs lg:text-sm items-center gap-1 px-2">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline lg:hidden xl:inline">设置</span>
          </Button>
          
          {/* User info and logout */}
          {user && (
            <>
              <div className="w-px h-6 bg-border mx-0.5 hidden md:block" />
              <div className="hidden lg:flex items-center gap-1 text-xs text-muted-foreground px-1">
                <User className="h-4 w-4" />
                <span className="max-w-[80px] truncate">{user.username}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={logout} title="退出登录" className="text-xs px-2">
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          )}
          
          {/* Activity Panel Toggle (Only show if closed) */}
          {!activityPanelOpen && (
            <Button 
                variant="ghost" 
                size="icon" 
                onClick={onToggleActivityPanel}
                className="text-muted-foreground h-9 w-9"
            >
                <PanelRightOpen className="h-4 w-4" />
            </Button>
          )}
          
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
              flex items-center justify-center px-2 lg:px-4 py-2 lg:py-2.5 text-xs lg:text-sm font-medium rounded-t-lg transition-all whitespace-nowrap
              ${activeTab === tab.id
                ? 'bg-card text-foreground border-t border-x border-border -mb-px'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }
            `}
          >
            <tab.icon className="h-4 w-4 mr-1 lg:mr-1.5" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>
    </header>
  );
}
