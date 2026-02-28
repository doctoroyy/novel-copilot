import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { AIConfigSection } from './AIConfigSection';
import { ModelFeatureConfig } from './admin/ModelFeatureConfig';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { Bot, Shield, Zap, Settings, Cpu } from 'lucide-react';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl glass-card w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Settings className="h-5 w-5" />
            <span>设置</span>
          </DialogTitle>
          <DialogDescription className="text-sm">
            管理您的个人偏好和系统设置
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="general">常规设置</TabsTrigger>
            {user?.role === 'admin' && (
              <TabsTrigger value="models">模型配置</TabsTrigger>
            )}
          </TabsList>
          
          <TabsContent value="general" className="space-y-4 py-4">
            {/* 自定义 AI 配置（对所有用户开放） */}
            <AIConfigSection />

            {/* AI 状态说明 */}
            <div className="p-4 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-3 mb-2">
                <Bot className="h-5 w-5 text-primary" />
                <span className="font-medium text-sm">AI 模型配置</span>
              </div>
              <p className="text-xs text-muted-foreground">
                系统默认提供的模型由管理员配置。您也可以在上方填写自己的 API Key 和代理地址进行覆盖。
              </p>
            </div>

            {/* Credit Info */}
            <div className="p-4 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-3 mb-2">
                <Zap className="h-5 w-5 text-amber-500" />
                <span className="font-medium text-sm">创作能量</span>
              </div>
              <p className="text-xs text-muted-foreground">
                使用 AI 功能会消耗创作能量。点击顶栏的⚡图标可查看余额和消费记录。
              </p>
            </div>
            
            {user?.role === 'admin' && (
              <div className="pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    navigate('/admin');
                    onOpenChange(false);
                  }}
                  className="w-full justify-start"
                >
                  <Shield className="h-4 w-4 mr-2" />
                  前往管理后台
                </Button>
              </div>
            )}
          </TabsContent>

          {user?.role === 'admin' && (
            <TabsContent value="models" className="space-y-4 py-4">
              <div className="p-4 rounded-lg border bg-muted/30 mb-4">
                <div className="flex items-center gap-3 mb-2">
                  <Cpu className="h-5 w-5 text-blue-500" />
                  <span className="font-medium text-sm">高级模型路由</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  在此处可以为特定的功能（如“生成大纲”、“润色章节”）指定使用特定的模型。
                  这允许您优化成本和质量。
                </p>
              </div>
              <ModelFeatureConfig />
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
