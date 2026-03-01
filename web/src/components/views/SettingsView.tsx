import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, BookMarked, Users, Map, FileText, PenLine } from 'lucide-react';
import { updateProject, type ProjectDetail } from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import { useToast } from '@/components/ui/use-toast';

interface SettingsViewProps {
  project: ProjectDetail;
  onRefresh?: () => void;
}

const DEFAULT_CHAPTER_PROMPT_PROFILE = 'web_novel_light';

const CHAPTER_PROMPT_PROFILE_OPTIONS = [
  {
    id: 'web_novel_light',
    label: '轻快网文（默认）',
    description: '阅读顺滑，少修饰，适合日更连载。',
  },
  {
    id: 'plot_first',
    label: '剧情推进',
    description: '冲突密度更高，强调事件推进与爽点。',
  },
  {
    id: 'cinematic',
    label: '电影感',
    description: '保留画面感，但避免辞藻堆叠。',
  },
] as const;

function normalizeChapterPromptProfile(value: string | undefined): string {
  if (!value) return DEFAULT_CHAPTER_PROMPT_PROFILE;
  return CHAPTER_PROMPT_PROFILE_OPTIONS.some((option) => option.id === value)
    ? value
    : DEFAULT_CHAPTER_PROMPT_PROFILE;
}

export function SettingsView({ project, onRefresh }: SettingsViewProps) {
  const { toast } = useToast();
  
  const [bible, setBible] = useState(project.bible || '');
  const [background, setBackground] = useState(project.background || '');
  const [roleSettings, setRoleSettings] = useState(project.role_settings || '');
  const [chapterPromptProfile, setChapterPromptProfile] = useState(
    normalizeChapterPromptProfile(project.chapter_prompt_profile)
  );
  const [chapterPromptCustom, setChapterPromptCustom] = useState(project.chapter_prompt_custom || '');
  
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('bible');

  // Update local state when project prop changes (e.g. after refresh)
  useEffect(() => {
    setBible(project.bible || '');
    setBackground(project.background || '');
    setRoleSettings(project.role_settings || '');
    setChapterPromptProfile(normalizeChapterPromptProfile(project.chapter_prompt_profile));
    setChapterPromptCustom(project.chapter_prompt_custom || '');
  }, [project]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateProject(project.id, {
        bible,
        background,
        role_settings: roleSettings,
        chapter_prompt_profile: chapterPromptProfile,
        chapter_prompt_custom: chapterPromptCustom,
      });
      
      toast({
        title: "保存成功",
        description: "项目设定已更新",
      });
      
      if (onRefresh) onRefresh();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "保存失败",
        description: (error as Error).message,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col p-4 lg:p-6">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <BookMarked className="h-6 w-6 text-primary" />
            知识库与设定
          </h2>
          <p className="text-sm text-muted-foreground">
            管理小说的核心设定，这些信息将被 AI 用于保持故事一致性。
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          保存更改
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="mb-4 overflow-x-auto pb-1">
            <TabsList className="inline-flex min-w-max justify-start">
              <TabsTrigger value="bible" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Story Bible (核心)
              </TabsTrigger>
              <TabsTrigger value="background" className="flex items-center gap-2">
                <Map className="h-4 w-4" />
                世界观与背景
              </TabsTrigger>
              <TabsTrigger value="roles" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                角色设定
              </TabsTrigger>
              <TabsTrigger value="chapter-prompt" className="flex items-center gap-2">
                <PenLine className="h-4 w-4" />
                正文提示词
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="bible" className="flex-1 min-h-0 mt-0 overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
              <Card className="h-full flex flex-col">
                <CardHeader className="py-3">
                  <CardTitle className="text-base">编辑内容</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                  <Textarea
                    value={bible}
                    onChange={(e) => setBible(e.target.value)}
                    className="h-full border-0 focus-visible:ring-0 resize-none p-4 rounded-b-lg font-mono text-sm leading-relaxed"
                    placeholder="在这里输入小说的核心设定、大纲摘要、主题思想等..."
                  />
                </CardContent>
              </Card>
              <Card className="h-full hidden lg:flex flex-col bg-muted/30">
                 <CardHeader className="py-3">
                  <CardTitle className="text-base">预览</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-4 prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{bible || '*暂无内容*'}</ReactMarkdown>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="background" className="flex-1 min-h-0 mt-0 overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
              <Card className="h-full flex flex-col">
                <CardHeader className="py-3">
                  <CardTitle className="text-base">世界观设定</CardTitle>
                  <CardDescription>地理、历史、魔法/科技体系、势力分布等</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                  <Textarea
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    className="h-full border-0 focus-visible:ring-0 resize-none p-4 rounded-b-lg font-mono text-sm leading-relaxed"
                    placeholder="描述这个世界的运作规则..."
                  />
                </CardContent>
              </Card>
              <Card className="h-full hidden lg:flex flex-col bg-muted/30">
                 <CardHeader className="py-3">
                  <CardTitle className="text-base">预览</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-4 prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{background || '*暂无内容*'}</ReactMarkdown>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="roles" className="flex-1 min-h-0 mt-0 overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
              <Card className="h-full flex flex-col">
                <CardHeader className="py-3">
                  <CardTitle className="text-base">角色设定</CardTitle>
                  <CardDescription>主要角色的性格、外貌、能力、人际关系等</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                  <Textarea
                    value={roleSettings}
                    onChange={(e) => setRoleSettings(e.target.value)}
                    className="h-full border-0 focus-visible:ring-0 resize-none p-4 rounded-b-lg font-mono text-sm leading-relaxed"
                    placeholder="列出主要角色的详细档案..."
                  />
                </CardContent>
              </Card>
              <Card className="h-full hidden lg:flex flex-col bg-muted/30">
                 <CardHeader className="py-3">
                  <CardTitle className="text-base">预览</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-4 prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{roleSettings || '*暂无内容*'}</ReactMarkdown>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="chapter-prompt" className="flex-1 min-h-0 mt-0 overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
              <Card className="h-full flex flex-col">
                <CardHeader className="py-3">
                  <CardTitle className="text-base">正文生成模板</CardTitle>
                  <CardDescription>控制生成正文的文风与节奏，可叠加自定义补充提示词</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">模板</p>
                    <Select value={chapterPromptProfile} onValueChange={setChapterPromptProfile}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="选择正文模板" />
                      </SelectTrigger>
                      <SelectContent>
                        {CHAPTER_PROMPT_PROFILE_OPTIONS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {CHAPTER_PROMPT_PROFILE_OPTIONS.find((option) => option.id === chapterPromptProfile)?.description || ''}
                    </p>
                  </div>

                  <div className="space-y-2 flex-1 min-h-[260px] flex flex-col">
                    <p className="text-sm font-medium">自定义补充提示词（可选）</p>
                    <Textarea
                      value={chapterPromptCustom}
                      onChange={(e) => setChapterPromptCustom(e.target.value)}
                      className="flex-1 resize-none font-mono text-sm leading-relaxed"
                      placeholder="例如：减少形容词密度，多写人物动作和决策，不要机械承接上一章最后一句。"
                    />
                    <p className="text-xs text-muted-foreground">
                      这里填写的是补充要求；留空时仅使用模板默认规则。
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="h-full hidden lg:flex flex-col bg-muted/30">
                <CardHeader className="py-3">
                  <CardTitle className="text-base">当前生效设置</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-4 prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{[
                    `**模板**: ${CHAPTER_PROMPT_PROFILE_OPTIONS.find((option) => option.id === chapterPromptProfile)?.label || '轻快网文（默认）'}`,
                    '',
                    `**模板说明**: ${CHAPTER_PROMPT_PROFILE_OPTIONS.find((option) => option.id === chapterPromptProfile)?.description || ''}`,
                    '',
                    '**自定义补充提示词**:',
                    chapterPromptCustom || '*未设置*',
                  ].join('\n')}
                  </ReactMarkdown>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
