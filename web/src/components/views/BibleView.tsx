import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BookMarked, FileText, Layers3, ListTree, ScrollText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { ProjectDetail } from '@/lib/api';

interface BibleViewProps {
  project: ProjectDetail;
}

type BibleSection = {
  id: string;
  title: string;
  level: number;
};

function getBibleSections(markdown: string): BibleSection[] {
  return markdown
    .split('\n')
    .map((line, index) => {
      const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      if (!match) return null;
      return {
        id: `bible-section-${index}`,
        title: match[2].replace(/\*/g, '').trim(),
        level: match[1].length,
      };
    })
    .filter((section): section is BibleSection => Boolean(section))
    .slice(0, 10);
}

function countReadableChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

export function BibleView({ project }: BibleViewProps) {
  const bible = project.bible || '';
  const sections = getBibleSections(bible);
  const readableChars = countReadableChars(bible);
  const volumeCount = project.outline?.volumes.length || 0;
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
              <BookMarked className="h-4 w-4 text-primary" />
              项目记忆
            </div>
            <h2 className="truncate text-2xl font-semibold tracking-normal">小说设定</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              世界观、角色背景、核心规则会作为后续生成和质检的基础上下文。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-[11px] text-muted-foreground">设定字数</p>
              <p className="text-sm font-semibold">{readableChars}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-[11px] text-muted-foreground">卷数</p>
              <p className="text-sm font-semibold">{volumeCount || '-'}</p>
            </div>
            <div className="rounded-md border bg-background px-3 py-2">
              <p className="text-[11px] text-muted-foreground">进度</p>
              <p className="text-sm font-semibold">{progress}%</p>
            </div>
          </div>
        </div>

        {bible ? (
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="min-h-[520px] overflow-hidden rounded-lg border bg-background shadow-sm">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <ScrollText className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">设定正文</span>
                </div>
                <Badge variant="secondary" className="rounded-md">{sections.length || 1} 段</Badge>
              </div>
              <div className="h-[calc(100dvh-250px)] min-h-[460px] overflow-auto px-5 py-5 lg:px-8">
                <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:scroll-mt-24 prose-headings:text-foreground prose-p:leading-7 prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90">
                  <ReactMarkdown>{bible}</ReactMarkdown>
                </div>
              </div>
            </section>

            <aside className="space-y-3">
              <div className="rounded-lg border bg-background p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <ListTree className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">设定索引</h3>
                </div>
                {sections.length > 0 ? (
                  <div className="space-y-1.5">
                    {sections.map((section) => (
                      <Button
                        key={section.id}
                        variant="ghost"
                        className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left text-xs"
                        onClick={() => {
                          document
                            .querySelectorAll('.prose h1, .prose h2, .prose h3')
                            .item(sections.indexOf(section))
                            ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                        }}
                      >
                        <span className="mr-2 text-muted-foreground">{section.level === 1 ? 'H1' : section.level === 2 ? 'H2' : 'H3'}</span>
                        <span className="line-clamp-2">{section.title}</span>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    当前设定没有 Markdown 标题。给关键段落加上标题后，这里会变成可跳转索引。
                  </p>
                )}
              </div>

              <div className="rounded-lg border bg-background p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Layers3 className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">当前结构</h3>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">已生成章节</span>
                    <span className="font-medium">{generatedChapters} / {project.state.totalChapters}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, progress)}%` }} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">每章目标</span>
                    <span className="font-medium">{project.state.minChapterWords} 字起</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <div className="grid min-h-[560px] place-items-center rounded-lg border border-dashed bg-background">
            <div className="max-w-sm px-6 text-center">
              <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
              <h3 className="text-lg font-semibold">暂无小说设定</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                创建项目时填写 Story Bible，或在项目设定页补全世界观、角色和生成规则。
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
