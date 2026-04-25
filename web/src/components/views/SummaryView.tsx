import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, ListTodo, Newspaper, Route } from 'lucide-react';
import type { ProjectDetail } from '@/lib/api';

interface SummaryViewProps {
  project: ProjectDetail;
}

function countReadableChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

export function SummaryView({ project }: SummaryViewProps) {
  const summary = project.state.rollingSummary?.trim() || '';
  const openLoops = project.state.openLoops || [];
  const generatedChapters = Math.max(0, project.state.nextChapterIndex - 1);
  const progress = project.state.totalChapters > 0
    ? Math.round((generatedChapters / project.state.totalChapters) * 100)
    : 0;

  return (
    <div className="h-full min-h-0 overflow-auto bg-[linear-gradient(to_bottom,var(--background),hsl(var(--muted)/0.35))] p-4 lg:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:h-full">
        <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Newspaper className="h-4 w-4 text-primary" />
              连续性记忆
            </div>
            <h2 className="truncate text-2xl font-semibold tracking-normal">剧情摘要</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              用于保持章节连续性的中短期记忆，生成下一章前应先确认这里没有断裂。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-[11px] text-muted-foreground">摘要字数</p>
              <p className="text-sm font-semibold">{countReadableChars(summary)}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-[11px] text-muted-foreground">未闭环</p>
              <p className="text-sm font-semibold">{openLoops.length}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-[11px] text-muted-foreground">进度</p>
              <p className="text-sm font-semibold">{progress}%</p>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-h-[520px] overflow-hidden rounded-lg border bg-background shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">当前剧情记忆</span>
              </div>
              <Badge variant="secondary" className="rounded-md">
                {generatedChapters} / {project.state.totalChapters} 章
              </Badge>
            </div>
            <div className="h-[calc(100dvh-250px)] min-h-[460px] overflow-auto px-5 py-5 lg:px-8">
              {summary ? (
                <div className="whitespace-pre-wrap text-sm leading-8 text-foreground/90 lg:text-base">
                  {summary}
                </div>
              ) : (
                <div className="grid h-full place-items-center">
                  <div className="max-w-sm text-center">
                    <Newspaper className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
                    <h3 className="text-lg font-semibold">暂无剧情摘要</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      生成章节后，系统会把关键进展沉淀到这里，作为后续章节的连续性记忆。
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-3">
            <section className="rounded-lg border bg-background p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">未闭环线索</h3>
                </div>
                <Badge variant="outline" className="rounded-md">{openLoops.length}</Badge>
              </div>
              {openLoops.length === 0 ? (
                <p className="text-sm leading-6 text-muted-foreground">暂无未闭环线索。</p>
              ) : (
                <ul className="space-y-2">
                  {openLoops.map((loop, index) => (
                    <li
                      key={`${loop}-${index}`}
                      className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm leading-6 text-foreground/90"
                    >
                      {loop}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border bg-background p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                {project.state.needHuman ? (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                )}
                <h3 className="text-sm font-semibold">人工介入状态</h3>
              </div>
              {project.state.needHuman ? (
                <Badge variant="destructive" className="rounded-md">需要人工介入</Badge>
              ) : (
                <Badge variant="secondary" className="rounded-md">当前无需人工介入</Badge>
              )}
              {project.state.needHumanReason ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{project.state.needHumanReason}</p>
              ) : (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  当前没有被系统标记的阻塞原因。
                </p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
