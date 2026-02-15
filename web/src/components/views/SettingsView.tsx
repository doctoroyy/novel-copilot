import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Save, BookMarked, Users, Map, FileText } from 'lucide-react';
import { updateProject, type ProjectDetail } from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import { useToast } from '@/components/ui/use-toast';

interface SettingsViewProps {
  project: ProjectDetail;
  onRefresh?: () => void;
}

export function SettingsView({ project, onRefresh }: SettingsViewProps) {
  const { toast } = useToast();
  
  const [bible, setBible] = useState(project.bible || '');
  const [background, setBackground] = useState(project.background || '');
  const [roleSettings, setRoleSettings] = useState(project.role_settings || '');
  
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('bible');

  // Update local state when project prop changes (e.g. after refresh)
  useEffect(() => {
    setBible(project.bible || '');
    setBackground(project.background || '');
    setRoleSettings(project.role_settings || '');
  }, [project]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateProject(project.id, {
        bible,
        background,
        role_settings: roleSettings,
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
    <div className="h-full flex flex-col p-4 lg:p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
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

      <div className="flex-1 min-h-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <TabsList className="mb-4 w-full justify-start">
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
          </TabsList>

          <TabsContent value="bible" className="flex-1 min-h-0 mt-0">
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

          <TabsContent value="background" className="flex-1 min-h-0 mt-0">
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

          <TabsContent value="roles" className="flex-1 min-h-0 mt-0">
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
        </Tabs>
      </div>
    </div>
  );
}
