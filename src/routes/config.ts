import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { generateText, AIProvider } from '../services/aiClient';

export const configRoutes = new Hono<{ Bindings: Env }>();

// Test AI connection (config passed in body, not stored on server)
configRoutes.post('/test', async (c) => {
  try {
    const { provider, model, apiKey, baseUrl } = await c.req.json();

    if (!provider || !model || !apiKey) {
      return c.json({ success: false, message: 'Missing config parameters' }, 400);
    }

    // Test the connection
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
      maxTokens: 10,
    });

    if (!text || text.trim().length === 0) {
      return { success: false, message: '连接成功，但模型返回了空内容' };
    }

    return { success: true, message: `连接成功! 回复: "${text.trim()}"` };
  } catch (error) {
    return { success: false, message: `连接失败: ${(error as Error).message}` };
  }
}

