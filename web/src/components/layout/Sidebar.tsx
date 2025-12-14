import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ProjectSummary } from '@/lib/api';

interface SidebarProps {
  projects: ProjectSummary[];
  selectedProject: string | null;
  onSelectProject: (name: string) => void;
  onNewProject: () => void;
}

export function Sidebar({ projects, selectedProject, onSelectProject, onNewProject }: SidebarProps) {
  return (
    <aside className="w-72 h-screen flex flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center text-xl">
            📚
          </div>
          <div>
            <h1 className="font-bold text-lg gradient-text">Novel Copilot</h1>
            <p className="text-xs text-muted-foreground">AI 小说创作助手</p>
          </div>
        </div>
      </div>

      {/* New Project Button */}
      <div className="p-3">
        <Button 
          onClick={onNewProject}
          className="w-full gradient-bg hover:opacity-90 transition-opacity"
        >
          <span className="mr-2">✨</span>
          新建项目
        </Button>
      </div>

      {/* Project List */}
      <ScrollArea className="flex-1 px-3">
        <div className="space-y-2 py-2">
          {projects.map((project) => {
            const progress = ((project.state.nextChapterIndex - 1) / project.state.totalChapters) * 100;
            const isSelected = selectedProject === project.name;
            
            return (
              <button
                key={project.name}
                onClick={() => onSelectProject(project.name)}
                className={`
                  w-full p-3 rounded-xl text-left transition-all duration-200
                  hover-lift group
                  ${isSelected 
                    ? 'glass-card gradient-border glow-sm' 
                    : 'hover:bg-accent/50'
                  }
                `}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className={`font-medium truncate ${isSelected ? 'text-primary' : ''}`}>
                    {project.name}
                  </span>
                  {project.hasOutline && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      有大纲
                    </Badge>
                  )}
                </div>
                
                {/* Progress Bar */}
                <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-1.5">
                  <div 
                    className="h-full progress-gradient rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{project.state.nextChapterIndex - 1} / {project.state.totalChapters} 章</span>
                  <span>{Math.round(progress)}%</span>
                </div>

                {project.state.needHuman && (
                  <Badge variant="destructive" className="mt-2 text-[10px]">
                    需要人工介入
                  </Badge>
                )}
              </button>
            );
          })}
          
          {projects.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <div className="text-4xl mb-2">📖</div>
              <p className="text-sm">暂无项目</p>
              <p className="text-xs">点击上方按钮创建第一个项目</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
