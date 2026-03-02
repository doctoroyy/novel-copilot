export type ProviderProtocol = 'openai' | 'gemini' | 'anthropic';

export type ProviderPreset = {
  id: string;
  label: string;
  protocol: ProviderProtocol;
  defaultBaseUrl?: string;
  aliases?: string[];
  isCustom?: boolean;
  color?: string;
};

const PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', protocol: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', color: '#10a37f' },
  { id: 'anthropic', label: 'Anthropic', protocol: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com', color: '#d97757' },
  { id: 'gemini', label: 'Google Gemini', protocol: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', color: '#4285f4' },
  { id: 'deepseek', label: 'DeepSeek', protocol: 'openai', defaultBaseUrl: 'https://api.deepseek.com/v1', color: '#4d6bfe' },
  { id: 'zai', label: 'Zhipu GLM (zAI)', protocol: 'openai', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', aliases: ['zhipu', 'glm', 'bigmodel', 'z-ai'], color: '#3b5ccc' },
  { id: 'moonshot', label: 'Moonshot (Kimi)', protocol: 'openai', defaultBaseUrl: 'https://api.moonshot.cn/v1', aliases: ['kimi'], color: '#000000' },
  { id: 'qwen', label: 'Qwen / DashScope', protocol: 'openai', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', aliases: ['dashscope', 'aliyun', 'bailian'], color: '#615ced' },
  { id: 'openrouter', label: 'OpenRouter', protocol: 'openai', defaultBaseUrl: 'https://openrouter.ai/api/v1', color: '#6466f1' },
  { id: 'groq', label: 'Groq', protocol: 'openai', defaultBaseUrl: 'https://api.groq.com/openai/v1', color: '#f55036' },
  { id: 'xai', label: 'xAI', protocol: 'openai', defaultBaseUrl: 'https://api.x.ai/v1', aliases: ['grok'], color: '#000000' },
  { id: 'together', label: 'Together AI', protocol: 'openai', defaultBaseUrl: 'https://api.together.xyz/v1', color: '#0f6fff' },
  { id: 'siliconflow', label: 'SiliconFlow', protocol: 'openai', defaultBaseUrl: 'https://api.siliconflow.cn/v1', color: '#7c3aed' },
  { id: 'mistral', label: 'Mistral', protocol: 'openai', defaultBaseUrl: 'https://api.mistral.ai/v1', color: '#ff7000' },
  { id: 'fireworks', label: 'Fireworks AI', protocol: 'openai', defaultBaseUrl: 'https://api.fireworks.ai/inference/v1', color: '#e25822' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', protocol: 'openai', isCustom: true, color: '#6b7280' },
];

const BASE_URL_HINTS: Array<{ pattern: RegExp; providerId: string }> = [
  { pattern: /open\.bigmodel\.cn|api\.z\.ai/i, providerId: 'zai' },
  { pattern: /api\.deepseek\.com/i, providerId: 'deepseek' },
  { pattern: /generativelanguage\.googleapis\.com/i, providerId: 'gemini' },
  { pattern: /api\.anthropic\.com/i, providerId: 'anthropic' },
  { pattern: /openrouter\.ai/i, providerId: 'openrouter' },
  { pattern: /api\.moonshot\.cn/i, providerId: 'moonshot' },
  { pattern: /dashscope\.aliyuncs\.com/i, providerId: 'qwen' },
  { pattern: /api\.groq\.com/i, providerId: 'groq' },
  { pattern: /api\.x\.ai/i, providerId: 'xai' },
  { pattern: /api\.together\.xyz/i, providerId: 'together' },
  { pattern: /api\.siliconflow\.cn/i, providerId: 'siliconflow' },
  { pattern: /api\.mistral\.ai/i, providerId: 'mistral' },
  { pattern: /api\.fireworks\.ai/i, providerId: 'fireworks' },
];

const PRESET_BY_ID = new Map<string, ProviderPreset>();
const ALIAS_TO_ID = new Map<string, string>();

for (const preset of PRESETS) {
  PRESET_BY_ID.set(preset.id, preset);
  ALIAS_TO_ID.set(preset.id, preset.id);
  for (const alias of preset.aliases || []) {
    ALIAS_TO_ID.set(alias, preset.id);
  }
}

function sanitizeProvider(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function normalizeProviderId(provider?: string): string {
  const raw = (provider || '').trim();
  if (!raw) return 'custom';
  const candidate = sanitizeProvider(raw);
  return ALIAS_TO_ID.get(candidate) || candidate;
}

export function detectProviderByBaseUrl(baseUrl?: string): string | null {
  if (!baseUrl) return null;
  for (const hint of BASE_URL_HINTS) {
    if (hint.pattern.test(baseUrl)) {
      return hint.providerId;
    }
  }
  return null;
}

export function getProviderPreset(provider?: string): ProviderPreset | null {
  const normalized = normalizeProviderId(provider);
  return PRESET_BY_ID.get(normalized) || null;
}

export function getProviderPresets(): ProviderPreset[] {
  return PRESETS.map((preset) => ({ ...preset }));
}

/**
 * Normalize Gemini base URL to API root with version path.
 * Accepts host-only/base paths and strips accidental /models suffix.
 */
export function normalizeGeminiBaseUrl(baseUrl?: string): string | undefined {
  const raw = String(baseUrl || '').trim();
  if (!raw) return undefined;

  let normalized = raw.replace(/\/+$/, '');
  normalized = normalized.replace(/\/models(?:\/.*)?$/i, '');

  if (!/generativelanguage\.googleapis\.com/i.test(normalized)) {
    return normalized;
  }

  if (/\/v\d+(?:beta|alpha)?$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}/v1beta`;
}
