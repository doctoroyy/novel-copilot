import { z } from 'zod';
import type { AIConfig } from './aiClient.js';
import { generateTextStreamCollect, generateTextWithRetry } from './aiClient.js';
import { normalizeNovelOutline } from '../utils/outline.js';

export type AgentSkillRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  sourceUrl: string | null;
  instructions: string;
  starterPrompts: string[];
  references: string[];
  toolAllowlist: string[];
  defaultEnabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ProjectCopilotSettings = {
  enabled: boolean;
  enabledSkillIds: string[];
};

export type AgentSessionSummary = {
  id: string;
  title: string;
  enabledSkillIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type AgentMessageRecord = {
  id: string;
  role: 'user' | 'assistant' | 'trace' | 'result' | 'system';
  content: string;
  payload: Record<string, unknown> | null;
  createdAt: number;
};

export type AgentProposalAction = {
  type: 'update_project' | 'replace_outline' | 'update_characters' | 'upsert_chapter' | 'delete_chapter';
  summary: string;
  payload: Record<string, unknown>;
};

export type AgentProposalRecord = {
  id: string;
  sessionId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  goal: string;
  summary: string;
  reasoningSummary: string;
  actions: AgentProposalAction[];
  preview: {
    project: string[];
    outline: string[];
    characters: string[];
    chapters: string[];
  };
  riskLevel: 'low' | 'medium' | 'high';
  status: 'pending' | 'confirmed' | 'executed' | 'failed' | 'rejected';
  resultSummary: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  executedAt: number | null;
};

export type CopilotEntry =
  | { kind: 'message'; message: AgentMessageRecord; createdAt: number }
  | { kind: 'proposal'; proposal: AgentProposalRecord; createdAt: number };

export type AgentSessionDetail = {
  session: AgentSessionSummary;
  entries: CopilotEntry[];
};

export type CopilotStreamEvent =
  | { type: 'message'; message: AgentMessageRecord }
  | { type: 'assistant_delta'; delta: string }
  | { type: 'proposal'; proposal: AgentProposalRecord }
  | { type: 'done'; detail: AgentSessionDetail };

export type ProjectCopilotWorkspace = {
  project: {
    id: string;
    name: string;
  };
  settings: ProjectCopilotSettings;
  skills: AgentSkillRecord[];
  sessions: AgentSessionSummary[];
};

type ProjectIdentity = {
  id: string;
  name: string;
};

type ProjectSnapshot = {
  project: {
    id: string;
    name: string;
    bible: string;
    chapterPromptProfile: string | null;
    chapterPromptCustom: string | null;
    enableAgentMode: boolean;
    background: string | null;
    roleSettings: string | null;
  };
  state: {
    totalChapters: number;
    minChapterWords: number;
    nextChapterIndex: number;
    rollingSummary: string;
    openLoops: string[];
  };
  outline: unknown | null;
  characters: unknown | null;
  chapterIndexes: number[];
  referencedChapters: Array<{
    index: number;
    content: string;
  }>;
};

const BUILTIN_SKILLS: Array<Omit<AgentSkillRecord, 'createdAt' | 'updatedAt'>> = [
  {
    id: 'skill_chinese_novelist',
    slug: 'chinese-novelist',
    name: 'Chinese Novelist',
    description: '面向中文网文连载的项目级创作工作流，强调钩子、冲突升级、人物成长线与可持续量产。',
    sourceUrl: 'https://skills.sh/penglonghuang/chinese-novelist-skill/chinese-novelist',
    instructions: [
      '你是中文网文项目的长期 Copilot，而不是一次性问答助手。',
      '优先关注读者留存、章节钩子、冲突升级、人物成长曲线和卷与卷之间的承接。',
      '当用户要求修改时，要先检查现有设定、大纲、人物关系和相关章节，再给出整批方案。',
      '默认偏向高可读性、高连载稳定性的表达，不追求辞藻堆砌。',
      '如果需要改动多个对象，优先把项目设定、大纲、人物、章节放在一份批量 proposal 里统一确认。',
      '必须主动指出连续性风险、伏笔回收风险和角色动机断裂风险。',
    ].join('\n'),
    starterPrompts: [
      '检查目前的大纲和人物关系，指出最可能造成中盘疲软的地方。',
      '帮我把主角成长线拆成 3 个阶段，并指出每一卷应该承担什么变化。',
      '重做最近 5 章的章节钩子，让读者留存更强，但不要破坏现有世界观。',
      '如果让我接下来稳定日更，请你给出一份项目级修正方案。',
    ],
    references: [
      '长篇中文网文',
      '连载节奏与钩子设计',
      '项目级大纲与人物协同',
    ],
    toolAllowlist: [
      'read.project',
      'read.outline',
      'read.characters',
      'read.chapters',
      'propose.project',
      'propose.outline',
      'propose.characters',
      'propose.chapter',
      'propose.delete_chapter',
    ],
    defaultEnabled: true,
  },
];

const ProposalActionSchema = z.object({
  type: z.enum(['update_project', 'replace_outline', 'update_characters', 'upsert_chapter', 'delete_chapter']),
  summary: z.string().default(''),
  payload: z.record(z.any()).default({}),
});

const PreviewSchema = z.object({
  project: z.array(z.string()).default([]),
  outline: z.array(z.string()).default([]),
  characters: z.array(z.string()).default([]),
  chapters: z.array(z.string()).default([]),
});

const ProposalResponseSchema = z.object({
  reply: z.string().default(''),
  session_title: z.string().optional(),
  reasoning_summary: z.string().default(''),
  risk_level: z.enum(['low', 'medium', 'high']).default('medium'),
  trace: z.array(z.object({
    title: z.string(),
    detail: z.string().default(''),
  })).default([]),
  actions: z.array(ProposalActionSchema).default([]),
  preview: PreviewSchema.default({
    project: [],
    outline: [],
    characters: [],
    chapters: [],
  }),
});

type ProposalResponse = z.infer<typeof ProposalResponseSchema>;

type GeneratedProposalResponse = {
  response: ProposalResponse;
  rawOutput: string;
  usedFallback: boolean;
};

function normalizePreviewGroup(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const items: string[] = [];

  if (typeof record.description === 'string' && record.description.trim()) {
    items.push(record.description.trim());
  }

  if (Array.isArray(record.updated_fields) && record.updated_fields.length > 0) {
    items.push(`涉及字段：${record.updated_fields.map((field) => String(field)).join('、')}`);
  }

  if (items.length > 0) {
    return items;
  }

  return Object.values(record)
    .filter((item) => typeof item === 'string')
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function normalizeTraceItems(value: unknown): ProposalResponse['trace'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const title = typeof record.title === 'string'
        ? record.title.trim()
        : typeof record.name === 'string'
          ? record.name.trim()
          : '';
      const detail = typeof record.detail === 'string'
        ? record.detail.trim()
        : typeof record.description === 'string'
          ? record.description.trim()
          : '';
      if (!title) return null;
      return { title, detail };
    })
    .filter((item): item is ProposalResponse['trace'][number] => Boolean(item));
}

function inferActionType(
  declaredType: unknown,
  payload: Record<string, unknown>
): AgentProposalAction['type'] {
  if (typeof payload.content === 'string' && (payload.chapterIndex != null || payload.insertAfter != null)) {
    return 'upsert_chapter';
  }

  if ('outline' in payload || Array.isArray(payload.volumes) || Array.isArray(payload.chapters)) {
    return 'replace_outline';
  }

  if ('characters' in payload || Array.isArray(payload.characters)) {
    return 'update_characters';
  }

  if (payload.chapterIndex != null && !('content' in payload)) {
    return 'delete_chapter';
  }

  const normalized = typeof declaredType === 'string' ? declaredType.trim() : '';
  switch (normalized) {
    case 'update_project':
    case 'replace_outline':
    case 'update_characters':
    case 'upsert_chapter':
    case 'delete_chapter':
      return normalized;
    default:
      return 'update_project';
  }
}

function normalizeProposalResponse(raw: unknown): ProposalResponse | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const previewRecord = record.preview && typeof record.preview === 'object'
    ? record.preview as Record<string, unknown>
    : {};

  const normalized = {
    reply: typeof record.reply === 'string'
      ? record.reply
      : typeof record.response === 'string'
        ? record.response
        : '',
    session_title: typeof record.session_title === 'string'
      ? record.session_title
      : typeof record.sessionTitle === 'string'
        ? record.sessionTitle
        : undefined,
    reasoning_summary: typeof record.reasoning_summary === 'string'
      ? record.reasoning_summary
      : typeof record.reasoningSummary === 'string'
        ? record.reasoningSummary
        : '',
    risk_level: typeof record.risk_level === 'string'
      ? record.risk_level
      : typeof record.riskLevel === 'string'
        ? record.riskLevel
        : 'medium',
    trace: normalizeTraceItems(record.trace),
    actions: Array.isArray(record.actions)
      ? record.actions.map((action) => {
        if (!action || typeof action !== 'object') {
          return {
            type: 'update_project' as const,
            summary: '',
            payload: {},
          };
        }
        const actionRecord = action as Record<string, unknown>;
        const payload = actionRecord.payload && typeof actionRecord.payload === 'object'
          ? actionRecord.payload as Record<string, unknown>
          : {};
        return {
          type: inferActionType(
            actionRecord.type ?? actionRecord.action_type ?? actionRecord.actionType,
            payload,
          ),
          summary: typeof actionRecord.summary === 'string'
            ? actionRecord.summary
            : typeof actionRecord.title === 'string'
              ? actionRecord.title
              : '',
          payload,
        };
      })
      : [],
    preview: {
      project: normalizePreviewGroup(previewRecord.project),
      outline: normalizePreviewGroup(previewRecord.outline),
      characters: normalizePreviewGroup(previewRecord.characters),
      chapters: normalizePreviewGroup(previewRecord.chapters),
    },
  };

  if (!normalized.reply && normalized.reasoning_summary) {
    normalized.reply = normalized.reasoning_summary;
  }

  const parsed = ProposalResponseSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function deriveSessionTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新会话';
  return normalized.length > 28 ? `${normalized.slice(0, 28)}…` : normalized;
}

function truncateText(text: string | null | undefined, maxLength: number): string {
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...[truncated]` : text;
}

function truncateJson(value: unknown, maxLength: number): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}\n...[truncated]` : serialized;
}

function extractJsonObject(raw: string): string | null {
  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return raw.slice(start, end + 1);
}

function parseChapterMentions(input: string): number[] {
  const matches = Array.from(input.matchAll(/第\s*(\d{1,4})\s*章|chapter\s*(\d{1,4})/gi));
  const numbers = matches
    .map((match) => Number.parseInt(match[1] || match[2], 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  return Array.from(new Set(numbers)).slice(0, 4);
}

function buildPreviewFromActions(actions: AgentProposalAction[]): ProposalResponse['preview'] {
  const preview = {
    project: [] as string[],
    outline: [] as string[],
    characters: [] as string[],
    chapters: [] as string[],
  };

  for (const action of actions) {
    switch (action.type) {
      case 'update_project':
        preview.project.push(action.summary || '更新项目设定');
        break;
      case 'replace_outline':
        preview.outline.push(action.summary || '替换当前大纲');
        break;
      case 'update_characters':
        preview.characters.push(action.summary || '更新人物关系与人物卡');
        break;
      case 'upsert_chapter':
      case 'delete_chapter':
        preview.chapters.push(action.summary || '更新章节内容');
        break;
      default:
        break;
    }
  }

  return preview;
}

async function getTableColumns(db: D1Database, tableName: string): Promise<Set<string>> {
  const { results } = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set((results || []).map((row: any) => String(row.name)));
}

async function getProjectIdentity(
  db: D1Database,
  projectRef: string,
  userId: string
): Promise<ProjectIdentity | null> {
  const row = await db.prepare(`
    SELECT id, name
    FROM projects
    WHERE (id = ? OR name = ?) AND deleted_at IS NULL AND user_id = ?
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at DESC
    LIMIT 1
  `).bind(projectRef, projectRef, userId, projectRef).first();

  if (!row) return null;
  return {
    id: String((row as any).id),
    name: String((row as any).name),
  };
}

async function ensureBuiltInSkills(db: D1Database): Promise<void> {
  for (const skill of BUILTIN_SKILLS) {
    await db.prepare(`
      INSERT INTO agent_skills (
        id,
        slug,
        name,
        description,
        source_url,
        instructions,
        starter_prompts_json,
        references_json,
        tool_allowlist_json,
        default_enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (unixepoch() * 1000), (unixepoch() * 1000))
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        source_url = excluded.source_url,
        instructions = excluded.instructions,
        starter_prompts_json = excluded.starter_prompts_json,
        references_json = excluded.references_json,
        tool_allowlist_json = excluded.tool_allowlist_json,
        default_enabled = excluded.default_enabled,
        updated_at = (unixepoch() * 1000)
    `).bind(
      skill.id,
      skill.slug,
      skill.name,
      skill.description,
      skill.sourceUrl,
      skill.instructions,
      JSON.stringify(skill.starterPrompts),
      JSON.stringify(skill.references),
      JSON.stringify(skill.toolAllowlist),
      skill.defaultEnabled ? 1 : 0,
    ).run();
  }
}

async function listPlatformSkills(db: D1Database): Promise<AgentSkillRecord[]> {
  await ensureBuiltInSkills(db);

  const { results } = await db.prepare(`
    SELECT *
    FROM agent_skills
    WHERE is_active = 1
    ORDER BY default_enabled DESC, name ASC
  `).all();

  return (results || []).map((row: any) => ({
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description || ''),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    instructions: String(row.instructions || ''),
    starterPrompts: parseJson<string[]>(row.starter_prompts_json, []),
    references: parseJson<string[]>(row.references_json, []),
    toolAllowlist: parseJson<string[]>(row.tool_allowlist_json, []),
    defaultEnabled: Boolean(row.default_enabled),
    createdAt: parseNumber(row.created_at),
    updatedAt: parseNumber(row.updated_at),
  }));
}

async function getDefaultEnabledSkillIds(db: D1Database): Promise<string[]> {
  await ensureBuiltInSkills(db);
  const { results } = await db.prepare(`
    SELECT id
    FROM agent_skills
    WHERE is_active = 1 AND default_enabled = 1
    ORDER BY name ASC
  `).all();
  return (results || []).map((row: any) => String(row.id));
}

async function getOrCreateProjectSettings(
  db: D1Database,
  projectId: string
): Promise<ProjectCopilotSettings> {
  const row = await db.prepare(`
    SELECT enabled, enabled_skill_ids_json
    FROM project_agent_settings
    WHERE project_id = ?
  `).bind(projectId).first();

  if (row) {
    return {
      enabled: Boolean((row as any).enabled),
      enabledSkillIds: parseJson<string[]>((row as any).enabled_skill_ids_json, []),
    };
  }

  const defaultSkillIds = await getDefaultEnabledSkillIds(db);
  await db.prepare(`
    INSERT INTO project_agent_settings (
      project_id,
      enabled,
      enabled_skill_ids_json,
      created_at,
      updated_at
    ) VALUES (?, 0, ?, (unixepoch() * 1000), (unixepoch() * 1000))
  `).bind(projectId, JSON.stringify(defaultSkillIds)).run();

  return {
    enabled: false,
    enabledSkillIds: defaultSkillIds,
  };
}

async function listSessions(
  db: D1Database,
  projectId: string,
  userId: string
): Promise<AgentSessionSummary[]> {
  const { results } = await db.prepare(`
    SELECT id, title, enabled_skill_ids_json, created_at, updated_at
    FROM agent_sessions
    WHERE project_id = ? AND user_id = ? AND archived_at IS NULL
    ORDER BY updated_at DESC, created_at DESC
  `).bind(projectId, userId).all();

  return (results || []).map((row: any) => ({
    id: String(row.id),
    title: String(row.title || '新会话'),
    enabledSkillIds: parseJson<string[]>(row.enabled_skill_ids_json, []),
    createdAt: parseNumber(row.created_at),
    updatedAt: parseNumber(row.updated_at),
  }));
}

async function getSessionRow(
  db: D1Database,
  sessionId: string,
  userId: string
): Promise<{
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  enabledSkillIds: string[];
  createdAt: number;
  updatedAt: number;
} | null> {
  const row = await db.prepare(`
    SELECT s.id, s.title, s.project_id, s.enabled_skill_ids_json, s.created_at, s.updated_at, p.name AS project_name
    FROM agent_sessions s
    JOIN projects p ON p.id = s.project_id
    WHERE s.id = ? AND s.user_id = ? AND s.archived_at IS NULL AND p.deleted_at IS NULL
    LIMIT 1
  `).bind(sessionId, userId).first();

  if (!row) return null;
  return {
    id: String((row as any).id),
    title: String((row as any).title || '新会话'),
    projectId: String((row as any).project_id),
    projectName: String((row as any).project_name),
    enabledSkillIds: parseJson<string[]>((row as any).enabled_skill_ids_json, []),
    createdAt: parseNumber((row as any).created_at),
    updatedAt: parseNumber((row as any).updated_at),
  };
}

async function touchSession(db: D1Database, sessionId: string, title?: string): Promise<void> {
  if (title) {
    await db.prepare(`
      UPDATE agent_sessions
      SET title = ?, updated_at = (unixepoch() * 1000)
      WHERE id = ?
    `).bind(title, sessionId).run();
    return;
  }

  await db.prepare(`
    UPDATE agent_sessions
    SET updated_at = (unixepoch() * 1000)
    WHERE id = ?
  `).bind(sessionId).run();
}

async function insertMessage(
  db: D1Database,
  sessionId: string,
  role: AgentMessageRecord['role'],
  content: string,
  payload?: Record<string, unknown> | null
): Promise<AgentMessageRecord> {
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await db.prepare(`
    INSERT INTO agent_messages (
      id,
      session_id,
      role,
      content,
      payload_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    sessionId,
    role,
    content,
    payload ? JSON.stringify(payload) : null,
    createdAt,
  ).run();

  return {
    id,
    role,
    content,
    payload: payload || null,
    createdAt,
  };
}

async function insertProposalRecord(
  db: D1Database,
  sessionId: string,
  userMessageId: string | null,
  assistantMessageId: string | null,
  goal: string,
  summary: string,
  response: ProposalResponse
): Promise<AgentProposalRecord> {
  const id = crypto.randomUUID();
  const createdAt = Date.now();

  await db.prepare(`
    INSERT INTO agent_proposals (
      id,
      session_id,
      user_message_id,
      assistant_message_id,
      goal,
      summary,
      reasoning_summary,
      actions_json,
      preview_json,
      risk_level,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    id,
    sessionId,
    userMessageId,
    assistantMessageId,
    goal,
    summary,
    response.reasoning_summary,
    JSON.stringify(response.actions),
    JSON.stringify(response.preview),
    response.risk_level,
    createdAt,
    createdAt,
  ).run();

  return {
    id,
    sessionId,
    userMessageId,
    assistantMessageId,
    goal,
    summary,
    reasoningSummary: response.reasoning_summary,
    actions: response.actions,
    preview: response.preview,
    riskLevel: response.risk_level,
    status: 'pending',
    resultSummary: null,
    errorMessage: null,
    createdAt,
    updatedAt: createdAt,
    executedAt: null,
  };
}

async function loadMessages(db: D1Database, sessionId: string): Promise<AgentMessageRecord[]> {
  const { results } = await db.prepare(`
    SELECT id, role, content, payload_json, created_at
    FROM agent_messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).bind(sessionId).all();

  return (results || []).map((row: any) => ({
    id: String(row.id),
    role: row.role as AgentMessageRecord['role'],
    content: String(row.content || ''),
    payload: row.payload_json ? parseJson<Record<string, unknown>>(row.payload_json, {}) : null,
    createdAt: parseNumber(row.created_at),
  }));
}

async function loadProposals(db: D1Database, sessionId: string): Promise<AgentProposalRecord[]> {
  const { results } = await db.prepare(`
    SELECT *
    FROM agent_proposals
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).bind(sessionId).all();

  return (results || []).map((row: any) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    userMessageId: row.user_message_id ? String(row.user_message_id) : null,
    assistantMessageId: row.assistant_message_id ? String(row.assistant_message_id) : null,
    goal: String(row.goal || ''),
    summary: String(row.summary || ''),
    reasoningSummary: String(row.reasoning_summary || ''),
    actions: parseJson<AgentProposalAction[]>(row.actions_json, []),
    preview: parseJson<AgentProposalRecord['preview']>(row.preview_json, {
      project: [],
      outline: [],
      characters: [],
      chapters: [],
    }),
    riskLevel: (row.risk_level || 'medium') as AgentProposalRecord['riskLevel'],
    status: (row.status || 'pending') as AgentProposalRecord['status'],
    resultSummary: row.result_summary ? String(row.result_summary) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: parseNumber(row.created_at),
    updatedAt: parseNumber(row.updated_at),
    executedAt: row.executed_at == null ? null : parseNumber(row.executed_at),
  }));
}

async function loadSessionEntries(db: D1Database, sessionId: string): Promise<CopilotEntry[]> {
  const [messages, proposals] = await Promise.all([
    loadMessages(db, sessionId),
    loadProposals(db, sessionId),
  ]);

  return [
    ...messages.map((message) => ({
      kind: 'message' as const,
      message,
      createdAt: message.createdAt,
    })),
    ...proposals.map((proposal) => ({
      kind: 'proposal' as const,
      proposal,
      createdAt: proposal.createdAt,
    })),
  ].sort((a, b) => a.createdAt - b.createdAt);
}

async function buildProjectSnapshot(
  db: D1Database,
  project: ProjectIdentity,
  userPrompt: string
): Promise<ProjectSnapshot> {
  const projectColumns = await getTableColumns(db, 'projects');
  const selectColumns = [
    'p.id',
    'p.name',
    'p.bible',
    projectColumns.has('chapter_prompt_profile') ? 'p.chapter_prompt_profile' : 'NULL AS chapter_prompt_profile',
    projectColumns.has('chapter_prompt_custom') ? 'p.chapter_prompt_custom' : 'NULL AS chapter_prompt_custom',
    projectColumns.has('enable_agent_mode') ? 'p.enable_agent_mode' : '0 AS enable_agent_mode',
    projectColumns.has('background') ? 'p.background' : 'NULL AS background',
    projectColumns.has('role_settings') ? 'p.role_settings' : 'NULL AS role_settings',
    's.total_chapters',
    's.min_chapter_words',
    's.next_chapter_index',
    's.rolling_summary',
    's.open_loops',
    'o.outline_json',
    'c.characters_json',
  ];

  const row = await db.prepare(`
    SELECT ${selectColumns.join(', ')}
    FROM projects p
    LEFT JOIN states s ON s.project_id = p.id
    LEFT JOIN outlines o ON o.project_id = p.id
    LEFT JOIN characters c ON c.project_id = p.id
    WHERE p.id = ?
    LIMIT 1
  `).bind(project.id).first();

  if (!row) {
    throw new Error('Project not found');
  }

  const { results: chapterIndexRows } = await db.prepare(`
    SELECT chapter_index
    FROM chapters
    WHERE project_id = ? AND deleted_at IS NULL
    ORDER BY chapter_index ASC
  `).bind(project.id).all();

  const chapterIndexes = (chapterIndexRows || []).map((chapter: any) => parseNumber(chapter.chapter_index)).filter(Boolean);
  const mentionedIndexes = parseChapterMentions(userPrompt);

  let chapterRows: any[] = [];
  if (mentionedIndexes.length > 0) {
    const placeholders = mentionedIndexes.map(() => '?').join(', ');
    const response = await db.prepare(`
      SELECT chapter_index, content
      FROM chapters
      WHERE project_id = ? AND deleted_at IS NULL AND chapter_index IN (${placeholders})
      ORDER BY chapter_index ASC
    `).bind(project.id, ...mentionedIndexes).all();
    chapterRows = response.results || [];
  } else {
    const response = await db.prepare(`
      SELECT chapter_index, content
      FROM chapters
      WHERE project_id = ? AND deleted_at IS NULL
      ORDER BY chapter_index DESC
      LIMIT 3
    `).bind(project.id).all();
    chapterRows = (response.results || []).reverse();
  }

  const state = {
    totalChapters: parseNumber((row as any).total_chapters, 0),
    minChapterWords: parseNumber((row as any).min_chapter_words, 0),
    nextChapterIndex: parseNumber((row as any).next_chapter_index, 1),
    rollingSummary: String((row as any).rolling_summary || ''),
    openLoops: parseJson<string[]>((row as any).open_loops, []),
  };
  const outline = (row as any).outline_json
    ? normalizeNovelOutline(parseJson<unknown>((row as any).outline_json, null), {
      fallbackMinChapterWords: state.minChapterWords,
      fallbackTotalChapters: state.totalChapters,
    })
    : null;

  return {
    project: {
      id: String((row as any).id),
      name: String((row as any).name),
      bible: String((row as any).bible || ''),
      chapterPromptProfile: (row as any).chapter_prompt_profile ? String((row as any).chapter_prompt_profile) : null,
      chapterPromptCustom: (row as any).chapter_prompt_custom ? String((row as any).chapter_prompt_custom) : null,
      enableAgentMode: Boolean((row as any).enable_agent_mode),
      background: (row as any).background ? String((row as any).background) : null,
      roleSettings: (row as any).role_settings ? String((row as any).role_settings) : null,
    },
    state,
    outline,
    characters: (row as any).characters_json ? parseJson<unknown>((row as any).characters_json, null) : null,
    chapterIndexes,
    referencedChapters: chapterRows.map((chapter: any) => ({
      index: parseNumber(chapter.chapter_index),
      content: truncateText(String(chapter.content || ''), 4000),
    })),
  };
}

function buildConversationSummary(messages: AgentMessageRecord[]): string {
  const relevant = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'result')
    .slice(-8)
    .map((message) => `${message.role.toUpperCase()}: ${truncateText(message.content, 1200)}`);
  return relevant.join('\n\n');
}

function buildSkillSection(skills: AgentSkillRecord[]): string {
  return skills.length > 0
    ? skills.map((skill) => {
      const prompts = skill.starterPrompts.map((prompt) => `- ${prompt}`).join('\n');
      return [
        `【Skill: ${skill.name}】`,
        skill.description,
        skill.instructions,
        skill.toolAllowlist.length > 0 ? `允许工具: ${skill.toolAllowlist.join(', ')}` : '',
        prompts ? `推荐入口:\n${prompts}` : '',
      ].filter(Boolean).join('\n');
    }).join('\n\n')
    : '（当前未启用任何 skill，请按通用中文小说项目 Copilot 工作。）';
}

function buildSystemPrompt(skills: AgentSkillRecord[]): string {
  const skillSection = buildSkillSection(skills);

  return [
    '你是 Novel Copilot 的项目级 Agent，工作于一个中文小说项目的右侧 Copilot 侧栏。',
    '你要先读取项目快照，再给出结构化建议；如果需要改动，输出一份整批 proposal，等待用户确认后执行。',
    '你绝不能声称已经执行变更，也不能假装数据库已更新。',
    '如果用户只是想讨论、诊断、分析、提问，可以 actions 为空。',
    '如果要修改项目，请优先组合成一份完整 proposal；同一轮里尽量避免拆成多份 proposal。',
    '输出必须是严格 JSON，不要附带 Markdown 代码块之外的解释。',
    '支持的 action type 只有以下几种：',
    '- update_project: payload 可包含 bible, chapter_prompt_profile, chapter_prompt_custom, enable_agent_mode, background, role_settings, minChapterWords。',
    '- replace_outline: payload 必须包含 outline 对象；如果要改大纲，请给出完整可落地的大纲结构。',
    '- update_characters: payload 必须包含 characters 对象。',
    '- upsert_chapter: payload 必须包含 chapterIndex 和 content；章节不存在时可创建，存在时覆盖。',
    '- delete_chapter: payload 必须包含 chapterIndex。',
    '你必须同时输出 preview，把影响分到 project / outline / characters / chapters 四个分组中。',
    '风险高时把 risk_level 设为 high，并在 reasoning_summary 里明确指出原因。',
    '',
    '已启用的 skills:',
    skillSection,
  ].join('\n');
}

function buildStreamingAnalysisSystemPrompt(skills: AgentSkillRecord[]): string {
  return [
    '你是 Novel Copilot 的项目级 Agent，工作于一个中文小说项目的右侧 Copilot 侧栏。',
    '现在请先给用户一段自然语言的实时分析回复，像真正的 Copilot 一样边分析边同步。',
    '只输出给用户看的中文自然语言，不要输出 JSON，不要输出 Markdown 代码块。',
    '你不能声称已经执行写入，也不能伪造数据库结果。',
    '如果后续可能形成批量 proposal，请在这段回复里先解释你发现了什么、准备怎么改、风险在哪。',
    '语言要直接、具体、专业，不要寒暄。',
    '',
    '已启用的 skills:',
    buildSkillSection(skills),
  ].join('\n');
}

function buildUserPrompt(
  projectSnapshot: ProjectSnapshot,
  messages: AgentMessageRecord[],
  skills: AgentSkillRecord[],
  userPrompt: string
): string {
  return [
    '【当前用户请求】',
    userPrompt,
    '',
    '【最近会话】',
    buildConversationSummary(messages) || '（无历史消息）',
    '',
    '【项目快照】',
    `项目名: ${projectSnapshot.project.name}`,
    `总章数: ${projectSnapshot.state.totalChapters}`,
    `下一章: ${projectSnapshot.state.nextChapterIndex}`,
    `每章最少字数: ${projectSnapshot.state.minChapterWords}`,
    `启用 ReAct 写作: ${projectSnapshot.project.enableAgentMode ? '是' : '否'}`,
    '',
    '【Bible】',
    truncateText(projectSnapshot.project.bible, 8000),
    projectSnapshot.project.background ? `\n【背景补充】\n${truncateText(projectSnapshot.project.background, 3000)}` : '',
    projectSnapshot.project.roleSettings ? `\n【角色设定补充】\n${truncateText(projectSnapshot.project.roleSettings, 3000)}` : '',
    projectSnapshot.project.chapterPromptCustom ? `\n【正文附加提示】\n${truncateText(projectSnapshot.project.chapterPromptCustom, 2000)}` : '',
    '',
    '【滚动摘要】',
    truncateText(projectSnapshot.state.rollingSummary, 5000),
    '',
    `【未解伏笔】\n${truncateJson(projectSnapshot.state.openLoops, 3000)}`,
    '',
    `【现有章节索引】\n${projectSnapshot.chapterIndexes.join(', ') || '（暂无）'}`,
    '',
    `【大纲】\n${projectSnapshot.outline ? truncateJson(projectSnapshot.outline, 18000) : '（暂无大纲）'}`,
    '',
    `【人物】\n${projectSnapshot.characters ? truncateJson(projectSnapshot.characters, 12000) : '（暂无人物关系图）'}`,
    '',
    '【相关章节】',
    projectSnapshot.referencedChapters.length > 0
      ? projectSnapshot.referencedChapters.map((chapter) => `第 ${chapter.index} 章\n${chapter.content}`).join('\n\n')
      : '（暂无章节内容）',
    '',
    '【启用的 skills】',
    skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n') || '（无）',
    '',
    '请严格按照 JSON 合约回复。',
  ].filter(Boolean).join('\n');
}

function buildStreamingAnalysisUserPrompt(
  projectSnapshot: ProjectSnapshot,
  messages: AgentMessageRecord[],
  skills: AgentSkillRecord[],
  userPrompt: string
): string {
  return buildUserPrompt(projectSnapshot, messages, skills, userPrompt)
    .replace('请严格按照 JSON 合约回复。', '请直接给用户输出自然语言分析，不要输出 JSON。');
}

async function repairProposalResponse(
  aiConfig: AIConfig,
  rawResponse: string
): Promise<ProposalResponse | null> {
  const repaired = await generateTextWithRetry(aiConfig, {
    system: [
      '你是 JSON 修复器。',
      '把用户提供的 Agent 输出修复为严格合法的 JSON。',
      '不要添加 Markdown 代码块，不要解释，只返回一个 JSON 对象。',
      '顶层字段必须只包含：reply, session_title, reasoning_summary, risk_level, trace, actions, preview。',
      'actions 中每项字段必须是：type, summary, payload。',
      'preview 必须是：project, outline, characters, chapters，且每个字段都是字符串数组。',
      '允许的 action.type 只有：update_project, replace_outline, update_characters, upsert_chapter, delete_chapter。',
      '尽量保留原始语义，不要凭空扩展原文没有的信息。',
    ].join('\n'),
    prompt: [
      '请修复下面这段 Agent 输出，使其成为可直接 JSON.parse 的合法 JSON：',
      rawResponse,
    ].join('\n\n'),
    temperature: 0,
    maxTokens: 3600,
  }, 1);

  const extracted = extractJsonObject(repaired);
  if (!extracted) {
    return null;
  }

  try {
    return normalizeProposalResponse(JSON.parse(extracted));
  } catch {
    return null;
  }
}

async function generateProposalResponse(
  aiConfig: AIConfig,
  projectSnapshot: ProjectSnapshot,
  messages: AgentMessageRecord[],
  skills: AgentSkillRecord[],
  userPrompt: string
): Promise<GeneratedProposalResponse> {
  const raw = await generateTextWithRetry(aiConfig, {
    system: buildSystemPrompt(skills),
    prompt: buildUserPrompt(projectSnapshot, messages, skills, userPrompt),
    temperature: 0.35,
    maxTokens: 3600,
  }, 2);

  const trimmedRaw = raw.trim();
  const createFallback = (reason: string): GeneratedProposalResponse => ({
    response: {
      reply: '本轮分析已完成，但结构化提案输出异常，原始结果已收起。你可以继续追问、重试，或展开调试原文查看。',
      reasoning_summary: reason,
      risk_level: 'medium',
      trace: [],
      actions: [],
      preview: {
        project: [],
        outline: [],
        characters: [],
        chapters: [],
      },
    },
    rawOutput: trimmedRaw,
    usedFallback: true,
  });

  const extractedJson = extractJsonObject(raw);
  if (!extractedJson) {
    const repaired = await repairProposalResponse(aiConfig, raw);
    if (repaired) {
      return {
        response: repaired,
        rawOutput: trimmedRaw,
        usedFallback: false,
      };
    }

    return createFallback('模型未返回结构化 proposal，原始输出已收起。');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extractedJson);
  } catch {
    const repaired = await repairProposalResponse(aiConfig, raw);
    if (repaired) {
      return {
        response: repaired,
        rawOutput: trimmedRaw,
        usedFallback: false,
      };
    }

    return createFallback('模型输出不是合法 JSON，原始输出已收起。');
  }

  const normalized = normalizeProposalResponse(parsedJson);
  if (!normalized) {
    const repaired = await repairProposalResponse(aiConfig, raw);
    if (repaired) {
      return {
        response: repaired,
        rawOutput: trimmedRaw,
        usedFallback: false,
      };
    }

    return createFallback('模型输出未通过结构校验，原始输出已收起。');
  }

  const preview = (
    normalized.preview.project.length
    || normalized.preview.outline.length
    || normalized.preview.characters.length
    || normalized.preview.chapters.length
  )
    ? normalized.preview
    : buildPreviewFromActions(normalized.actions as AgentProposalAction[]);

  return {
    response: {
      ...normalized,
      preview,
    },
    rawOutput: trimmedRaw,
    usedFallback: false,
  };
}

function requireInteger(value: unknown, fieldName: string): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} 必须是正整数`);
  }
  return parsed;
}

async function recalculateNextChapterIndex(db: D1Database, projectId: string): Promise<void> {
  const row = await db.prepare(`
    SELECT MAX(chapter_index) AS max_index
    FROM chapters
    WHERE project_id = ? AND deleted_at IS NULL
  `).bind(projectId).first();

  const nextChapterIndex = parseNumber((row as any)?.max_index, 0) + 1;
  await db.prepare(`
    UPDATE states
    SET next_chapter_index = ?
    WHERE project_id = ?
  `).bind(nextChapterIndex, projectId).run();
}

async function executeUpdateProject(
  db: D1Database,
  projectId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const projectColumns = await getTableColumns(db, 'projects');
  const updates: string[] = [];
  const values: unknown[] = [];
  const fieldMap: Array<[string, string, (value: unknown) => unknown]> = [
    ['bible', 'bible', (value) => String(value)],
    ['background', 'background', (value) => String(value)],
    ['role_settings', 'role_settings', (value) => String(value)],
    ['chapter_prompt_profile', 'chapter_prompt_profile', (value) => String(value)],
    ['chapter_prompt_custom', 'chapter_prompt_custom', (value) => String(value)],
    ['enable_agent_mode', 'enable_agent_mode', (value) => (value ? 1 : 0)],
  ];
  const touchedFields: string[] = [];

  for (const [payloadKey, columnName, transform] of fieldMap) {
    if (!(payloadKey in payload) || !projectColumns.has(columnName)) continue;
    updates.push(`${columnName} = ?`);
    values.push(transform(payload[payloadKey]));
    touchedFields.push(payloadKey);
  }

  if (updates.length > 0) {
    await db.prepare(`
      UPDATE projects
      SET ${updates.join(', ')}
      WHERE id = ?
    `).bind(...values, projectId).run();
  }

  if ('minChapterWords' in payload) {
    const minChapterWords = requireInteger(payload.minChapterWords, 'minChapterWords');
    await db.prepare(`
      UPDATE states
      SET min_chapter_words = ?
      WHERE project_id = ?
    `).bind(minChapterWords, projectId).run();
    touchedFields.push('minChapterWords');
  }

  if (touchedFields.length === 0) {
    return '未执行项目设定更新（无可用字段）';
  }

  return `已更新项目设定字段：${touchedFields.join(', ')}`;
}

async function executeReplaceOutline(
  db: D1Database,
  projectId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const outlinePayload = payload.outline ?? payload;
  if (!outlinePayload || typeof outlinePayload !== 'object') {
    throw new Error('replace_outline 缺少 outline 对象');
  }

  const stateRow = await db.prepare(`
    SELECT total_chapters, min_chapter_words
    FROM states
    WHERE project_id = ?
    LIMIT 1
  `).bind(projectId).first();

  const outline = normalizeNovelOutline(outlinePayload, {
    fallbackMinChapterWords: (stateRow as any)?.min_chapter_words,
    fallbackTotalChapters: (stateRow as any)?.total_chapters,
  });
  if (!outline) {
    throw new Error('replace_outline 的 outline 结构无效');
  }

  await db.prepare(`
    INSERT INTO outlines (project_id, outline_json)
    VALUES (?, ?)
    ON CONFLICT(project_id) DO UPDATE SET outline_json = excluded.outline_json
  `).bind(projectId, JSON.stringify(outline)).run();

  const totalChapters = Number(outline.totalChapters);
  if (Number.isFinite(totalChapters) && totalChapters > 0) {
    await db.prepare(`
      UPDATE states
      SET total_chapters = ?
      WHERE project_id = ?
    `).bind(totalChapters, projectId).run();
  }

  return '已替换项目大纲';
}

async function executeUpdateCharacters(
  db: D1Database,
  projectId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const characters = payload.characters ?? payload;
  if (!characters || typeof characters !== 'object') {
    throw new Error('update_characters 缺少 characters 对象');
  }

  await db.prepare(`
    INSERT INTO characters (project_id, characters_json)
    VALUES (?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      characters_json = excluded.characters_json,
      updated_at = (unixepoch() * 1000)
  `).bind(projectId, JSON.stringify(characters)).run();

  return '已更新人物关系与人物卡';
}

async function executeUpsertChapter(
  db: D1Database,
  projectId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const content = typeof payload.content === 'string' ? payload.content.trim() : '';
  if (!content) {
    throw new Error('upsert_chapter 缺少 content');
  }

  const chapterIndex = payload.chapterIndex != null
    ? requireInteger(payload.chapterIndex, 'chapterIndex')
    : payload.insertAfter != null
      ? requireInteger(payload.insertAfter, 'insertAfter') + 1
      : null;

  let resolvedIndex = chapterIndex;
  if (resolvedIndex == null) {
    const row = await db.prepare(`
      SELECT next_chapter_index
      FROM states
      WHERE project_id = ?
    `).bind(projectId).first();
    resolvedIndex = parseNumber((row as any)?.next_chapter_index, 1);
  }

  const existing = await db.prepare(`
    SELECT id
    FROM chapters
    WHERE project_id = ? AND chapter_index = ?
    LIMIT 1
  `).bind(projectId, resolvedIndex).first();

  if (existing) {
    await db.prepare(`
      UPDATE chapters
      SET content = ?, deleted_at = NULL
      WHERE id = ?
    `).bind(content, (existing as any).id).run();
  } else {
    await db.prepare(`
      INSERT INTO chapters (project_id, chapter_index, content)
      VALUES (?, ?, ?)
    `).bind(projectId, resolvedIndex, content).run();
  }

  await recalculateNextChapterIndex(db, projectId);
  return `已写入第 ${resolvedIndex} 章`;
}

async function executeDeleteChapter(
  db: D1Database,
  projectId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const chapterIndex = requireInteger(payload.chapterIndex, 'chapterIndex');
  await db.prepare(`
    UPDATE chapters
    SET deleted_at = (unixepoch() * 1000)
    WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
  `).bind(projectId, chapterIndex).run();

  await recalculateNextChapterIndex(db, projectId);
  return `已删除第 ${chapterIndex} 章`;
}

async function executeProposalAction(
  db: D1Database,
  projectId: string,
  action: AgentProposalAction
): Promise<string> {
  switch (action.type) {
    case 'update_project':
      return executeUpdateProject(db, projectId, action.payload);
    case 'replace_outline':
      return executeReplaceOutline(db, projectId, action.payload);
    case 'update_characters':
      return executeUpdateCharacters(db, projectId, action.payload);
    case 'upsert_chapter':
      return executeUpsertChapter(db, projectId, action.payload);
    case 'delete_chapter':
      return executeDeleteChapter(db, projectId, action.payload);
    default:
      throw new Error(`不支持的 action type: ${String((action as any).type)}`);
  }
}

export async function getCopilotWorkspace(
  db: D1Database,
  projectRef: string,
  userId: string
): Promise<ProjectCopilotWorkspace> {
  const project = await getProjectIdentity(db, projectRef, userId);
  if (!project) {
    throw new Error('Project not found');
  }

  const [skills, settings, sessions] = await Promise.all([
    listPlatformSkills(db),
    getOrCreateProjectSettings(db, project.id),
    listSessions(db, project.id, userId),
  ]);

  return {
    project,
    settings,
    skills,
    sessions,
  };
}

export async function updateCopilotSettings(
  db: D1Database,
  projectRef: string,
  userId: string,
  updates: Partial<ProjectCopilotSettings>
): Promise<ProjectCopilotSettings> {
  const project = await getProjectIdentity(db, projectRef, userId);
  if (!project) {
    throw new Error('Project not found');
  }

  const current = await getOrCreateProjectSettings(db, project.id);
  const nextSettings: ProjectCopilotSettings = {
    enabled: updates.enabled ?? current.enabled,
    enabledSkillIds: updates.enabledSkillIds ?? current.enabledSkillIds,
  };

  await db.prepare(`
    INSERT INTO project_agent_settings (
      project_id,
      enabled,
      enabled_skill_ids_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, (unixepoch() * 1000), (unixepoch() * 1000))
    ON CONFLICT(project_id) DO UPDATE SET
      enabled = excluded.enabled,
      enabled_skill_ids_json = excluded.enabled_skill_ids_json,
      updated_at = (unixepoch() * 1000)
  `).bind(
    project.id,
    nextSettings.enabled ? 1 : 0,
    JSON.stringify(nextSettings.enabledSkillIds),
  ).run();

  return nextSettings;
}

export async function createCopilotSession(
  db: D1Database,
  projectRef: string,
  userId: string,
  requestedTitle?: string
): Promise<AgentSessionSummary> {
  const project = await getProjectIdentity(db, projectRef, userId);
  if (!project) {
    throw new Error('Project not found');
  }

  const settings = await getOrCreateProjectSettings(db, project.id);
  const id = crypto.randomUUID();
  const title = requestedTitle?.trim() || '新会话';
  const createdAt = Date.now();

  await db.prepare(`
    INSERT INTO agent_sessions (
      id,
      project_id,
      user_id,
      title,
      enabled_skill_ids_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    project.id,
    userId,
    title,
    JSON.stringify(settings.enabledSkillIds),
    createdAt,
    createdAt,
  ).run();

  return {
    id,
    title,
    enabledSkillIds: settings.enabledSkillIds,
    createdAt,
    updatedAt: createdAt,
  };
}

export async function getCopilotSessionDetail(
  db: D1Database,
  sessionId: string,
  userId: string
): Promise<AgentSessionDetail> {
  const session = await getSessionRow(db, sessionId, userId);
  if (!session) {
    throw new Error('Session not found');
  }

  const entries = await loadSessionEntries(db, session.id);
  return {
    session: {
      id: session.id,
      title: session.title,
      enabledSkillIds: session.enabledSkillIds,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    entries,
  };
}

export async function sendCopilotMessage(params: {
  db: D1Database;
  sessionId: string;
  userId: string;
  content: string;
  aiConfig?: AIConfig;
}): Promise<AgentSessionDetail> {
  const { db, sessionId, userId, content, aiConfig } = params;
  const session = await getSessionRow(db, sessionId, userId);
  if (!session) {
    throw new Error('Session not found');
  }

  const settings = await getOrCreateProjectSettings(db, session.projectId);
  if (!settings.enabled) {
    throw new Error('Copilot is disabled for this project');
  }

  const [platformSkills, existingMessages, projectSnapshot] = await Promise.all([
    listPlatformSkills(db),
    loadMessages(db, session.id),
    buildProjectSnapshot(db, { id: session.projectId, name: session.projectName }, content),
  ]);
  const enabledSkills = platformSkills.filter((skill) => session.enabledSkillIds.includes(skill.id));
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    throw new Error('Message content is required');
  }

  const userMessage = await insertMessage(db, session.id, 'user', trimmedContent);
  await insertMessage(db, session.id, 'trace', '读取项目快照', {
    title: '读取项目快照',
    detail: `已装载 ${session.projectName} 的设定、大纲、人物和相关章节。`,
  });
  await insertMessage(db, session.id, 'trace', '装载启用 skills', {
    title: '装载启用 skills',
    detail: enabledSkills.length > 0
      ? `本轮启用了 ${enabledSkills.map((skill) => skill.name).join('、')}`
      : '本轮未启用任何额外 skill，按通用项目 Copilot 策略执行。',
  });

  const generated = await generateProposalResponse(
    aiConfig as AIConfig,
    projectSnapshot,
    [...existingMessages, userMessage],
    enabledSkills,
    trimmedContent,
  );
  const response = generated.response;

  for (const trace of response.trace.slice(0, 6)) {
    await insertMessage(db, session.id, 'trace', trace.title, {
      title: trace.title,
      detail: trace.detail,
    });
  }

  const assistantContent = response.reply.trim() || '已完成本轮分析，但没有生成额外答复。';
  const assistantMessage = await insertMessage(db, session.id, 'assistant', assistantContent, {
    reasoningSummary: response.reasoning_summary,
    displayMode: generated.usedFallback ? 'fallback' : 'markdown',
    ...(generated.usedFallback && generated.rawOutput
      ? { debugRawOutput: generated.rawOutput }
      : {}),
  });

  if (session.title === '新会话') {
    await touchSession(db, session.id, response.session_title?.trim() || deriveSessionTitle(trimmedContent));
  } else {
    await touchSession(db, session.id);
  }

  if (response.actions.length > 0) {
    await insertProposalRecord(
      db,
      session.id,
      userMessage.id,
      assistantMessage.id,
      trimmedContent,
      assistantContent,
      response,
    );
  }

  return getCopilotSessionDetail(db, session.id, userId);
}

export async function streamCopilotMessage(params: {
  db: D1Database;
  sessionId: string;
  userId: string;
  content: string;
  aiConfig: AIConfig;
  emit: (event: CopilotStreamEvent) => Promise<void> | void;
}): Promise<AgentSessionDetail> {
  const {
    db,
    sessionId,
    userId,
    content,
    aiConfig,
    emit,
  } = params;

  const session = await getSessionRow(db, sessionId, userId);
  if (!session) {
    throw new Error('Session not found');
  }

  const settings = await getOrCreateProjectSettings(db, session.projectId);
  if (!settings.enabled) {
    throw new Error('Copilot is disabled for this project');
  }

  const trimmedContent = content.trim();
  if (!trimmedContent) {
    throw new Error('Message content is required');
  }

  const [platformSkills, existingMessages, projectSnapshot] = await Promise.all([
    listPlatformSkills(db),
    loadMessages(db, session.id),
    buildProjectSnapshot(db, { id: session.projectId, name: session.projectName }, trimmedContent),
  ]);
  const enabledSkills = platformSkills.filter((skill) => session.enabledSkillIds.includes(skill.id));

  const userMessage = await insertMessage(db, session.id, 'user', trimmedContent);
  await emit({ type: 'message', message: userMessage });

  const traceMessages = [
    await insertMessage(db, session.id, 'trace', '读取项目快照', {
      title: '读取项目快照',
      detail: `已装载 ${session.projectName} 的设定、大纲、人物和相关章节。`,
    }),
    await insertMessage(db, session.id, 'trace', '装载启用 skills', {
      title: '装载启用 skills',
      detail: enabledSkills.length > 0
        ? `本轮启用了 ${enabledSkills.map((skill) => skill.name).join('、')}`
        : '本轮未启用任何额外 skill，按通用项目 Copilot 策略执行。',
    }),
  ];

  for (const traceMessage of traceMessages) {
    await emit({ type: 'message', message: traceMessage });
  }

  let streamedAssistantContent = '';
  try {
    streamedAssistantContent = await generateTextStreamCollect(aiConfig, {
      system: buildStreamingAnalysisSystemPrompt(enabledSkills),
      prompt: buildStreamingAnalysisUserPrompt(projectSnapshot, [...existingMessages, userMessage], enabledSkills, trimmedContent),
      temperature: 0.4,
      maxTokens: 1200,
    }, async (chunk) => {
      if (!chunk) return;
      await emit({ type: 'assistant_delta', delta: chunk });
    });
  } catch (error) {
    const fallbackTrace = await insertMessage(db, session.id, 'trace', '实时分析降级', {
      title: '实时分析降级',
      detail: `流式答复失败，已切换到标准提案模式：${(error as Error).message}`,
    });
    await emit({ type: 'message', message: fallbackTrace });
  }

  const generated = await generateProposalResponse(
    aiConfig,
    projectSnapshot,
    [...existingMessages, userMessage],
    enabledSkills,
    trimmedContent,
  );
  const response = generated.response;

  const assistantContent = streamedAssistantContent.trim()
    || response.reply.trim()
    || '已完成本轮分析，但没有生成额外答复。';
  const assistantMessage = await insertMessage(db, session.id, 'assistant', assistantContent, {
    reasoningSummary: response.reasoning_summary,
    displayMode: streamedAssistantContent.trim() || !generated.usedFallback ? 'markdown' : 'fallback',
    ...(generated.usedFallback && generated.rawOutput
      ? { debugRawOutput: generated.rawOutput }
      : {}),
  });
  await emit({ type: 'message', message: assistantMessage });

  for (const trace of response.trace.slice(0, 6)) {
    const traceMessage = await insertMessage(db, session.id, 'trace', trace.title, {
      title: trace.title,
      detail: trace.detail,
    });
    await emit({ type: 'message', message: traceMessage });
  }

  if (session.title === '新会话') {
    await touchSession(db, session.id, response.session_title?.trim() || deriveSessionTitle(trimmedContent));
  } else {
    await touchSession(db, session.id);
  }

  if (response.actions.length > 0) {
    const proposal = await insertProposalRecord(
      db,
      session.id,
      userMessage.id,
      assistantMessage.id,
      trimmedContent,
      response.reply.trim() || assistantContent,
      response,
    );
    await emit({ type: 'proposal', proposal });
  }

  const detail = await getCopilotSessionDetail(db, session.id, userId);
  await emit({ type: 'done', detail });
  return detail;
}

export async function confirmCopilotProposal(
  db: D1Database,
  proposalId: string,
  userId: string
): Promise<AgentSessionDetail> {
  const proposalRow = await db.prepare(`
    SELECT p.*, s.project_id, s.user_id
    FROM agent_proposals p
    JOIN agent_sessions s ON s.id = p.session_id
    WHERE p.id = ? AND s.user_id = ?
    LIMIT 1
  `).bind(proposalId, userId).first();

  if (!proposalRow) {
    throw new Error('Proposal not found');
  }

  const status = String((proposalRow as any).status || 'pending') as AgentProposalRecord['status'];
  if (status !== 'pending') {
    throw new Error(`Proposal already ${status}`);
  }

  const sessionId = String((proposalRow as any).session_id);
  const projectId = String((proposalRow as any).project_id);
  const actions = parseJson<AgentProposalAction[]>((proposalRow as any).actions_json, []);

  await db.prepare(`
    UPDATE agent_proposals
    SET status = 'confirmed', updated_at = (unixepoch() * 1000)
    WHERE id = ?
  `).bind(proposalId).run();

  await insertMessage(db, sessionId, 'trace', '开始执行 proposal', {
    title: '开始执行 proposal',
    detail: `共 ${actions.length} 个动作，按顺序落地到项目数据。`,
  });

  const results: string[] = [];
  try {
    for (const action of actions) {
      const summary = await executeProposalAction(db, projectId, action);
      results.push(summary);
      await insertMessage(db, sessionId, 'trace', action.summary || action.type, {
        title: action.summary || action.type,
        detail: summary,
      });
    }

    const resultSummary = results.join('\n');
    await db.prepare(`
      UPDATE agent_proposals
      SET
        status = 'executed',
        result_summary = ?,
        executed_at = (unixepoch() * 1000),
        updated_at = (unixepoch() * 1000)
      WHERE id = ?
    `).bind(resultSummary, proposalId).run();

    await insertMessage(db, sessionId, 'result', resultSummary, {
      results,
    });
    await touchSession(db, sessionId);
  } catch (error) {
    const message = (error as Error).message;
    await db.prepare(`
      UPDATE agent_proposals
      SET
        status = 'failed',
        error_message = ?,
        updated_at = (unixepoch() * 1000)
      WHERE id = ?
    `).bind(message, proposalId).run();

    await insertMessage(db, sessionId, 'result', `执行失败：${message}`, {
      error: message,
      partialResults: results,
    });
    await touchSession(db, sessionId);
  }

  return getCopilotSessionDetail(db, sessionId, userId);
}
