import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  isRecoverableChunkLoadError,
  recoverFromChunkLoadError,
} from '@/lib/chunkLoadRecovery';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    recoverFromChunkLoadError(error, 'app-error-boundary');
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.assign('/');
  };

  override render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const isChunkError = isRecoverableChunkLoadError(error);

    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="w-full max-w-lg rounded-3xl border border-border/70 bg-card/95 p-8 shadow-xl">
          <div className="mb-6 flex items-center gap-3">
            {isChunkError ? (
              <RefreshCw className="h-8 w-8 text-primary" />
            ) : (
              <AlertTriangle className="h-8 w-8 text-destructive" />
            )}
            <div>
              <h1 className="text-xl font-semibold">
                {isChunkError ? '检测到页面版本已更新' : '页面加载失败'}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {isChunkError
                  ? '当前标签页还在运行旧版本代码，请刷新后重新进入。'
                  : '应用遇到了未处理错误，刷新页面后再试一次。'}
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground break-all">
            {error.message || 'Unknown error'}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={this.handleReload}>刷新页面</Button>
            <Button variant="outline" onClick={this.handleGoHome}>
              返回首页
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
