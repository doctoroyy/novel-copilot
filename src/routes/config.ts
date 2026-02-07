import { Hono } from 'hono';
import type { Env } from '../worker.js';

export const configRoutes = new Hono<{ Bindings: Env }>();

// Test AI connection (config passed in body, not stored on server)
configRoutes.post('/test', async (c) => {
  try {
    const { provider, model, apiKey, baseUrl } = await c.req.json();
    
    if (!provider || !model || !apiKey) {
      return c.json({ success: false, message: 'Missing config parameters' }, 400);
    }

    // Test the connection
    const result = await testAIConnection({ provider, model, apiKey, baseUrl });
    return c.json(result);
  } catch (error) {
    return c.json({ success: false, message: (error as Error).message }, 500);
  }
});

// Normalize base URL to ensure consistent format
function normalizeBaseUrl(url: string): string {
  if (!url) return url;
  // Remove trailing slash
  let normalized = url.replace(/\/+$/, '');
  // Common pattern: if URL ends with 'api.nvidia.com' or similar but no version, add /v1
  if (normalized.includes('integrate.api.nvidia.com') && !normalized.includes('/v1')) {
    normalized += '/v1';
  }
  return normalized;
}

// Helper function to test AI connection
async function testAIConnection(config: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<{ success: boolean; message: string }> {
  try {
    if (config.provider === 'gemini') {
      // Test Gemini API
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say "Hello" in one word.' }] }],
            generationConfig: { temperature: 0 },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        try {
          const error = JSON.parse(errorText) as any;
          return { success: false, message: `连接失败: ${error.error?.message || response.statusText}` };
        } catch {
          return { success: false, message: `连接失败: ${response.status} ${response.statusText}` };
        }
      }

      const data = await response.json() as any;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { success: true, message: `连接成功! 回复: "${text.trim()}"` };
    } else {
      // OpenAI-compatible API
      let baseUrl = config.baseUrl || 
        (config.provider === 'openai' ? 'https://api.openai.com/v1' : 
         config.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 
         config.baseUrl);

      // Normalize the base URL for common providers
      baseUrl = normalizeBaseUrl(baseUrl || '');

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Say "Hello" in one word.' },
          ],
          temperature: 0,
          max_tokens: 50, // Add max_tokens for NVIDIA API
        }),
      });

      // Read response as text first to handle empty responses
      const responseText = await response.text();
      
      if (!response.ok) {
        if (!responseText) {
          return { success: false, message: `连接失败: ${response.status} ${response.statusText} (空响应)` };
        }
        try {
          const error = JSON.parse(responseText);
          return { success: false, message: `连接失败: ${(error as any).error?.message || (error as any).message || response.statusText}` };
        } catch {
          return { success: false, message: `连接失败: ${response.status} ${responseText.slice(0, 200)}` };
        }
      }

      if (!responseText) {
        return { success: false, message: '连接失败: 服务器返回空响应' };
      }

      try {
        const data = JSON.parse(responseText) as any;
        const text = data.choices?.[0]?.message?.content || '';
        return { success: true, message: `连接成功! 回复: "${text.trim()}"` };
      } catch {
        return { success: false, message: `连接失败: 无法解析响应 - ${responseText.slice(0, 100)}` };
      }
    }
  } catch (error) {
    return { success: false, message: `连接失败: ${(error as Error).message}` };
  }
}

