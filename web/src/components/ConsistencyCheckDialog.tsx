import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, CheckCircle2, AlertTriangle, Lightbulb, XCircle } from 'lucide-react';
import { checkConsistency, type ConsistencyReport } from '@/lib/api';

interface ConsistencyCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  chapterIndex: number; // 1-based
  content: string;
  context?: string;
}

export function ConsistencyCheckDialog({
  open,
  onOpenChange,
  projectName,
  chapterIndex,
  content,
  context,
}: ConsistencyCheckDialogProps) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    
    try {
      const result = await checkConsistency(projectName, chapterIndex, content, context);
      setReport(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Reset state when dialog opens
  if (open && !loading && !report && !error) {
     // Auto-start check on open? Or wait for user?
     // Let's wait for user or maybe auto-start if it's convenient.
     // For now, let's show a "Start Check" button inside.
     // Better yet, start automatically if it's the first time opening for this content?
     // No, manual is safer.
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>一致性检查 (AI)</DialogTitle>
          <DialogDescription>
            检查当前章节内容是否与小说设定（世界观、角色）冲突，以及逻辑连贯性。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-4 py-4">
          {!report && !loading && !error && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
              <CheckCircle2 className="h-16 w-16 mb-4 opacity-20" />
              <h3 className="text-lg font-medium mb-2">准备就绪</h3>
              <p className="mb-6 max-w-sm">
                AI 将阅读本章内容，并比对项目设定集(Bible)和前文摘要，找出可能的逻辑漏洞或人设崩坏。
              </p>
              <Button size="lg" onClick={handleCheck}>
                开始检查
              </Button>
            </div>
          )}

          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-lg font-medium animate-pulse">正在分析剧情逻辑...</p>
              <p className="text-sm text-muted-foreground mt-2">这可能需要几十秒，请稍候。</p>
            </div>
          )}

          {error && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-destructive">
              <XCircle className="h-12 w-12 mb-4" />
              <h3 className="text-lg font-medium mb-2">检查失败</h3>
              <p>{error}</p>
              <Button variant="outline" className="mt-4" onClick={handleCheck}>
                重试
              </Button>
            </div>
          )}

          {report && (
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-6">
                {/* Summary Card */}
                <div className="bg-muted/30 p-4 rounded-lg border">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-lg">总体评价</h3>
                    <div className={`px-3 py-1 rounded-full text-sm font-bold ${
                      report.overall_score >= 80 ? 'bg-green-100 text-green-700' :
                      report.overall_score >= 60 ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      分数: {report.overall_score}
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed">{report.summary}</p>
                </div>

                {/* Issues List */}
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    发现的问题 ({report.issues.length})
                  </h3>
                  
                  {report.issues.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                      <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>未发现明显逻辑漏洞或设定冲突。</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {report.issues.map((issue, i) => (
                        <div key={i} className="border rounded-lg p-4 bg-card shadow-sm">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase border ${
                                issue.severity === 'high' ? 'bg-red-50 text-red-700 border-red-200' :
                                issue.severity === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                'bg-blue-50 text-blue-700 border-blue-200'
                              }`}>
                                {issue.severity}
                              </span>
                              <span className="text-sm font-semibold capitalize text-muted-foreground">
                                {issue.type}
                              </span>
                            </div>
                          </div>
                          
                          <p className="font-medium text-sm mb-2">{issue.description}</p>
                          
                          {issue.quote && (
                            <div className="bg-muted pl-3 border-l-2 border-primary/50 py-2 my-2 text-xs italic text-muted-foreground">
                              "{issue.quote}"
                            </div>
                          )}
                          
                          {issue.suggestion && (
                            <div className="mt-3 flex items-start gap-2 text-sm bg-green-50/50 p-3 rounded text-green-800 dark:text-green-300 dark:bg-green-900/20">
                              <Lightbulb className="h-4 w-4 mt-0.5 shrink-0" />
                              <div>
                                <strong>建议:</strong> {issue.suggestion}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
