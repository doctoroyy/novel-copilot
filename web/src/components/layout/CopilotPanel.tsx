import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle,
  Bot,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  GripVertical,
  History,
  Loader2,
  Plus,
  Send,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import {
  confirmCopilotProposal,
  createCopilotSession,
  fetchCopilotSession,
  fetchCopilotWorkspace,
  sendCopilotMessageStream,
  updateCopilotSettings,
  type AgentMessage,
  type AgentProposal,
  type AgentSessionDetail,
  type AgentSessionSummary,
  type CopilotWorkspace,
  type ProjectDetail,
} from '@/lib/api';

const PANEL_WIDTH_STORAGE_KEY = 'novel-copilot-panel-width';
const PANEL_DEFAULT_WIDTH = 520;
const PANEL_MIN_WIDTH = 440;
const PANEL_MAX_WIDTH = 760;
const AUTO_SCROLL_THRESHOLD = 96;

interface CopilotPanelProps {
  project: ProjectDetail | null;
  isMobile?: boolean;
  onProjectRefresh?: () => void;
}

type ConversationTurn = {
  id: string;
  userMessage: AgentMessage | null;
  traces: AgentMessage[];
  assistantMessage: AgentMessage | null;
  proposal: AgentProposal | null;
  resultMessages: AgentMessage[];
  systemMessages: AgentMessage[];
  createdAt: number;
};

type PlanStepStatus = 'idle' | 'running' | 'done' | 'attention';

type PlanStep = {
  key: string;
  title: string;
  detail: string;
  status: PlanStepStatus;
};

function clampDesktopPanelWidth(width: number): number {
  if (typeof window === 'undefined') {
    return PANEL_DEFAULT_WIDTH;
  }

  const runtimeMax = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, window.innerWidth - 280));
  return Math.min(Math.max(width, PANEL_MIN_WIDTH), runtimeMax);
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function formatSessionTimestamp(timestamp: number): string {
  if (!timestamp) return '';

  try {
    const date = new Date(timestamp);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return new Intl.DateTimeFormat('zh-CN', sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  } catch {
    return '';
  }
}

function truncateText(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function buildEmptyDetail(session: AgentSessionSummary): AgentSessionDetail {
  return {
    session,
    entries: [],
  };
}

function upsertMessageEntry(
  detail: AgentSessionDetail | null,
  session: AgentSessionSummary,
  message: AgentMessage
): AgentSessionDetail {
  const base = detail ?? buildEmptyDetail(session);
  if (base.entries.some((entry) => entry.kind === 'message' && entry.message.id === message.id)) {
    return base;
  }

  return {
    ...base,
    session,
    entries: [
      ...base.entries,
      {
        kind: 'message' as const,
        message,
        createdAt: message.createdAt,
      },
    ].sort((left, right) => left.createdAt - right.createdAt),
  };
}

function upsertProposalEntry(
  detail: AgentSessionDetail | null,
  session: AgentSessionSummary,
  proposal: AgentProposal
): AgentSessionDetail {
  const base = detail ?? buildEmptyDetail(session);
  if (base.entries.some((entry) => entry.kind === 'proposal' && entry.proposal.id === proposal.id)) {
    return base;
  }

  return {
    ...base,
    session,
    entries: [
      ...base.entries,
      {
        kind: 'proposal' as const,
        proposal,
        createdAt: proposal.createdAt,
      },
    ].sort((left, right) => left.createdAt - right.createdAt),
  };
}

function getPayloadText(message: AgentMessage | null | undefined, key: string): string {
  const value = message?.payload?.[key];
  return typeof value === 'string' ? value : '';
}

function getTraceTitle(message: AgentMessage): string {
  return getPayloadText(message, 'title') || message.content;
}

function getTraceDetail(message: AgentMessage): string {
  return getPayloadText(message, 'detail');
}

function getMessageDisplayMode(message: AgentMessage | null | undefined): 'markdown' | 'fallback' {
  return message?.payload?.displayMode === 'fallback' ? 'fallback' : 'markdown';
}

function getDebugRawOutput(message: AgentMessage | null | undefined): string {
  return getPayloadText(message, 'debugRawOutput');
}

function buildConversationTurns(entries: AgentSessionDetail['entries']): ConversationTurn[] {
  const sortedEntries = [...entries].sort((left, right) => left.createdAt - right.createdAt);
  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;

  const ensureCurrentTurn = (createdAt: number): ConversationTurn => {
    if (currentTurn) return currentTurn;

    currentTurn = {
      id: `turn-${createdAt}-${turns.length}`,
      userMessage: null,
      traces: [],
      assistantMessage: null,
      proposal: null,
      resultMessages: [],
      systemMessages: [],
      createdAt,
    };
    turns.push(currentTurn);
    return currentTurn;
  };

  for (const entry of sortedEntries) {
    if (entry.kind === 'message') {
      const { message } = entry;

      if (message.role === 'user') {
        currentTurn = {
          id: message.id || `turn-${message.createdAt}-${turns.length}`,
          userMessage: message,
          traces: [],
          assistantMessage: null,
          proposal: null,
          resultMessages: [],
          systemMessages: [],
          createdAt: message.createdAt,
        };
        turns.push(currentTurn);
        continue;
      }

      const turn = ensureCurrentTurn(entry.createdAt);
      if (message.role === 'trace') {
        turn.traces.push(message);
      } else if (message.role === 'assistant') {
        turn.assistantMessage = message;
      } else if (message.role === 'result') {
        turn.resultMessages.push(message);
      } else {
        turn.systemMessages.push(message);
      }
      continue;
    }

    const turn = ensureCurrentTurn(entry.createdAt);
    turn.proposal = entry.proposal;
  }

  return turns;
}

function buildPlanSteps(
  turn: ConversationTurn | null,
  sending: boolean,
  streamingAssistantText: string
): PlanStep[] {
  if (!turn) {
    return [
      {
        key: 'context',
        title: '读取上下文',
        detail: '等待新的项目级任务，准备同步设定、大纲、人物与相关章节。',
        status: 'idle',
      },
      {
        key: 'analysis',
        title: '分析结构',
        detail: '收到请求后会先给出自然语言分析，再整理可执行建议。',
        status: 'idle',
      },
      {
        key: 'proposal',
        title: '整理 proposal / 执行项',
        detail: '涉及多个对象的改动会汇总成整批 proposal，等待你确认。',
        status: 'idle',
      },
    ];
  }

  const assistantMode = getMessageDisplayMode(turn.assistantMessage);
  const assistantPreview = turn.assistantMessage
    ? truncateText(turn.assistantMessage.content, 110)
    : truncateText(streamingAssistantText, 110);

  const latestResult = turn.resultMessages.at(-1) || null;
  const latestResultError = getPayloadText(latestResult, 'error');

  let proposalStatus: PlanStepStatus = 'idle';
  let proposalDetail = '本轮暂无整批 proposal，可继续追问让 Copilot 细化。';

  if (turn.proposal) {
    if (turn.proposal.status === 'failed') {
      proposalStatus = 'attention';
      proposalDetail = turn.proposal.errorMessage || 'proposal 执行失败，请查看结果区。';
    } else if (turn.proposal.status === 'executed') {
      proposalStatus = 'done';
      proposalDetail = turn.proposal.resultSummary
        ? truncateText(turn.proposal.resultSummary, 120)
        : `已执行 ${turn.proposal.actions.length} 个动作。`;
    } else {
      proposalStatus = 'done';
      proposalDetail = `已整理 ${turn.proposal.actions.length} 个执行动作，等待确认。`;
    }
  } else if (latestResult) {
    proposalStatus = latestResultError ? 'attention' : 'done';
    proposalDetail = truncateText(latestResult.content, 120);
  } else if (sending || streamingAssistantText.trim()) {
    proposalStatus = 'running';
    proposalDetail = '正在整理本轮可执行建议与变更预览。';
  }

  return [
    {
      key: 'context',
      title: '读取上下文',
      detail: getTraceDetail(turn.traces[0]) || '已同步当前项目设定、大纲、人物与相关章节。',
      status: 'done',
    },
    {
      key: 'analysis',
      title: '分析结构',
      detail: assistantPreview || '正在整理论证链和自然语言答复。',
      status: turn.assistantMessage
        ? assistantMode === 'fallback'
          ? 'attention'
          : 'done'
        : sending || streamingAssistantText.trim()
          ? 'running'
          : 'idle',
    },
    {
      key: 'proposal',
      title: '整理 proposal / 执行项',
      detail: proposalDetail,
      status: proposalStatus,
    },
  ];
}

function getRiskBadgeVariant(proposal: AgentProposal): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (proposal.riskLevel === 'high') return 'destructive';
  if (proposal.riskLevel === 'medium') return 'secondary';
  return 'outline';
}

function getProposalStatusVariant(status: AgentProposal['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') return 'destructive';
  if (status === 'executed' || status === 'confirmed') return 'secondary';
  if (status === 'rejected') return 'outline';
  return 'default';
}

function getProposalStatusLabel(status: AgentProposal['status']): string {
  switch (status) {
    case 'pending':
      return '待确认';
    case 'confirmed':
      return '已确认';
    case 'executed':
      return '已执行';
    case 'failed':
      return '执行失败';
    case 'rejected':
      return '已拒绝';
    default:
      return status;
  }
}

function formatPreviewItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (Array.isArray(item)) {
    return item.map((entry) => formatPreviewItem(entry)).filter(Boolean).join(' / ');
  }
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    const preferred = [
      record.summary,
      record.previewText,
      record.title,
      record.goal,
      record.name,
      record.description,
      record.content,
    ].find((value) => typeof value === 'string' && value.trim());
    if (typeof preferred === 'string') return preferred;

    try {
      return JSON.stringify(item, null, 2);
    } catch {
      return '[unserializable preview]';
    }
  }
  return '';
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="min-w-0 text-[15px] leading-7 text-foreground">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-border pl-4 text-muted-foreground last:mb-0">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-xl border border-border/80 bg-muted/40 last:mb-0">
              {children}
            </pre>
          ),
          code: ({ inline, children, className, ...props }: any) => (
            inline ? (
              <code className="rounded bg-muted px-1.5 py-0.5 text-[13px]" {...props}>
                {children}
              </code>
            ) : (
              <code className={cn('block px-4 py-3 text-[13px] leading-6', className)} {...props}>
                {children}
              </code>
            )
          ),
          hr: () => <hr className="my-4 border-border/70" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function PlanStatusIcon({ status }: { status: PlanStepStatus }) {
  if (status === 'done') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  }
  if (status === 'running') {
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  }
  if (status === 'attention') {
    return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  }
  return <Clock3 className="h-4 w-4 text-muted-foreground" />;
}

function PlanSurface({
  steps,
  sessionTitle,
  skillCount,
}: {
  steps: PlanStep[];
  sessionTitle: string;
  skillCount: number;
}) {
  return (
    <div className="border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Current Plan
          </div>
          <div className="mt-1 text-sm font-medium">{sessionTitle}</div>
        </div>
        <div className="text-xs text-muted-foreground">启用 {skillCount} 个 skills</div>
      </div>
      <div className="mt-3 space-y-2">
        {steps.map((step) => (
          <div
            key={step.key}
            className="rounded-xl border border-border/70 bg-card/80 px-3 py-2.5 shadow-sm shadow-black/5"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                <PlanStatusIcon status={step.status} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{step.title}</div>
                <div className="mt-1 text-xs leading-6 text-muted-foreground">{step.detail}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TraceDisclosure({ traces }: { traces: AgentMessage[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border/70 bg-background/60">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
        onClick={() => setOpen((prev) => !prev)}
      >
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Process
          </div>
          <div className="mt-1 text-sm font-medium">{traces.length} 个步骤</div>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open ? (
        <div className="space-y-2 border-t border-border/60 px-3 py-3">
          {traces.map((trace) => (
            <div key={trace.id} className="rounded-lg border border-border/60 bg-card/80 px-3 py-2.5">
              <div className="text-sm font-medium">{getTraceTitle(trace)}</div>
              {getTraceDetail(trace) ? (
                <div className="mt-1 text-xs leading-6 text-muted-foreground">{getTraceDetail(trace)}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AssistantBlock({
  message,
  streaming,
}: {
  message: AgentMessage | null;
  streaming?: boolean;
}) {
  const content = message?.content?.trim() || '';
  const displayMode = getMessageDisplayMode(message);
  const debugRawOutput = getDebugRawOutput(message);

  return (
    <section className="rounded-xl border border-border/70 bg-card/90 px-4 py-3 shadow-sm shadow-black/5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Copilot
          </span>
        </div>
        {streaming ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <span className="text-[11px] text-muted-foreground">{formatTimestamp(message?.createdAt || 0)}</span>
        )}
      </div>

      {displayMode === 'fallback' ? (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-6 text-amber-700">
          结构化输出异常，已将原始结果收起，只保留可继续操作的简要提示。
        </div>
      ) : null}

      <div className="mt-3">
        <MarkdownContent content={content || '正在分析项目上下文并组织本轮建议...'} />
      </div>

      {debugRawOutput ? (
        <details className="mt-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">查看原始输出</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
            {debugRawOutput}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

function ResultBlock({ message }: { message: AgentMessage }) {
  return (
    <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
            Result
          </span>
        </div>
        <span className="text-[11px] text-emerald-700/80">{formatTimestamp(message.createdAt)}</span>
      </div>
      <div className="mt-3">
        <MarkdownContent content={message.content} />
      </div>
    </section>
  );
}

function ProposalCard({
  proposal,
  confirming,
  onConfirm,
}: {
  proposal: AgentProposal;
  confirming: boolean;
  onConfirm: () => void;
}) {
  const previewGroups = [
    { label: '项目设定', items: proposal.preview.project },
    { label: '大纲', items: proposal.preview.outline },
    { label: '人物', items: proposal.preview.characters },
    { label: '章节', items: proposal.preview.chapters },
  ].filter((group) => group.items.length > 0);

  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 shadow-sm shadow-black/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700">Proposal</div>
          <div className="mt-1 text-base font-semibold leading-7">{proposal.summary || proposal.goal}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={getRiskBadgeVariant(proposal)}>风险 {proposal.riskLevel}</Badge>
          <Badge variant={getProposalStatusVariant(proposal.status)}>{getProposalStatusLabel(proposal.status)}</Badge>
        </div>
      </div>

      {proposal.reasoningSummary ? (
        <p className="mt-3 text-sm leading-7 text-muted-foreground">{proposal.reasoningSummary}</p>
      ) : null}

      {proposal.actions.length > 0 ? (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">执行动作</div>
          <div className="mt-2 space-y-2">
            {proposal.actions.map((action, index) => (
              <div
                key={`${proposal.id}-action-${index}`}
                className="rounded-lg border border-border/70 bg-background/70 px-3 py-2.5"
              >
                <div className="text-sm font-medium">{action.summary || action.type}</div>
                <div className="mt-1 text-xs text-muted-foreground">{action.type}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {previewGroups.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {previewGroups.map((group) => (
            <div key={`${proposal.id}-${group.label}`} className="rounded-lg border border-border/60 bg-card/70 px-3 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{group.label}</div>
              <div className="mt-2 space-y-1.5">
                {group.items.map((item, index) => (
                  <div key={`${proposal.id}-${group.label}-${index}`} className="text-sm leading-6 text-foreground/90">
                    {formatPreviewItem(item)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <details className="mt-4 rounded-lg border border-border/70 bg-background/70 px-3 py-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">查看结构化 JSON</summary>
        <pre className="mt-2 overflow-x-auto text-[11px] leading-5 text-muted-foreground">
          {JSON.stringify(proposal, null, 2)}
        </pre>
      </details>

      {proposal.status === 'pending' ? (
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={onConfirm} disabled={confirming}>
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
            执行全部
          </Button>
        </div>
      ) : proposal.errorMessage || proposal.resultSummary ? (
        <div className="mt-4 text-xs leading-6 text-muted-foreground">
          {proposal.errorMessage || proposal.resultSummary}
        </div>
      ) : null}
    </section>
  );
}

function TurnCard({
  turn,
  confirmingProposalId,
  onConfirmProposal,
}: {
  turn: ConversationTurn;
  confirmingProposalId: string | null;
  onConfirmProposal: (proposalId: string) => void;
}) {
  return (
    <article className="space-y-3 rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm shadow-black/5">
      {turn.userMessage ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Message
            </div>
            <div className="text-[11px] text-muted-foreground">{formatTimestamp(turn.userMessage.createdAt)}</div>
          </div>
          <div className="whitespace-pre-wrap text-[15px] font-medium leading-7 text-foreground">
            {turn.userMessage.content}
          </div>
        </section>
      ) : null}

      {turn.traces.length > 0 ? <TraceDisclosure traces={turn.traces} /> : null}

      {turn.assistantMessage ? <AssistantBlock message={turn.assistantMessage} /> : null}

      {turn.proposal ? (
        <ProposalCard
          proposal={turn.proposal}
          confirming={confirmingProposalId === turn.proposal.id}
          onConfirm={() => onConfirmProposal(turn.proposal!.id)}
        />
      ) : null}

      {turn.resultMessages.map((message) => (
        <ResultBlock key={message.id} message={message} />
      ))}
    </article>
  );
}

export function CopilotPanel({ project, isMobile = false, onProjectRefresh }: CopilotPanelProps) {
  const { toast } = useToast();
  const [workspace, setWorkspace] = useState<CopilotWorkspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<AgentSessionDetail | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [creatingSession, setCreatingSession] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamingAssistantText, setStreamingAssistantText] = useState('');
  const [confirmingProposalId, setConfirmingProposalId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [desktopWidth, setDesktopWidth] = useState(PANEL_DEFAULT_WIDTH);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const enabledSkills = useMemo(() => {
    if (!workspace) return [];
    return workspace.skills.filter((skill) => workspace.settings.enabledSkillIds.includes(skill.id));
  }, [workspace]);

  const starterPrompts = useMemo(() => {
    const prompts = new Set<string>();
    enabledSkills.forEach((skill) => {
      skill.starterPrompts.forEach((prompt) => {
        if (prompts.size < 3) prompts.add(prompt);
      });
    });
    return Array.from(prompts);
  }, [enabledSkills]);

  const selectedSessionSummary = useMemo(() => {
    if (!workspace || !selectedSessionId) return null;
    return workspace.sessions.find((session) => session.id === selectedSessionId) || null;
  }, [workspace, selectedSessionId]);

  const turns = useMemo(
    () => buildConversationTurns(sessionDetail?.entries || []),
    [sessionDetail?.entries]
  );

  const activeTurn = useMemo(() => turns.at(-1) || null, [turns]);

  const planSteps = useMemo(
    () => buildPlanSteps(activeTurn, sending, streamingAssistantText),
    [activeTurn, sending, streamingAssistantText]
  );

  const activeSessionTitle = sessionDetail?.session.title
    || selectedSessionSummary?.title
    || '项目级 Agent 工作台';
  const activeSkillCount = selectedSessionSummary?.enabledSkillIds.length ?? workspace?.settings.enabledSkillIds.length ?? 0;
  const showStarterPrompts = Boolean(
    workspace?.settings.enabled
    && starterPrompts.length > 0
    && (!selectedSessionId || turns.length === 0)
    && !sending
  );

  useEffect(() => {
    if (isMobile || typeof window === 'undefined') return;

    const storedValue = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    if (!storedValue) return;

    const parsed = Number.parseInt(storedValue, 10);
    if (Number.isFinite(parsed)) {
      setDesktopWidth(clampDesktopPanelWidth(parsed));
    }
  }, [isMobile]);

  useEffect(() => {
    if (isMobile || typeof window === 'undefined') return;
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(clampDesktopPanelWidth(desktopWidth)));
  }, [desktopWidth, isMobile]);

  useEffect(() => {
    if (isMobile || typeof window === 'undefined') return;

    const handleResize = () => {
      setDesktopWidth((prev) => clampDesktopPanelWidth(prev));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMobile]);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      shouldAutoScrollRef.current = distanceToBottom < AUTO_SCROLL_THRESHOLD;
    };

    handleScroll();
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport || !shouldAutoScrollRef.current) return;

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: selectedSessionId ? 'smooth' : 'auto',
    });
  }, [selectedSessionId, turns.length, streamingAssistantText, sessionLoading]);

  async function loadWorkspace(preferredSessionId?: string | null) {
    if (!project) {
      setWorkspace(null);
      setSelectedSessionId(null);
      setSessionDetail(null);
      return;
    }

    try {
      setWorkspaceLoading(true);
      const nextWorkspace = await fetchCopilotWorkspace(project.id);
      setWorkspace(nextWorkspace);

      const nextSessionId = preferredSessionId && nextWorkspace.sessions.some((session) => session.id === preferredSessionId)
        ? preferredSessionId
        : selectedSessionId && nextWorkspace.sessions.some((session) => session.id === selectedSessionId)
          ? selectedSessionId
          : nextWorkspace.sessions[0]?.id || null;

      setSelectedSessionId(nextSessionId);
      if (!nextSessionId) {
        setSessionDetail(null);
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Copilot 工作区加载失败',
        description: (error as Error).message,
      });
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function loadSession(sessionId: string) {
    try {
      setSessionLoading(true);
      const detail = await fetchCopilotSession(sessionId);
      setSessionDetail(detail);
      setStreamingAssistantText('');
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '会话加载失败',
        description: (error as Error).message,
      });
    } finally {
      setSessionLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      setStreamingAssistantText('');
      return;
    }

    if (sessionDetail?.session.id === selectedSessionId) {
      return;
    }

    shouldAutoScrollRef.current = true;
    setSessionDetail(null);
    void loadSession(selectedSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, sessionDetail?.session.id]);

  async function handleToggleEnabled(nextEnabled: boolean) {
    if (!project || !workspace) return;

    try {
      setSavingSettings(true);
      const settings = await updateCopilotSettings(project.id, {
        enabled: nextEnabled,
        enabledSkillIds: workspace.settings.enabledSkillIds,
      });
      setWorkspace({
        ...workspace,
        settings,
      });

      if (nextEnabled && workspace.sessions.length === 0) {
        await handleCreateSession();
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '更新 Copilot 设置失败',
        description: (error as Error).message,
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleToggleSkill(skillId: string) {
    if (!project || !workspace) return;

    const enabledSkillIds = workspace.settings.enabledSkillIds.includes(skillId)
      ? workspace.settings.enabledSkillIds.filter((id) => id !== skillId)
      : [...workspace.settings.enabledSkillIds, skillId];

    try {
      setSavingSettings(true);
      const settings = await updateCopilotSettings(project.id, {
        enabled: workspace.settings.enabled,
        enabledSkillIds,
      });
      setWorkspace({
        ...workspace,
        settings,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '更新 Skill 失败',
        description: (error as Error).message,
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleCreateSession(): Promise<AgentSessionSummary | null> {
    if (!project) return null;

    try {
      setCreatingSession(true);
      shouldAutoScrollRef.current = true;
      const session = await createCopilotSession(project.id);
      await loadWorkspace(session.id);
      setSelectedSessionId(session.id);
      setSessionDetail(buildEmptyDetail(session));
      return session;
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '创建会话失败',
        description: (error as Error).message,
      });
      return null;
    } finally {
      setCreatingSession(false);
    }
  }

  async function handleSendMessage(promptOverride?: string) {
    if (!project || !workspace) return;

    const content = (promptOverride ?? messageInput).trim();
    if (!content) return;

    try {
      setSending(true);
      setStreamingAssistantText('');
      shouldAutoScrollRef.current = true;

      let session = selectedSessionSummary;
      if (!session) {
        session = await handleCreateSession();
        if (!session) return;
      }

      setSelectedSessionId(session.id);
      setSessionDetail((prev) => prev ?? buildEmptyDetail(session as AgentSessionSummary));
      setMessageInput('');

      const detail = await sendCopilotMessageStream(session.id, content, {
        onMessage: (message) => {
          setSessionDetail((prev) => upsertMessageEntry(prev, session as AgentSessionSummary, message));
        },
        onAssistantDelta: (delta) => {
          setStreamingAssistantText((prev) => `${prev}${delta}`);
        },
        onProposal: (proposal) => {
          setSessionDetail((prev) => upsertProposalEntry(prev, session as AgentSessionSummary, proposal));
        },
        onDone: (nextDetail) => {
          setStreamingAssistantText('');
          setSessionDetail(nextDetail);
        },
      });

      setStreamingAssistantText('');
      setSessionDetail(detail);
      await loadWorkspace(detail.session.id);
    } catch (error) {
      setStreamingAssistantText('');
      toast({
        variant: 'destructive',
        title: '发送消息失败',
        description: (error as Error).message,
      });
    } finally {
      setSending(false);
    }
  }

  async function handleConfirmProposal(proposalId: string) {
    try {
      setConfirmingProposalId(proposalId);
      shouldAutoScrollRef.current = true;
      const detail = await confirmCopilotProposal(proposalId);
      setSessionDetail(detail);
      await loadWorkspace(detail.session.id);
      if (onProjectRefresh) {
        await onProjectRefresh();
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '执行 proposal 失败',
        description: (error as Error).message,
      });
    } finally {
      setConfirmingProposalId(null);
    }
  }

  function handleResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (isMobile) return;

    event.preventDefault();

    const handleMove = (moveEvent: PointerEvent) => {
      setDesktopWidth(clampDesktopPanelWidth(window.innerWidth - moveEvent.clientX));
    };

    const stop = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      resizeCleanupRef.current = null;
    };

    resizeCleanupRef.current = stop;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  return (
    <>
      <aside
        className={cn(
          'flex h-full min-h-0 max-w-[100vw] flex-col overflow-hidden border-l border-border bg-sidebar/95 backdrop-blur',
          isMobile ? 'w-screen' : 'relative'
        )}
        style={isMobile ? undefined : { width: `${desktopWidth}px` }}
      >
        {!isMobile ? (
          <div
            className="absolute inset-y-0 left-0 z-20 flex w-3 -translate-x-1.5 cursor-col-resize items-center justify-center"
            onPointerDown={handleResizePointerDown}
          >
            <div className="rounded-full border border-border/70 bg-background/90 p-1 text-muted-foreground shadow-sm">
              <GripVertical className="h-3 w-3" />
            </div>
          </div>
        ) : null}

        <div className="border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <div className="text-sm font-semibold">Copilot</div>
                <span
                  className={cn(
                    'h-2.5 w-2.5 rounded-full',
                    workspace?.settings.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                  )}
                />
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {project ? project.name : '未选择项目'}
                {project ? ` · ${activeSessionTitle}` : ''}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setHistoryOpen(true)}
                disabled={!project || workspaceLoading}
                title="会话历史"
              >
                <History className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void handleCreateSession()}
                disabled={!workspace?.settings.enabled || creatingSession || sending}
                title="新建会话"
              >
                {creatingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSettingsOpen(true)}
                disabled={!project}
                title="Copilot 设置"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <PlanSurface
          steps={planSteps}
          sessionTitle={activeSessionTitle}
          skillCount={activeSkillCount}
        />

        <div ref={messageViewportRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {!project ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/60 p-6 text-center text-sm text-muted-foreground">
              选择一个项目后再打开 Copilot。
            </div>
          ) : workspaceLoading && !workspace ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : workspace && !workspace.settings.enabled ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/60 p-5">
              <div className="flex items-center gap-3 text-sm font-medium">
                <Bot className="h-4 w-4 text-primary" />
                这个项目的 Copilot 当前已停用
              </div>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                在设置里启用后，可以继续用项目级多会话、可见轨迹和整批 proposal 确认工作流。
              </p>
              <div className="mt-4">
                <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                  打开设置
                </Button>
              </div>
            </div>
          ) : sessionLoading && !sessionDetail ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : turns.length > 0 ? (
            <div className="space-y-4">
              {turns.map((turn) => (
                <TurnCard
                  key={turn.id}
                  turn={turn}
                  confirmingProposalId={confirmingProposalId}
                  onConfirmProposal={(proposalId) => void handleConfirmProposal(proposalId)}
                />
              ))}

              {(sending || streamingAssistantText.trim()) ? (
                <AssistantBlock
                  message={{
                    id: 'streaming-assistant',
                    role: 'assistant',
                    content: streamingAssistantText,
                    payload: null,
                    createdAt: Date.now(),
                  }}
                  streaming
                />
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/60 p-5">
              <div className="text-sm font-medium">从一个项目级问题开始</div>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                例如让 Copilot 审查中盘疲软、重构人物成长线，或者为指定章节生成一份整批修改 proposal。
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-border bg-background/90 px-4 py-3 backdrop-blur">
          {showStarterPrompts ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void handleSendMessage(prompt)}
                  className="rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}

          <div className="rounded-2xl border border-border/80 bg-card/80 p-3 shadow-sm shadow-black/5">
            <Textarea
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void handleSendMessage();
                }
              }}
              placeholder="例如：检查目前的中盘结构，并给我一份涉及大纲、人物和第 12 章的整批修正方案。"
              className="min-h-[92px] border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
              disabled={!workspace?.settings.enabled || sending}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-[11px] text-muted-foreground">Ctrl/Cmd + Enter 发送</div>
              <Button
                size="sm"
                onClick={() => void handleSendMessage()}
                disabled={!workspace?.settings.enabled || sending || !messageInput.trim()}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                发送
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="gap-0 p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>会话历史</DialogTitle>
            <DialogDescription>多会话不再常驻占据右栏，统一收进这里切换。</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between border-b border-border px-6 py-3">
            <div className="text-sm text-muted-foreground">
              {workspace?.sessions.length ?? 0} 个会话
            </div>
            <Button
              size="sm"
              onClick={async () => {
                const session = await handleCreateSession();
                if (session) {
                  setHistoryOpen(false);
                }
              }}
              disabled={!workspace?.settings.enabled || creatingSession}
            >
              {creatingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              新会话
            </Button>
          </div>

          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 p-4">
              {workspace?.sessions.length ? workspace.sessions.map((session) => {
                const active = session.id === selectedSessionId;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => {
                      shouldAutoScrollRef.current = true;
                      setSelectedSessionId(session.id);
                      setHistoryOpen(false);
                    }}
                    className={cn(
                      'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/10'
                        : 'border-border/70 bg-card/70 hover:bg-accent/60'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{session.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          会话 skills {session.enabledSkillIds.length}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatSessionTimestamp(session.updatedAt)}
                      </div>
                    </div>
                  </button>
                );
              }) : (
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  还没有会话，创建一个新的项目级创作线程。
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>Copilot 设置</DialogTitle>
            <DialogDescription>项目级开关和默认 skills 在这里维护。</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 p-6">
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-card/70 px-4 py-4">
              <div>
                <div className="text-base font-semibold">项目级 Agent</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  当前 {workspace?.settings.enabled ? '已启用' : '已停用'}，默认启用 {workspace?.settings.enabledSkillIds.length ?? 0} 个 skills
                </div>
              </div>
              <Button
                variant={workspace?.settings.enabled ? 'secondary' : 'default'}
                size="sm"
                onClick={() => void handleToggleEnabled(!workspace?.settings.enabled)}
                disabled={!workspace || savingSettings || workspaceLoading}
              >
                {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {workspace?.settings.enabled ? '停用' : '启用'}
              </Button>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">默认 Skills</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    这些开关会影响之后新建的会话；已有会话沿用创建时的 skill 快照。
                  </div>
                </div>
                <Badge variant="outline">{workspace?.settings.enabledSkillIds.length ?? 0} 已启用</Badge>
              </div>

              <div className="mt-4 space-y-3">
                {workspace?.skills.length ? workspace.skills.map((skill) => {
                  const active = workspace.settings.enabledSkillIds.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => void handleToggleSkill(skill.id)}
                      className={cn(
                        'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                        active
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-border/70 bg-background/60 hover:bg-accent/60'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{skill.name}</div>
                          <div className="mt-1 text-xs leading-6 text-muted-foreground">{skill.description}</div>
                        </div>
                        <Badge variant={active ? 'secondary' : 'outline'}>{active ? 'Enabled' : 'Disabled'}</Badge>
                      </div>
                    </button>
                  );
                }) : (
                  <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                    暂无平台级 skills。
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
