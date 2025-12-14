import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  fetchProjects,
  fetchProject,
  createProject,
  generateOutline,
  generateChapters,
  fetchChapter,
  deleteProject,
  resetProject,
  generateBible,
  type ProjectSummary,
  type ProjectDetail,
} from '@/lib/api';

function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // New project form
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectBible, setNewProjectBible] = useState('');
  const [newProjectChapters, setNewProjectChapters] = useState('400');
  const [aiGenre, setAiGenre] = useState('');
  const [aiTheme, setAiTheme] = useState('');
  const [aiKeywords, setAiKeywords] = useState('');
  const [generatingBible, setGeneratingBible] = useState(false);

  // Outline form
  const [outlineChapters, setOutlineChapters] = useState('400');
  const [outlineWordCount, setOutlineWordCount] = useState('100');
  const [outlineCustomPrompt, setOutlineCustomPrompt] = useState('');

  // Generate form
  const [generateCount, setGenerateCount] = useState('1');

  // Chapter viewer
  const [viewingChapter, setViewingChapter] = useState<{ index: number; content: string } | null>(null);

  const log = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadProject = useCallback(async (name: string) => {
    try {
      setLoading(true);
      const data = await fetchProject(name);
      setSelectedProject(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreateProject = async () => {
    if (!newProjectName || !newProjectBible) {
      setError('请填写项目名称和 Story Bible');
      return;
    }
    try {
      setLoading(true);
      log(`创建项目: ${newProjectName}`);
      await createProject(newProjectName, newProjectBible, parseInt(newProjectChapters, 10));
      log('✅ 项目创建成功');
      setNewProjectName('');
      setNewProjectBible('');
      await loadProjects();
    } catch (err) {
      setError((err as Error).message);
      log(`❌ 创建失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateOutline = async () => {
    if (!selectedProject) return;
    try {
      setLoading(true);
      log(`生成大纲: ${selectedProject.name}`);
      const outline = await generateOutline(
        selectedProject.name,
        parseInt(outlineChapters, 10),
        parseInt(outlineWordCount, 10),
        outlineCustomPrompt || undefined
      );
      log(`✅ 大纲生成完成: ${outline.volumes.length} 卷, ${outline.totalChapters} 章`);
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
      log(`❌ 生成失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateChapters = async () => {
    if (!selectedProject) return;
    try {
      setLoading(true);
      const count = parseInt(generateCount, 10);
      log(`生成章节: ${selectedProject.name}, ${count} 章`);
      const results = await generateChapters(selectedProject.name, count);
      for (const r of results) {
        log(`✅ 第${r.chapter}章: ${r.title}`);
      }
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
      log(`❌ 生成失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleViewChapter = async (index: number) => {
    if (!selectedProject) return;
    try {
      const content = await fetchChapter(selectedProject.name, index);
      setViewingChapter({ index, content });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteProject = async (name: string) => {
    if (!confirm(`确定要删除项目 "${name}" 吗？此操作不可恢复。`)) return;
    try {
      await deleteProject(name);
      log(`🗑️ 已删除项目: ${name}`);
      if (selectedProject?.name === name) {
        setSelectedProject(null);
      }
      await loadProjects();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleResetProject = async () => {
    if (!selectedProject) return;
    try {
      await resetProject(selectedProject.name);
      log(`🔄 已重置项目状态: ${selectedProject.name}`);
      await loadProject(selectedProject.name);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto py-6 px-4">
        <h1 className="text-3xl font-bold mb-6">📚 Novel Automation</h1>

        {error && (
          <div className="bg-destructive/10 text-destructive p-4 rounded-lg mb-4">
            {error}
            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-4">
              ✕
            </Button>
          </div>
        )}

        <div className="grid grid-cols-12 gap-6">
          {/* Sidebar - Project List */}
          <div className="col-span-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">项目列表</CardTitle>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" className="w-full mt-2">
                      + 新建项目
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>新建项目</DialogTitle>
                      <DialogDescription>创建一个新的小说项目</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>项目名称</Label>
                        <Input
                          placeholder="my-novel"
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>计划章数</Label>
                        <Input
                          type="number"
                          value={newProjectChapters}
                          onChange={(e) => setNewProjectChapters(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <Label>Story Bible</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              setGeneratingBible(true);
                              try {
                                log('🤖 AI 正在想象 Story Bible...');
                                const bible = await generateBible(aiGenre, aiTheme, aiKeywords);
                                setNewProjectBible(bible);
                                log('✅ Story Bible 生成完成');
                              } catch (err) {
                                setError((err as Error).message);
                                log(`❌ 生成失败: ${(err as Error).message}`);
                              } finally {
                                setGeneratingBible(false);
                              }
                            }}
                            disabled={generatingBible}
                          >
                            {generatingBible ? '⏳ 生成中...' : '✨ AI 自动想象'}
                          </Button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <Input
                            placeholder="题材: 玄幻/都市/科幻"
                            value={aiGenre}
                            onChange={(e) => setAiGenre(e.target.value)}
                          />
                          <Input
                            placeholder="风格: 热血/悬疑/爽文"
                            value={aiTheme}
                            onChange={(e) => setAiTheme(e.target.value)}
                          />
                          <Input
                            placeholder="关键词: 逆袭、复仇"
                            value={aiKeywords}
                            onChange={(e) => setAiKeywords(e.target.value)}
                          />
                        </div>
                        <Textarea
                          placeholder="世界观、人物设定、主线目标..."
                          className="h-[300px] max-h-[300px] font-mono text-sm resize-none"
                          value={newProjectBible}
                          onChange={(e) => setNewProjectBible(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline">取消</Button>
                      </DialogClose>
                      <Button onClick={handleCreateProject} disabled={loading}>
                        创建
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {projects.map((p) => (
                      <div
                        key={p.name}
                        className={`p-3 rounded-lg cursor-pointer hover:bg-accent transition-colors ${
                          selectedProject?.name === p.name ? 'bg-accent' : ''
                        }`}
                        onClick={() => loadProject(p.name)}
                      >
                        <div className="font-medium">{p.name}</div>
                        <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                          <span>
                            {p.state.nextChapterIndex - 1}/{p.state.totalChapters}
                          </span>
                          {p.hasOutline && <Badge variant="secondary">有大纲</Badge>}
                          {p.state.needHuman && <Badge variant="destructive">需人工</Badge>}
                        </div>
                      </div>
                    ))}
                    {projects.length === 0 && (
                      <div className="text-muted-foreground text-center py-8">暂无项目</div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="col-span-6">
            {selectedProject ? (
              <Tabs defaultValue="outline">
                <TabsList className="mb-4">
                  <TabsTrigger value="outline">大纲生成</TabsTrigger>
                  <TabsTrigger value="generate">章节生成</TabsTrigger>
                  <TabsTrigger value="chapters">已生成章节</TabsTrigger>
                  <TabsTrigger value="bible">Story Bible</TabsTrigger>
                </TabsList>

                <TabsContent value="outline">
                  <Card>
                    <CardHeader>
                      <CardTitle>生成大纲</CardTitle>
                      <CardDescription>
                        为 "{selectedProject.name}" 生成百万字大纲
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>目标章数</Label>
                          <Input
                            type="number"
                            value={outlineChapters}
                            onChange={(e) => setOutlineChapters(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>目标字数（万字）</Label>
                          <Input
                            type="number"
                            value={outlineWordCount}
                            onChange={(e) => setOutlineWordCount(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>自定义提示词（可选）</Label>
                        <Textarea
                          placeholder="添加额外的写作要求，如：多加感情线、增加反转..."
                          className="min-h-[120px]"
                          value={outlineCustomPrompt}
                          onChange={(e) => setOutlineCustomPrompt(e.target.value)}
                        />
                      </div>
                      <Button onClick={handleGenerateOutline} disabled={loading} className="w-full">
                        {loading ? '生成中...' : '🚀 生成大纲'}
                      </Button>

                      {selectedProject.outline && (
                        <div className="mt-4 p-4 bg-muted rounded-lg">
                          <div className="font-medium mb-2">当前大纲</div>
                          <div className="text-sm text-muted-foreground">
                            主线: {selectedProject.outline.mainGoal}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {selectedProject.outline.volumes.length} 卷 /{' '}
                            {selectedProject.outline.totalChapters} 章 /{' '}
                            {selectedProject.outline.targetWordCount} 万字
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="generate">
                  <Card>
                    <CardHeader>
                      <CardTitle>生成章节</CardTitle>
                      <CardDescription>
                        当前进度: {selectedProject.state.nextChapterIndex - 1}/
                        {selectedProject.state.totalChapters}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>生成章数</Label>
                        <Select value={generateCount} onValueChange={setGenerateCount}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 章</SelectItem>
                            <SelectItem value="5">5 章</SelectItem>
                            <SelectItem value="10">10 章</SelectItem>
                            <SelectItem value="20">20 章</SelectItem>
                            <SelectItem value="50">50 章</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handleGenerateChapters} disabled={loading} className="w-full">
                        {loading ? '生成中...' : '📝 开始生成'}
                      </Button>

                      {selectedProject.state.needHuman && (
                        <div className="p-4 bg-destructive/10 rounded-lg">
                          <div className="font-medium text-destructive mb-2">需要人工介入</div>
                          <div className="text-sm">{selectedProject.state.needHumanReason}</div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleResetProject}
                            className="mt-2"
                          >
                            重置状态
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="chapters">
                  <Card>
                    <CardHeader>
                      <CardTitle>已生成章节</CardTitle>
                      <CardDescription>共 {selectedProject.chapters.length} 章</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[400px]">
                        <div className="space-y-1">
                          {selectedProject.chapters.map((ch) => {
                            const index = parseInt(ch.replace('.md', ''), 10);
                            return (
                              <div
                                key={ch}
                                className="p-2 rounded hover:bg-accent cursor-pointer flex justify-between items-center"
                                onClick={() => handleViewChapter(index)}
                              >
                                <span>第 {index} 章</span>
                                <Button variant="ghost" size="sm">
                                  查看
                                </Button>
                              </div>
                            );
                          })}
                          {selectedProject.chapters.length === 0 && (
                            <div className="text-muted-foreground text-center py-8">
                              暂无生成的章节
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="bible">
                  <Card>
                    <CardHeader>
                      <CardTitle>Story Bible</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[400px]">
                        <pre className="whitespace-pre-wrap text-sm font-mono">
                          {selectedProject.bible}
                        </pre>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            ) : (
              <Card>
                <CardContent className="py-16 text-center text-muted-foreground">
                  ← 选择一个项目开始
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Sidebar - Logs */}
          <div className="col-span-3">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg">日志</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setLogs([])}>
                    清空
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-1 font-mono text-xs">
                    {logs.map((log, i) => (
                      <div key={i} className="text-muted-foreground">
                        {log}
                      </div>
                    ))}
                    {logs.length === 0 && (
                      <div className="text-muted-foreground text-center py-4">暂无日志</div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {selectedProject && (
              <Card className="mt-4">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">项目操作</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => loadProject(selectedProject.name)}
                  >
                    🔄 刷新
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={() => handleDeleteProject(selectedProject.name)}
                  >
                    🗑️ 删除项目
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Chapter Viewer Dialog */}
        <Dialog open={!!viewingChapter} onOpenChange={() => setViewingChapter(null)}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>第 {viewingChapter?.index} 章</DialogTitle>
            </DialogHeader>
            <ScrollArea className="h-[60vh]">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                {viewingChapter?.content}
              </pre>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export default App;
