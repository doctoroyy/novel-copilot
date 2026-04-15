export type ChapterPromptProfileId =
  | 'web_novel_light'
  | 'plot_first'
  | 'cinematic';

type ChapterPromptProfile = {
  id: ChapterPromptProfileId;
  label: string;
  description: string;
  styleRules: string[];
};

export const DEFAULT_CHAPTER_PROMPT_PROFILE_ID: ChapterPromptProfileId = 'web_novel_light';

const MAX_CUSTOM_PROMPT_CHARS = 3000;

const CHAPTER_PROMPT_PROFILE_MAP: Record<ChapterPromptProfileId, ChapterPromptProfile> = {
  web_novel_light: {
    id: 'web_novel_light',
    label: '轻快小白文',
    description: '默认模板。注重轻松阅读体验，大白话叙事，拒绝长句和华丽辞藻。',
    styleRules: [
      '极度通俗直白：用大白话讲故事，不要书面语或诗词句，有强烈的"网文感"和"呼吸感"。',
      '拒绝修辞堆砌：绝对禁止连续的形容词、比喻和排比。',
      '短句短段落：正文单句 20-30 字，每段最多 3-4 句话。',
      '绝对口语化：对话像现代真实人类交流，禁止话剧腔和译制片腔调。',
      '章节衔接自然，禁止机械复述上一章结尾。',
      '每800-1000字安排一个小爽点（主角展示/进展/赢得交锋），保持阅读愉悦感。',
      '信息释放有节奏：不一次全说，用对话和事件分批透露，维持读者好奇心。',
    ],
  },
  plot_first: {
    id: 'plot_first',
    label: '剧情推进',
    description: '冲突密度更高，突出事件推进和爽点兑现。',
    styleRules: [
      '先写冲突和决策，再补必要描写，避免慢热铺垫过长。',
      '动作场景句子更短（≤25字），博弈场景可稍长（≤35字）。',
      '每个场景必须产生明确变化：信息变化、关系变化或局势变化。',
      '动作和博弈写具体过程，少抽象评价，多结果反馈。',
      '章末留下强问题或强压力，推动下一章立即展开。',
      '爽点密度要高：每600-800字一个爽点或微转折，让读者持续兴奋。',
      '善用"欲扬先抑"：越大的爽点前面铺垫越充分的困境。',
    ],
  },
  cinematic: {
    id: 'cinematic',
    label: '电影感',
    description: '保留一定画面感，但控制修辞密度。',
    styleRules: [
      '场景描写聚焦镜头感，每段不超过一个核心意象。',
      '单句正文不超过 35 字，描写性语句不超过 40 字。',
      '长镜头描写每段不超过 4 句，随后必须切入动作或对话。',
      '环境、动作、心理交替推进，避免大段形容词堆叠。',
      '关键段落允许适度文采，普通叙事保持简洁。',
      '章首自然入戏，不做回顾式衔接；章末留悬念或转折。',
      '画面感服务于情绪和节奏，不为描写而描写。',
    ],
  },
};

export function normalizeChapterPromptProfileId(value: unknown): ChapterPromptProfileId {
  if (typeof value !== 'string') {
    return DEFAULT_CHAPTER_PROMPT_PROFILE_ID;
  }
  const normalized = value.trim() as ChapterPromptProfileId;
  if (normalized && normalized in CHAPTER_PROMPT_PROFILE_MAP) {
    return normalized;
  }
  return DEFAULT_CHAPTER_PROMPT_PROFILE_ID;
}

export function normalizeChapterPromptCustom(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, MAX_CUSTOM_PROMPT_CHARS);
}

export function buildChapterPromptStyleSection(profileId: unknown, customPrompt: unknown): {
  profileId: ChapterPromptProfileId;
  profileLabel: string;
  profileDescription: string;
  styleBlock: string;
} {
  const resolvedId = normalizeChapterPromptProfileId(profileId);
  const profile = CHAPTER_PROMPT_PROFILE_MAP[resolvedId];
  const normalizedCustomPrompt = normalizeChapterPromptCustom(customPrompt);

  const lines: string[] = profile.styleRules.map((rule) => `- ${rule}`);
  if (normalizedCustomPrompt) {
    lines.push('');
    lines.push('【用户自定义补充要求（优先级高于模板）】');
    lines.push(normalizedCustomPrompt);
  }

  return {
    profileId: resolvedId,
    profileLabel: profile.label,
    profileDescription: profile.description,
    styleBlock: lines.join('\n'),
  };
}

