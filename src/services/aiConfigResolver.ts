import { getAIConfigFromRegistry, type AIConfig } from './aiClient.js';

/**
 * Get AI config from Custom Headers (if user has permission) or Model Registry.
 */
export async function getAIConfig(c: any, db: D1Database, featureKey?: string): Promise<AIConfig | null> {
  const userId = c.get('userId');

  // 1. Check if user has permission for custom provider
  if (userId) {
    const user = await db.prepare('SELECT allow_custom_provider FROM users WHERE id = ?').bind(userId).first() as any;
    if (user?.allow_custom_provider) {
      // 2. Try to get config from headers
      const headers = c.req.header();
      const customProvider = headers['x-custom-provider'];
      const customModel = headers['x-custom-model'];
      const customBaseUrl = headers['x-custom-base-url'];
      const customApiKey = headers['x-custom-api-key'];

      if (customProvider && customModel && customApiKey) {
        return {
          provider: customProvider as any,
          model: customModel,
          apiKey: customApiKey,
          baseUrl: customBaseUrl,
        };
      }
    }
  }

  // 3. Fallback to registry
  return getAIConfigFromRegistry(db, featureKey || 'generate_chapter');
}

export async function getFeatureMappedAIConfig(db: D1Database, featureKey: string): Promise<AIConfig | null> {
  try {
    const mapping = await db.prepare(`
      SELECT m.model_name, p.api_key_encrypted, p.base_url, p.id as provider_id
      FROM feature_model_mappings fmm
      JOIN model_registry m ON fmm.model_id = m.id
      JOIN provider_registry p ON m.provider_id = p.id
      WHERE fmm.feature_key = ? AND m.is_active = 1
      LIMIT 1
    `).bind(featureKey).first() as {
      model_name: string;
      api_key_encrypted: string | null;
      base_url: string | null;
      provider_id: string;
    } | null;

    if (!mapping || !mapping.api_key_encrypted) {
      return null;
    }

    return {
      provider: mapping.provider_id as any,
      model: mapping.model_name,
      apiKey: mapping.api_key_encrypted,
      baseUrl: mapping.base_url || undefined,
    };
  } catch (error) {
    console.warn(`Failed to load feature-mapped model for ${featureKey}:`, (error as Error).message);
    return null;
  }
}

export function extractErrorMessage(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) return error.message || '';
  return String(error);
}

export function parseNestedErrorMessage(rawMessage: string): string {
  const trimmed = rawMessage.trim();
  if (!trimmed) return '';

  let candidate = trimmed;
  for (let depth = 0; depth < 2; depth++) {
    if (!(candidate.startsWith('{') || candidate.startsWith('['))) {
      break;
    }
    try {
      const parsed = JSON.parse(candidate) as any;
      const nested = parsed?.error?.message ?? parsed?.message;
      if (typeof nested === 'string' && nested.trim()) {
        candidate = nested.trim();
        continue;
      }
      break;
    } catch {
      break;
    }
  }

  return candidate;
}

export function isGeminiLikeConfig(config: AIConfig): boolean {
  const provider = String(config.provider || '').toLowerCase();
  if (provider.includes('gemini') || provider === 'google') {
    return true;
  }
  return /generativelanguage\.googleapis\.com/i.test(String(config.baseUrl || ''));
}

export function isLocationUnsupportedError(error: unknown): boolean {
  const message = parseNestedErrorMessage(extractErrorMessage(error)).toLowerCase();
  return (
    message.includes('user location is not supported for the api use') ||
    (message.includes('failed_precondition') && message.includes('location'))
  );
}

export function formatGenerationError(error: unknown): string {
  const parsed = parseNestedErrorMessage(extractErrorMessage(error));
  const normalized = parsed || extractErrorMessage(error) || 'AI 生成失败';
  const lower = normalized.toLowerCase();

  if (
    lower.includes('user location is not supported for the api use') ||
    (lower.includes('failed_precondition') && lower.includes('location'))
  ) {
    return '当前模型受地区限制暂不可用，请切换到 OpenAI / DeepSeek / Qwen 等可用模型，或联系管理员调整默认模型。';
  }

  return normalized;
}

export function isSameAIConfig(a: AIConfig, b: AIConfig): boolean {
  return (
    String(a.provider || '').toLowerCase() === String(b.provider || '').toLowerCase() &&
    String(a.model || '').toLowerCase() === String(b.model || '').toLowerCase() &&
    String(a.baseUrl || '').toLowerCase() === String(b.baseUrl || '').toLowerCase()
  );
}

export async function getNonGeminiFallbackAIConfig(db: D1Database, primary: AIConfig): Promise<AIConfig | null> {
  try {
    const { results } = await db.prepare(`
      SELECT p.id as provider, m.model_name, p.api_key_encrypted, p.base_url, m.is_default, m.updated_at
      FROM model_registry m
      JOIN provider_registry p ON m.provider_id = p.id
      WHERE m.is_active = 1
        AND p.api_key_encrypted IS NOT NULL
        AND TRIM(p.api_key_encrypted) != ''
      ORDER BY m.is_default DESC, m.updated_at DESC
    `).all();

    for (const row of (results || []) as any[]) {
      const candidate: AIConfig = {
        provider: row.provider,
        model: row.model_name,
        apiKey: row.api_key_encrypted,
        baseUrl: row.base_url || undefined,
      };
      if (!candidate.apiKey) continue;
      if (isGeminiLikeConfig(candidate)) continue;
      if (isSameAIConfig(candidate, primary)) continue;
      return candidate;
    }

    return null;
  } catch (error) {
    console.warn('Failed to resolve non-Gemini fallback model:', extractErrorMessage(error));
    return null;
  }
}
