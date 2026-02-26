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
    label: '轻快网文',
    description: '默认模板。可读性优先，少修饰，节奏稳。',
    styleRules: [
      '用词直接清晰，短句和中句为主，避免连续堆砌形容词。',
      '每段只保留一个重点画面，减少华丽比喻和空抒情。',
      '对话口语化，尽量让信息和冲突通过行动与对话推进。',
      '章节衔接要自然，禁止机械复述上一章最后一句或最后一幕。',
    ],
  },
  plot_first: {
    id: 'plot_first',
    label: '剧情推进',
    description: '冲突密度更高，突出事件推进和爽点兑现。',
    styleRules: [
      '先写冲突和决策，再补必要描写，避免慢热铺垫过长。',
      '每个场景要产生明确变化：信息变化、关系变化或局势变化。',
      '动作和博弈写具体，少抽象评价，多结果反馈。',
      '章末留下强问题或强压力，推动下一章立即展开。',
    ],
  },
  cinematic: {
    id: 'cinematic',
    label: '电影感',
    description: '保留一定画面感，但控制修辞密度。',
    styleRules: [
      '场景描写聚焦镜头感，但每段不超过一个核心意象。',
      '环境、动作、心理交替推进，避免大段形容词堆叠。',
      '关键段落允许适度文采，普通叙事保持简洁。',
      '章首自然入戏，不做回顾式衔接；章末留悬念或转折。',
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

