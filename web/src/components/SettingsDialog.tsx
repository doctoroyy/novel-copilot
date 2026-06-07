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
import { Settings, Cpu } from 'lucide-react';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl glass-card w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Settings className="h-5 w-5" />
            <span>设置</span>
          </DialogTitle>
          <DialogDescription className="text-sm">
            AI 模型配置与系统设置
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="general">AI 服务商</TabsTrigger>
            <TabsTrigger value="models">模型路由</TabsTrigger>
          </TabsList>
          
          <TabsContent value="general" className="space-y-4 py-4">
            <AIConfigSection />
          </TabsContent>

          <TabsContent value="models" className="space-y-4 py-4">
            <div className="p-4 rounded-lg border bg-muted/30 mb-4">
              <div className="flex items-center gap-3 mb-2">
                <Cpu className="h-5 w-5 text-blue-500" />
                <span className="font-medium text-sm">高级模型路由</span>
              </div>
              <p className="text-xs text-muted-foreground">
                为特定功能（如"生成大纲"、"润色章节"）指定不同的模型，优化成本和质量。
              </p>
            </div>
            <ModelFeatureConfig />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
