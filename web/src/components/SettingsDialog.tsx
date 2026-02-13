import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { Bot, Shield, Zap } from 'lucide-react';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md glass-card w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span>⚙️</span>
            <span>设置</span>
          </DialogTitle>
          <DialogDescription className="text-sm">
            AI 配置由管理员统一管理
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Custom AI Config (Only for whitelisted users) */}
          {user?.allowCustomProvider && (
            <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
              <div className="flex items-center gap-3">
                <Bot className="h-5 w-5 text-primary" />
                <span className="font-medium text-sm">自定义模型配置</span>
              </div>
              
              <div className="grid gap-3">
                <div className="grid gap-1">
                  <label className="text-xs font-medium">提供商 (Provider)</label>
                  <input
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="openai, anthropic"
                    defaultValue={localStorage.getItem('ai_provider') || ''}
                    onChange={(e) => {
                      if (e.target.value) localStorage.setItem('ai_provider', e.target.value);
                      else localStorage.removeItem('ai_provider');
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs font-medium">模型名称 (Model)</label>
                  <input
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="gpt-4o, claude-3-5-sonnet"
                    defaultValue={localStorage.getItem('ai_model') || ''}
                    onChange={(e) => {
                      if (e.target.value) localStorage.setItem('ai_model', e.target.value);
                      else localStorage.removeItem('ai_model');
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs font-medium">API Base URL</label>
                  <input
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="https://api.openai.com/v1"
                    defaultValue={localStorage.getItem('ai_base_url') || ''}
                    onChange={(e) => {
                      if (e.target.value) localStorage.setItem('ai_base_url', e.target.value);
                      else localStorage.removeItem('ai_base_url');
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs font-medium">API Key</label>
                  <input
                    type="password"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="sk-..."
                    defaultValue={localStorage.getItem('ai_api_key') || ''}
                    onChange={(e) => {
                      if (e.target.value) localStorage.setItem('ai_api_key', e.target.value);
                      else localStorage.removeItem('ai_api_key');
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* AI Status (Default - only show if NOT using custom or for non-whitelisted) */}
          {(!user?.allowCustomProvider) && (
            <div className="p-4 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-3 mb-2">
                <Bot className="h-5 w-5 text-primary" />
                <span className="font-medium text-sm">AI 模型配置</span>
              </div>
              <p className="text-xs text-muted-foreground">
                AI 模型和 API Key 由管理员在后台统一配置，
                无需手动设置。如需调整模型，请联系管理员。
              </p>
            </div>
          )}

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
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {user?.role === 'admin' && (
            <Button
              variant="secondary"
              onClick={() => {
                navigate('/admin');
                onOpenChange(false);
              }}
              className="w-full sm:w-auto text-sm mr-auto"
            >
              <Shield className="h-4 w-4 mr-1.5" />
              管理后台
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto text-sm"
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
