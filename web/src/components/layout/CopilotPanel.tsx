import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CheckCheck,
  Loader2,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
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

interface CopilotPanelProps {
  project: ProjectDetail | null;
  onProjectRefresh?: () => void;
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
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

function MessageBubble({ message }: { message: AgentMessage }) {
  if (message.role === 'trace') {
    const title = typeof message.payload?.title === 'string' ? message.payload.title : message.content;
    const detail = typeof message.payload?.detail === 'string' ? message.payload.detail : '';
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Trace</div>
        <div className="mt-2 text-lg font-semibold">{title}</div>
        {detail ? (
          <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{detail}</div>
        ) : null}
      </div>
    );
  }

  const isUser = message.role === 'user';
  const isResult = message.role === 'result';
  const bubbleClass = isUser
    ? 'ml-10 bg-primary text-primary-foreground'
    : isResult
      ? 'mr-10 border border-emerald-500/30 bg-emerald-500/10'
      : 'mr-10 border border-border bg-card/90';

  return (
    <div className={`rounded-[28px] px-5 py-4 shadow-sm ${bubbleClass}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] opacity-80">
          {isUser ? 'You' : isResult ? 'Result' : 'Copilot'}
        </span>
        <span className="text-[11px] opacity-70">{formatTimestamp(message.createdAt)}</span>
      </div>
      <div className="whitespace-pre-wrap text-base leading-8">{message.content}</div>
    </div>
  );
}

function StreamingAssistantBubble({ content }: { content: string }) {
  return (
    <div className="mr-10 rounded-[28px] border border-border bg-card/90 px-5 py-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Copilot
        </span>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
      <div className="whitespace-pre-wrap text-base leading-8 text-foreground">
        {content || '正在分析项目上下文并组织建议...'}
      </div>
    </div>
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

  const riskVariant = proposal.riskLevel === 'high'
    ? 'destructive'
    : proposal.riskLevel === 'medium'
      ? 'secondary'
      : 'outline';

  return (
    <div className="rounded-[28px] border border-amber-500/30 bg-amber-500/5 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700">Proposal</div>
          <div className="mt-2 text-lg font-semibold leading-8">{proposal.summary || proposal.goal}</div>
        </div>
        <Badge variant={riskVariant as 'default' | 'secondary' | 'destructive' | 'outline'}>
          风险 {proposal.riskLevel}
        </Badge>
      </div>

      {proposal.reasoningSummary ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
          {proposal.reasoningSummary}
        </p>
      ) : null}

      {proposal.actions.length > 0 ? (
        <div className="mt-5 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">执行动作</div>
          {proposal.actions.map((action, index) => (
            <div key={`${proposal.id}-action-${index}`} className="rounded-2xl border border-border/80 bg-background/80 px-4 py-3 text-sm">
              <div className="font-medium">{action.summary || action.type}</div>
              <div className="mt-1 text-xs text-muted-foreground">{action.type}</div>
            </div>
          ))}
        </div>
      ) : null}

      {previewGroups.length > 0 ? (
        <div className="mt-5 space-y-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">变更预览</div>
          {previewGroups.map((group) => (
            <div key={`${proposal.id}-${group.label}`}>
              <div className="mb-2 text-sm font-semibold">{group.label}</div>
              <div className="space-y-2">
                {group.items.map((item, index) => (
                  <div key={`${proposal.id}-${group.label}-${index}`} className="text-sm leading-7 text-muted-foreground">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {proposal.status === 'pending' ? (
        <div className="mt-5 flex justify-end">
          <Button size="sm" onClick={onConfirm} disabled={confirming}>
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
            执行全部
          </Button>
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-2">
          <Badge variant={proposal.status === 'executed' ? 'secondary' : 'outline'}>
            {proposal.status}
          </Badge>
          {proposal.resultSummary ? (
            <span className="text-xs text-muted-foreground">{proposal.resultSummary}</span>
          ) : null}
          {proposal.errorMessage ? (
            <span className="text-xs text-destructive">{proposal.errorMessage}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function CopilotPanel({ project, onProjectRefresh }: CopilotPanelProps) {
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
  const messageViewportRef = useRef<HTMLDivElement | null>(null);

  const enabledSkills = useMemo(() => {
    if (!workspace) return [];
    return workspace.skills.filter((skill) => workspace.settings.enabledSkillIds.includes(skill.id));
  }, [workspace]);

  const starterPrompts = useMemo(() => {
    const prompts = new Set<string>();
    enabledSkills.forEach((skill) => {
      skill.starterPrompts.forEach((prompt) => {
        if (prompts.size < 4) prompts.add(prompt);
      });
    });
    return Array.from(prompts);
  }, [enabledSkills]);

  const selectedSessionSummary = useMemo(() => {
    if (!workspace || !selectedSessionId) return null;
    return workspace.sessions.find((session) => session.id === selectedSessionId) || null;
  }, [workspace, selectedSessionId]);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: 'smooth',
    });
  }, [sessionDetail?.entries.length, streamingAssistantText, selectedSessionId]);

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
    if (!selectedSessionId) return;
    void loadSession(selectedSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

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

  return (
    <aside className="flex h-full min-h-0 w-[420px] max-w-[100vw] flex-col overflow-hidden border-l border-border bg-sidebar/95 backdrop-blur">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Copilot</div>
              <div className="truncate text-xs text-muted-foreground">
                {project ? project.name : '未选择项目'}
              </div>
            </div>
          </div>
          {workspace?.settings.enabled ? (
            <Badge variant="secondary">Enabled</Badge>
          ) : (
            <Badge variant="outline">Disabled</Badge>
          )}
        </div>

        {project ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
              <div>
                <div className="text-base font-semibold">项目级 Agent</div>
                <div className="text-xs text-muted-foreground">多会话、可见轨迹、整批 proposal 确认</div>
              </div>
              <Button
                variant={workspace?.settings.enabled ? 'secondary' : 'default'}
                size="sm"
                onClick={() => void handleToggleEnabled(!workspace?.settings.enabled)}
                disabled={savingSettings || workspaceLoading}
              >
                {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {workspace?.settings.enabled ? '停用' : '启用'}
              </Button>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Skills</div>
              <div className="flex flex-wrap gap-2">
                {workspaceLoading && !workspace ? (
                  <div className="text-xs text-muted-foreground">加载中...</div>
                ) : workspace?.skills.length ? (
                  workspace.skills.map((skill) => {
                    const active = workspace.settings.enabledSkillIds.includes(skill.id);
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => void handleToggleSkill(skill.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                          active
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-border bg-background text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {skill.name}
                      </button>
                    );
                  })
                ) : (
                  <div className="text-xs text-muted-foreground">暂无平台级 skill。</div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={selectedSessionId || ''}
                onValueChange={setSelectedSessionId}
                disabled={!workspace?.sessions.length || sending}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="选择会话" />
                </SelectTrigger>
                <SelectContent>
                  {workspace?.sessions.map((session) => (
                    <SelectItem key={session.id} value={session.id}>
                      {session.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCreateSession()}
                disabled={!workspace?.settings.enabled || creatingSession || sending}
              >
                {creatingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                新会话
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div ref={messageViewportRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          {!project ? (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              选择一个项目后再打开 Copilot。
            </div>
          ) : workspaceLoading && !workspace ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : workspace && !workspace.settings.enabled ? (
            <div className="rounded-2xl border border-dashed border-border p-6">
              <div className="flex items-center gap-3 text-sm font-medium">
                <Bot className="h-4 w-4 text-primary" />
                这个项目的 Copilot 还没启用
              </div>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                启用后，你可以在这里维护多会话创作线程，查看 Agent 轨迹，并对整批 proposal 进行确认执行。
              </p>
            </div>
          ) : !selectedSessionId ? (
            <div className="rounded-2xl border border-dashed border-border p-6">
              <div className="text-sm font-medium">还没有会话</div>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                新建一个会话，让 Copilot 开始接管项目级分析和 proposal 工作流。
              </p>
            </div>
          ) : sessionLoading && !sessionDetail ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              {sessionDetail?.entries.length ? (
                sessionDetail.entries.map((entry, index) => (
                  <div key={`${entry.kind}-${entry.createdAt}-${index}`}>
                    {entry.kind === 'message' ? (
                      <MessageBubble message={entry.message} />
                    ) : (
                      <ProposalCard
                        proposal={entry.proposal}
                        confirming={confirmingProposalId === entry.proposal.id}
                        onConfirm={() => void handleConfirmProposal(entry.proposal.id)}
                      />
                    )}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border p-5">
                  <div className="text-sm font-medium">从一个项目级问题开始</div>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">
                    例如让 Copilot 审查中盘疲软、重构人物成长线，或者为指定章节生成一份整批修改 proposal。
                  </p>
                </div>
              )}

              {(sending || streamingAssistantText) ? (
                <StreamingAssistantBubble content={streamingAssistantText} />
              ) : null}

              {starterPrompts.length > 0 && (!sessionDetail || sessionDetail.entries.length === 0) && !sending ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">建议开场</div>
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void handleSendMessage(prompt)}
                      className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-left text-sm leading-7 transition-colors hover:bg-accent/50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Message</div>
          {selectedSessionId && sessionDetail?.session.title ? (
            <div className="text-xs text-muted-foreground">{sessionDetail.session.title}</div>
          ) : null}
        </div>
        <div className="space-y-3">
          <Textarea
            value={messageInput}
            onChange={(event) => setMessageInput(event.target.value)}
            placeholder="例如：检查目前的中盘结构，并给我一份涉及大纲、人物和第 12 章的整批修正方案。"
            className="min-h-[110px] resize-none bg-background"
            disabled={!workspace?.settings.enabled || sending}
          />
          <div className="flex justify-end">
            <Button
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
  );
}
