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
      '极度通俗直白：用大白话讲故事，不要文书面语或诗词句，有强烈的“网文感”和“呼吸感”。',
      '拒绝修辞堆砌：绝对禁止连续的形容词、比喻和排比。',
      '降低信息密度：不要在一个句子里塞满多重动作或过多细节，留有想象空间。',
      '短句短段落：正文单句控制在 20-30 字，每段最多 3-4 句话，能两句话说完的绝不写三句。',
      '绝对口语化：对话要像现代真实人类交流，不要像话剧台词或译制片腔调。',
      '章节衔接要自然，禁止机械复述上一章最后一句或最后一幕。',
    ],
  },
  plot_first: {
    id: 'plot_first',
    label: '剧情推进',
    description: '冲突密度更高，突出事件推进和爽点兑现。',
    styleRules: [
      '先写冲突和决策，再补必要描写，避免慢热铺垫过长。',
      '单句正文不超过 35 个字，对话不超过 40 个字。',
      '动作场景句子更短，控制在 25 字以内。',
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
      '单句正文不超过 35 个字，描写性语句不超过 40 个字。',
      '长镜头描写每段不超过 4 句。',
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

