import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { generateText, AIProvider } from '../services/aiClient';
import { getProviderPresets, getProviderPreset, normalizeProviderId, normalizeGeminiBaseUrl } from '../services/providerCatalog.js';

export const configRoutes = new Hono<{ Bindings: Env }>();

// Public provider presets for client-side custom provider settings
configRoutes.get('/provider-presets', async (c) => {
  return c.json({
    success: true,
    providers: getProviderPresets().map((item) => ({
      id: item.id,
      label: item.label,
      protocol: item.protocol,
      defaultBaseUrl: item.defaultBaseUrl || '',
      isCustom: Boolean(item.isCustom),
      color: item.color || '#6b7280',
    })),
  });
});

// Test AI connection
// Supports two modes:
// 1. Client-side custom config: pass provider/model/apiKey/baseUrl directly
// 2. Admin server-side: pass providerId to use DB-stored key
configRoutes.post('/test', async (c) => {
  try {
    const body = await c.req.json();
    let { provider, model, apiKey, baseUrl } = body;
    const { providerId } = body;

    // If providerId is given and no apiKey, look up from DB
    if (providerId && !apiKey) {
      const row = await c.env.DB.prepare(
        `SELECT p.api_key_encrypted, p.base_url, p.protocol,
                (SELECT m.model_name FROM model_registry m WHERE m.provider_id = p.id AND m.is_active = 1 ORDER BY m.is_default DESC LIMIT 1) as first_model
         FROM provider_registry p WHERE p.id = ?`
      ).bind(providerId).first() as any;

      if (!row || !row.api_key_encrypted) {
        return c.json({ success: false, message: '该 Provider 未配置 API Key' }, 400);
      }
      apiKey = row.api_key_encrypted;
      if (!provider) provider = row.protocol || 'openai';
      if (!baseUrl) baseUrl = row.base_url || '';
      if (!model) model = row.first_model || 'gpt-4o-mini';
    }

    if (!provider || !model || !apiKey) {
      return c.json({ success: false, message: 'Missing config parameters' }, 400);
    }

    const result = await testAIConnection({
      provider: provider as AIProvider,
      model,
      apiKey,
      baseUrl
    });
    return c.json(result);
  } catch (error) {
    console.error('Test connection error:', error);
    return c.json({ success: false, message: (error as Error).message }, 500);
  }
});

// Fetch available models from a provider API (public, requires login)
configRoutes.post('/fetch-models', async (c) => {
  try {
    const userId = c.get('userId');
    if (!userId) {
      return c.json({ success: false, error: '未登录' }, 401);
    }

    const { provider, apiKey, baseUrl } = await c.req.json();
    if (!provider || !apiKey) {
      return c.json({ success: false, error: 'provider 和 apiKey 不能为空' }, 400);
    }

    const normalizedProvider = normalizeProviderId(String(provider));
    const preset = getProviderPreset(normalizedProvider);
    const providerType = preset?.protocol || 'openai';
    const effectiveBaseUrl = String(baseUrl || '').trim() || preset?.defaultBaseUrl;

    if (!effectiveBaseUrl) {
      return c.json({
        success: false,
        error: `请提供 Base URL。provider=${normalizedProvider} 未配置默认地址`,
      }, 400);
    }

    let models: { id: string; name: string; displayName: string }[] = [];

    if (providerType === 'gemini') {
      const geminiBaseUrl = normalizeGeminiBaseUrl(effectiveBaseUrl) || 'https://generativelanguage.googleapis.com/v1beta';
      const res = await fetch(`${geminiBaseUrl}/models?key=${apiKey}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json() as any;
        throw new Error(err.error?.message || `Gemini API 错误: ${res.status}`);
      }
      const data = await res.json() as any;
      models = (data.models || [])
        .filter((m: any) => {
          const methods = m.supportedGenerationMethods || [];
          return methods.includes('generateContent') || methods.includes('streamGenerateContent');
        })
        .map((m: any) => ({
          id: m.name?.replace('models/', '') || m.name,
          name: m.name?.replace('models/', '') || m.name,
          displayName: m.displayName || m.name?.replace('models/', '') || m.name,
        }));
    } else if (providerType === 'anthropic') {
      const res = await fetch(`${effectiveBaseUrl}/v1/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } })) as any;
        throw new Error(err.error?.message || err.message || `Anthropic API 错误: ${res.status}`);
      }
      const data = await res.json() as any;
      models = (data.data || []).map((m: any) => ({
        id: m.id || m.name,
        name: m.id || m.name,
        displayName: m.display_name || m.id || m.name,
      }));
    } else {
      const modelsUrl = effectiveBaseUrl.endsWith('/v1')
        ? `${effectiveBaseUrl}/models`
        : `${effectiveBaseUrl}/v1/models`;
      const res = await fetch(modelsUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } })) as any;
        throw new Error(err.error?.message || `API 错误: ${res.status}`);
      }
      const data = await res.json() as any;
      const modelList = data.data || data.models || [];
      models = modelList.map((m: any) => ({
        id: m.id || m.name,
        name: m.id || m.name,
        displayName: m.id || m.name,
      }));
    }

    models.sort((a, b) => a.name.localeCompare(b.name));

    return c.json({ success: true, models, count: models.length });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Helper function to test AI connection
async function testAIConnection(config: {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<{ success: boolean; message: string }> {
  try {
    const text = await generateText(config, {
      system: 'You are a helpful assistant.',
      prompt: 'Say "Hello" in one word.',
      temperature: 0,
      maxTokens: 50,
    });

    if (!text || text.trim().length === 0) {
      return { success: false, message: '连接成功，但模型返回了空内容' };
    }

    return { success: true, message: `连接成功! 回复: "${text.trim().slice(0, 100)}"` };
  } catch (error) {
    const msg = (error as Error).message;
    // Truncation means the model DID respond — connection is fine
    if (msg.includes('截断') || msg.includes('truncat') || msg.includes('stopReason=length')) {
      return { success: true, message: '连接成功! (模型已响应)' };
    }
    return { success: false, message: `连接失败: ${msg}` };
  }
}
