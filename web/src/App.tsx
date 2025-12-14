import { useState, useCallback, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import * as api from '@/lib/api';
import type { ProjectDetail, ProjectSummary } from '@/lib/types';
import JSZip from 'jszip';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

// Layout components
import { Sidebar, Header, ActivityPanel } from '@/components/layout';

// View components
import { 
  DashboardView, 
  ChapterListView, 
  GenerateView, 
  OutlineView, 
  BibleView 
} from '@/components/views';
import { SettingsDialog } from '@/components/SettingsDialog';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';

const LOG_PREFIX = {
  info: '📋',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // AI Config
  const { config: aiConfig, isConfigured } = useAIConfig();

  // Dialog states
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  
  // Form states
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectBible, setNewProjectBible] = useState('');
  const [newProjectChapters, setNewProjectChapters] = useState('400');
  const [aiGenre, setAiGenre] = useState('');
  const [aiTheme, setAiTheme] = useState('');
  const [aiKeywords, setAiKeywords] = useState('');
  const [generatingBible, setGeneratingBible] = useState(false);

  // Outline generation states
  const [outlineChapters, setOutlineChapters] = useState('400');
  const [outlineWordCount, setOutlineWordCount] = useState('100');
  const [outlineCustomPrompt, setOutlineCustomPrompt] = useState('');

  // Chapter generation states
  const [generateCount, setGenerateCount] = useState('1');

  // Load Project Summaries for Sidebar
  const projectSummaries = useLiveQuery(async () => {
    const projs = await db.projects.toArray();
    projs.sort((a, b) => b.created_at - a.created_at);
    
    // Check if states exist, if not create default? (Should exist if project created correctly)
    const summaries: ProjectSummary[] = await Promise.all(projs.map(async (p) => {
      let state = await db.states.get(p.id);
      // Fallback if state missing (migration edge case)
      if (!state) {
        state = {
          project_id: p.id,
          book_title: p.name,
          total_chapters: 100,
          next_chapter_index: 1,
          rolling_summary: '',
          open_loops: [],
          need_human: false
        };
      }
      const outline = await db.outlines.get(p.id);
      return {
        id: p.id,
        name: p.name,
        state: state,
        hasOutline: !!outline
      };
    }));
    return summaries;
  }, []) || [];

  // Load Selected Project Detail
  const selectedProject = useLiveQuery(async () => {
    if (!selectedProjectId) return null;
    const p = await db.projects.get(selectedProjectId);
    if (!p) return null;

    const state = await db.states.get(selectedProjectId);
    const outlineData = await db.outlines.get(selectedProjectId);
    const chapters = await db.chapters.where('project_id').equals(selectedProjectId).toArray();
    chapters.sort((a, b) => a.chapter_index - b.chapter_index);

    return {
      id: p.id,
      name: p.name,
      bible: p.bible,
      state: state!,
      outline: outlineData ? outlineData.outline_json : null,
      chapters: chapters.map(c => c.chapter_index)
    } as ProjectDetail;
  }, [selectedProjectId], null);

  const log = useCallback((msg: string, level: keyof typeof LOG_PREFIX = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${LOG_PREFIX[level]} ${msg}`]);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const handleCreateProject = async () => {
    if (!newProjectName || !newProjectBible) {
      setError('请填写项目名称和 Story Bible');
      return;
    }

    try {
      setLoading(true);
      const projectId = crypto.randomUUID();
      const now = Date.now();
      const totalChapters = parseInt(newProjectChapters, 10) || 100;

      await db.transaction('rw', db.projects, db.states, async () => {
        await db.projects.add({
          id: projectId,
          name: newProjectName,
          bible: newProjectBible,
          created_at: now
        });

        await db.states.add({
          project_id: projectId,
          book_title: newProjectName,
          total_chapters: totalChapters,
          next_chapter_index: 1,
          rolling_summary: '',
          open_loops: [],
          need_human: false
        });
      });

      log(`项目创建成功: ${newProjectName}`, 'success');
      setNewProjectName('');
      setNewProjectBible('');
      setShowNewProjectDialog(false);
      setSelectedProjectId(projectId);
    } catch (err) {
      setError((err as Error).message);
      log(`创建失败: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateBible = async () => {
    if (!isConfigured) {
      setError('请先在设置中配置 AI API Key');
      setShowSettingsDialog(true);
      return;
    }
    setGeneratingBible(true);
    try {
      log('AI 正在想象 Story Bible...', 'info');
      const bible = await api.generateBible(aiGenre, aiTheme, aiKeywords, getAIConfigHeaders(aiConfig));
      setNewProjectBible(bible);
      log('Story Bible 生成完成', 'success');
    } catch (err) {
      setError((err as Error).message);
      log(`生成失败: ${(err as Error).message}`, 'error');
    } finally {
      setGeneratingBible(false);
    }
  };

  const handleGenerateOutline = async () => {
    if (!selectedProject) return;
    if (!isConfigured) {
      setError('请先在设置中配置 AI API Key');
      setShowSettingsDialog(true);
      return;
    }

    try {
      setLoading(true);
      log(`开始生成大纲: ${selectedProject.name}`, 'info');
      
      const outline = await api.generateOutline({
        bible: selectedProject.bible,
        targetChapters: parseInt(outlineChapters, 10),
        targetWordCount: parseInt(outlineWordCount, 10),
        customPrompt: outlineCustomPrompt
      }, getAIConfigHeaders(aiConfig));

      await db.transaction('rw', db.outlines, db.states, async () => {
        await db.outlines.put({
          project_id: selectedProject.id,
          outline_json: outline
        });
        
        await db.states.update(selectedProject.id, {
          total_chapters: outline.totalChapters
        });
      });

      log(`大纲生成完成: ${outline.volumes.length} 卷, ${outline.totalChapters} 章`, 'success');
    } catch (err) {
      setError((err as Error).message);
      log(`生成失败: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateChapters = async () => {
    if (!selectedProject) return;
    if (!isConfigured) {
      setError('请先在设置中配置 AI API Key');
      setShowSettingsDialog(true);
      return;
    }

    try {
      setLoading(true);
      const count = parseInt(generateCount, 10);
      log(`准备生成 ${count} 章...`, 'info');

      for (let i = 0; i < count; i++) {
        // Fetch fresh state for each iteration (though selectedProject updates via liveQuery, transaction is safer)
        const currentState = await db.states.get(selectedProject.id);
        if (!currentState) throw new Error('State lost');
        
        const chapterIndex = currentState.next_chapter_index;
        if (chapterIndex > currentState.total_chapters) {
          log('已达到完结章，停止生成', 'warning');
          break;
        }

        // Get last chapters
        const lastChapters = await db.chapters
          .where('project_id').equals(selectedProject.id)
          .and(c => c.chapter_index < chapterIndex)
          .reverse()
          .limit(2)
          .toArray();
        // reverse back to chronological
        lastChapters.reverse(); 

        log(`正在生成第 ${chapterIndex} 章...`, 'info');

        const result = await api.generateChapter({
          bible: selectedProject.bible,
          rollingSummary: currentState.rolling_summary,
          openLoops: currentState.open_loops,
          lastChapters: lastChapters.map(c => c.content),
          chapterIndex,
          totalChapters: currentState.total_chapters,
          outline: selectedProject.outline,
        }, getAIConfigHeaders(aiConfig));

        // Save chapter and update state
        await db.transaction('rw', db.chapters, db.states, async () => {
          await db.chapters.put({ // using put with compound key handled by dexie definition? NO, we used explicit table def.
            // Wait, we defined key path [project_id+chapter_index].
            // But we need to pass the object properties.
            project_id: selectedProject.id,
            chapter_index: chapterIndex,
            content: result.content,
            created_at: Date.now()
          });

          await db.states.update(selectedProject.id, {
            next_chapter_index: chapterIndex + 1
            // TODO: Update rolling summary and open loops if API returns them (currently API just calls generateText)
            // Ideally we should have an auto-summary step here. 
            // For now, we just keep writing.
          });
        });

        log(`第 ${chapterIndex} 章: ${result.title} ✅`, 'success');
      }
    } catch (err) {
      setError((err as Error).message);
      log(`生成中断: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadBook = async () => {
    if (!selectedProject) return;
    try {
      log('正在打包下载...', 'info');
      const zip = new JSZip();
      const folder = zip.folder(selectedProject.name) || zip;
      
      folder.file('bible.md', selectedProject.bible);
      if (selectedProject.outline) {
        folder.file('outline.json', JSON.stringify(selectedProject.outline, null, 2));
      }
      folder.file(`${selectedProject.name}.txt`, ''); // Placeholders

      const chaptersDir = folder.folder('chapters');
      
      const allChapters = await db.chapters
        .where('project_id').equals(selectedProject.id)
        .toArray();
      allChapters.sort((a, b) => a.chapter_index - b.chapter_index);

      let fullText = `# ${selectedProject.name}\n\n`;
      fullText += `## Story Bible\n\n${selectedProject.bible}\n\n`;

      allChapters.forEach(ch => {
        // Try to find title from outline
        let title = `第 ${ch.chapter_index} 章`;
        if (selectedProject.outline) {
          selectedProject.outline.volumes.forEach(v => {
            const found = v.chapters.find(c => c.index === ch.chapter_index);
            if (found) title = found.title;
          });
        }
        
        // Check if content already has title
        const content = ch.content;
        
        chaptersDir?.file(`${title}.txt`, content);
        fullText += `\n\n## ${title}\n\n${content}`;
      });
      
      folder.file(`${selectedProject.name}.txt`, fullText);

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedProject.name}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      log('下载完成', 'success');
    } catch (err) {
      setError('下载失败: ' + (err as Error).message);
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProject) return;
    if (!confirm(`确定要删除项目 "${selectedProject.name}" 吗？此操作不可恢复。`)) return;
    
    try {
      const pid = selectedProject.id;
      await db.transaction('rw', db.projects, db.states, db.outlines, db.chapters, async () => {
        await db.projects.delete(pid);
        await db.states.delete(pid);
        await db.outlines.delete(pid);
        await db.chapters.where('project_id').equals(pid).delete();
      });
      
      setSelectedProjectId(null);
      log(`已删除项目: ${selectedProject.name}`, 'success');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleResetProject = async () => {
    if (!selectedProject) return;
    try {
      await db.states.update(selectedProject.id, {
        need_human: false,
        need_human_reason: undefined
      });
      log('状态已重置', 'success');
    } catch (err) {
      setError((err as Error).message);
    }
  };
   
  const handleViewChapter = async (index: number) => {
    if (!selectedProject) return '';
    const ch = await db.chapters.get({ project_id: selectedProject.id, chapter_index: index });
    return ch ? ch.content : '';
  };

  const renderContent = () => {
    if (!selectedProject) {
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <div className="text-6xl mb-4">📚</div>
            <p className="text-xl font-medium mb-2">选择一个项目开始</p>
            <p className="text-sm">从左侧选择项目，或创建新项目</p>
          </div>
        </div>
      );
    }

    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardView 
            project={selectedProject} 
            onGenerateOutline={() => setActiveTab('generate')}
            onGenerateChapters={() => setActiveTab('generate')}
            loading={loading}
          />
        );
      case 'outline':
        return <OutlineView project={selectedProject} />;
      case 'generate':
        return (
          <GenerateView
            project={selectedProject}
            loading={loading}
            outlineChapters={outlineChapters}
            outlineWordCount={outlineWordCount}
            outlineCustomPrompt={outlineCustomPrompt}
            onOutlineChaptersChange={setOutlineChapters}
            onOutlineWordCountChange={setOutlineWordCount}
            onOutlineCustomPromptChange={setOutlineCustomPrompt}
            onGenerateOutline={handleGenerateOutline}
            generateCount={generateCount}
            onGenerateCountChange={setGenerateCount}
            onGenerateChapters={handleGenerateChapters}
            onResetState={handleResetProject}
          />
        );
      case 'chapters':
        return (
          <ChapterListView 
            project={selectedProject} 
            onViewChapter={handleViewChapter}
          />
        );
      case 'bible':
        return <BibleView project={selectedProject} />;
      default:
        return null;
    }
  };

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      <Sidebar
        projects={projectSummaries}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        onNewProject={() => setShowNewProjectDialog(true)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          project={selectedProject}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onRefresh={() => {}}
          onDownload={handleDownloadBook}
          onDelete={handleDeleteProject}
          onSettings={() => setShowSettingsDialog(true)}
        />

        {error && (
          <div className="bg-destructive/10 text-destructive px-6 py-3 flex items-center justify-between">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>✕</Button>
          </div>
        )}

        <main className="flex-1 overflow-auto bg-background/50 grid-pattern">
          {renderContent()}
        </main>
      </div>

      <ActivityPanel 
        logs={logs} 
        onClear={() => setLogs([])} 
        progress={null}
      />

      {/* New Project Dialog */}
      <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto glass-card">
          <DialogHeader>
            <DialogTitle className="gradient-text">✨ 新建项目</DialogTitle>
            <DialogDescription>创建本地存储的新项目 (IndexedDB)</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>项目名称</Label>
              <Input
                placeholder="my-novel"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="bg-muted/50"
              />
            </div>
            <div className="space-y-2">
              <Label>计划章数</Label>
              <Input
                type="number"
                value={newProjectChapters}
                onChange={(e) => setNewProjectChapters(e.target.value)}
                className="bg-muted/50"
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Story Bible</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateBible}
                  disabled={generatingBible}
                  className="gap-2"
                >
                  {generatingBible ? '⏳ 生成中...' : '🤖 AI 自动想象'}
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <Input
                  placeholder="题材"
                  value={aiGenre}
                  onChange={(e) => setAiGenre(e.target.value)}
                  className="bg-muted/50"
                />
                <Input
                  placeholder="风格"
                  value={aiTheme}
                  onChange={(e) => setAiTheme(e.target.value)}
                  className="bg-muted/50"
                />
                <Input
                  placeholder="关键词"
                  value={aiKeywords}
                  onChange={(e) => setAiKeywords(e.target.value)}
                  className="bg-muted/50"
                />
              </div>
              <Textarea
                placeholder="世界观、人物设定..."
                className="h-[250px] font-mono text-sm resize-none bg-muted/50"
                value={newProjectBible}
                onChange={(e) => setNewProjectBible(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button 
              onClick={handleCreateProject} 
              disabled={loading}
              className="gradient-bg hover:opacity-90"
            >
              创建项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SettingsDialog 
        open={showSettingsDialog} 
        onOpenChange={setShowSettingsDialog} 
      />
    </div>
  );
}

export default App;
