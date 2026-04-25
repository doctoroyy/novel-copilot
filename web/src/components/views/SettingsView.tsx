import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { BookMarked, CheckCircle2, FileText, Loader2, Map, PenLine, Save, Users } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { updateProject, type ProjectDetail } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';

interface SettingsViewProps {
  project: ProjectDetail;
  onRefresh?: () => void;
}

type TextTab = 'bible' | 'background' | 'roles';

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

const TEXT_TAB_META: Record<TextTab, {
  icon: typeof FileText;
  label: string;
  title: string;
  description: string;
  placeholder: string;
}> = {
  bible: {
    icon: FileText,
    label: '核心设定',
    title: 'Story Bible',
    description: '主题、主线、卖点、关键设定与不可违背的规则。',
    placeholder: '输入小说核心设定、大纲摘要、主题思想、关键爽点和限制条件...',
  },
  background: {
    icon: Map,
    label: '世界观',
    title: '世界观与背景',
    description: '地理、历史、组织、技术或特殊体系。',
    placeholder: '描述世界的运作规则、势力分布、城市/地域、历史背景...',
  },
  roles: {
    icon: Users,
    label: '角色',
    title: '角色设定',
    description: '主要角色的动机、能力、关系和变化方向。',
    placeholder: '列出主要角色档案、关系、冲突点、成长路线...',
  },
};

function normalizeChapterPromptProfile(value: string | undefined): string {
  if (!value) return DEFAULT_CHAPTER_PROMPT_PROFILE;
  return CHAPTER_PROMPT_PROFILE_OPTIONS.some((option) => option.id === value)
    ? value
    : DEFAULT_CHAPTER_PROMPT_PROFILE;
}

function countReadableChars(value: string): number {
  return value.replace(/\s/g, '').length;
}

function markdownPreview(value: string): string {
  return value.trim() || '*暂无内容*';
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
  const [customSystemPrompt, setCustomSystemPrompt] = useState(project.custom_system_prompt || '');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TextTab | 'chapter-prompt'>('bible');

  useEffect(() => {
    setBible(project.bible || '');
    setBackground(project.background || '');
    setRoleSettings(project.role_settings || '');
    setChapterPromptProfile(normalizeChapterPromptProfile(project.chapter_prompt_profile));
    setChapterPromptCustom(project.chapter_prompt_custom || '');
    setCustomSystemPrompt(project.custom_system_prompt || '');
  }, [project]);

  const dirty = useMemo(() => {
    return bible !== (project.bible || '')
      || background !== (project.background || '')
      || roleSettings !== (project.role_settings || '')
      || chapterPromptProfile !== normalizeChapterPromptProfile(project.chapter_prompt_profile)
      || chapterPromptCustom !== (project.chapter_prompt_custom || '')
      || customSystemPrompt !== (project.custom_system_prompt || '');
  }, [background, bible, chapterPromptCustom, chapterPromptProfile, customSystemPrompt, project, roleSettings]);

  const activeTextValue = activeTab === 'bible'
    ? bible
    : activeTab === 'background'
      ? background
      : activeTab === 'roles'
        ? roleSettings
        : '';

  const activePromptOption = CHAPTER_PROMPT_PROFILE_OPTIONS.find(
    (option) => option.id === chapterPromptProfile
  ) || CHAPTER_PROMPT_PROFILE_OPTIONS[0];

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateProject(project.id, {
        bible,
        background,
        role_settings: roleSettings,
        chapter_prompt_profile: chapterPromptProfile,
        chapter_prompt_custom: chapterPromptCustom,
        custom_system_prompt: customSystemPrompt,
      });

      toast({
        title: '保存成功',
        description: '项目设定已更新',
      });

      onRefresh?.();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '保存失败',
        description: (error as Error).message,
      });
    } finally {
      setSaving(false);
    }
  };

  const renderTextTab = (tab: TextTab, value: string, onChange: (value: string) => void) => {
    const meta = TEXT_TAB_META[tab];
    return (
      <TabsContent value={tab} className="min-h-0 flex-1 overflow-hidden">
        <div className="grid h-full min-h-[620px] gap-4 lg:grid-cols-2">
          <section className="flex min-h-0 flex-col rounded-lg border bg-background shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
              <div>
                <Label htmlFor={`project-${tab}`} className="text-sm font-semibold">{meta.title}</Label>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.description}</p>
              </div>
              <Badge variant="secondary" className="rounded-md">{countReadableChars(value)} 字</Badge>
            </div>
            <Textarea
              id={`project-${tab}`}
              name={`project-${tab}`}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              className="min-h-[520px] flex-1 resize-none rounded-none border-0 p-4 font-mono text-sm leading-7 focus-visible:ring-0 lg:min-h-0"
              placeholder={meta.placeholder}
            />
          </section>

          <aside className="hidden min-h-0 flex-col rounded-lg border bg-muted/25 shadow-sm lg:flex">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">实时预览</span>
              <Badge variant="outline" className="rounded-md">Markdown</Badge>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              <div className="prose prose-sm max-w-none dark:prose-invert prose-p:leading-7 prose-p:text-foreground/90 prose-li:text-foreground/90">
                <ReactMarkdown>{markdownPreview(value)}</ReactMarkdown>
              </div>
            </div>
          </aside>
        </div>
      </TabsContent>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(to_bottom,var(--background),hsl(var(--muted)/0.35))] p-4 lg:p-6">
      <div className="mb-4 flex shrink-0 flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <BookMarked className="h-4 w-4 text-primary" />
            项目设定
          </div>
          <h2 className="truncate text-2xl font-semibold tracking-normal">知识库与生成规则</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            这些内容会进入生成、续写、质检和写作助手的上下文。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={dirty ? 'default' : 'secondary'} className="h-9 rounded-md px-3">
            {dirty ? '有未保存修改' : '已同步'}
          </Badge>
          <Button onClick={handleSave} disabled={saving || !dirty} className="h-9">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            保存
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TextTab | 'chapter-prompt')} className="flex min-h-0 flex-col">
          <div className="mb-4 overflow-x-auto pb-1">
            <TabsList className="inline-flex min-w-max justify-start">
              {(Object.keys(TEXT_TAB_META) as TextTab[]).map((tab) => {
                const meta = TEXT_TAB_META[tab];
                const Icon = meta.icon;
                return (
                  <TabsTrigger key={tab} value={tab} className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {meta.label}
                  </TabsTrigger>
                );
              })}
              <TabsTrigger value="chapter-prompt" className="flex items-center gap-2">
                <PenLine className="h-4 w-4" />
                正文规则
              </TabsTrigger>
            </TabsList>
          </div>

          {renderTextTab('bible', bible, setBible)}
          {renderTextTab('background', background, setBackground)}
          {renderTextTab('roles', roleSettings, setRoleSettings)}

          <TabsContent value="chapter-prompt" className="min-h-0 flex-1 overflow-auto">
            <div className="grid min-h-[620px] gap-4 lg:grid-cols-2">
              <section className="rounded-lg border bg-background shadow-sm">
                <div className="border-b px-4 py-3">
                  <h3 className="text-sm font-semibold">正文生成模板</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">控制正文的文风、节奏和系统提示词。</p>
                </div>
                <div className="space-y-5 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="chapter-prompt-profile">模板</Label>
                    <Select value={chapterPromptProfile} onValueChange={setChapterPromptProfile}>
                      <SelectTrigger id="chapter-prompt-profile" className="w-full">
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
                    <p className="text-xs leading-5 text-muted-foreground">{activePromptOption.description}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="custom-system-prompt">自定义核心提示词</Label>
                    <Textarea
                      id="custom-system-prompt"
                      name="custom-system-prompt"
                      value={customSystemPrompt}
                      onChange={(event) => setCustomSystemPrompt(event.target.value)}
                      className="min-h-[220px] resize-y font-mono text-sm leading-7"
                      placeholder="留空则使用系统默认规则。填写后会覆盖基础写作规则。"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="chapter-prompt-custom">补充提示词</Label>
                    <Textarea
                      id="chapter-prompt-custom"
                      name="chapter-prompt-custom"
                      value={chapterPromptCustom}
                      onChange={(event) => setChapterPromptCustom(event.target.value)}
                      className="min-h-[160px] resize-y font-mono text-sm leading-7"
                      placeholder="例如：减少形容词密度，多写人物动作和决策。"
                    />
                  </div>
                </div>
              </section>

              <aside className="hidden min-h-0 flex-col rounded-lg border bg-muted/25 shadow-sm lg:flex">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <span className="text-sm font-semibold">当前生效设置</span>
                  <Badge variant="outline" className="rounded-md">{activePromptOption.label}</Badge>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-5">
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:leading-7">
                    <ReactMarkdown>{[
                      `**模板**: ${activePromptOption.label}`,
                      '',
                      `**模板说明**: ${activePromptOption.description}`,
                      '',
                      '**自定义核心提示词**:',
                      customSystemPrompt || '*未设置（使用系统默认）*',
                      '',
                      '**补充提示词**:',
                      chapterPromptCustom || '*未设置*',
                    ].join('\n')}</ReactMarkdown>
                  </div>
                </div>
              </aside>
            </div>
          </TabsContent>
        </Tabs>

        <aside className="hidden">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                记忆覆盖
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">核心设定</span>
                <span className="font-medium">{countReadableChars(bible)} 字</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">世界观</span>
                <span className="font-medium">{countReadableChars(background)} 字</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">角色</span>
                <span className="font-medium">{countReadableChars(roleSettings)} 字</span>
              </div>
              <div className="rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
                当前页：{activeTab === 'chapter-prompt' ? '正文规则' : TEXT_TAB_META[activeTab].title}
                {activeTab !== 'chapter-prompt' ? `，${countReadableChars(activeTextValue)} 字` : ''}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
