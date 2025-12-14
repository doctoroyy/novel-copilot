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
        const error = await response.json();
        return { success: false, message: `连接失败: ${error.error?.message || response.statusText}` };
      }

      const data = await response.json() as any;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { success: true, message: `连接成功! 回复: "${text.trim()}"` };
    } else {
      // OpenAI-compatible API
      const baseUrl = config.baseUrl || 
        (config.provider === 'openai' ? 'https://api.openai.com/v1' : 
         config.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 
         config.baseUrl);

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
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return { success: false, message: `连接失败: ${(error as any).error?.message || response.statusText}` };
      }

      const data = await response.json() as any;
      const text = data.choices?.[0]?.message?.content || '';
      return { success: true, message: `连接成功! 回复: "${text.trim()}"` };
    }
  } catch (error) {
    return { success: false, message: `连接失败: ${(error as Error).message}` };
  }
}
