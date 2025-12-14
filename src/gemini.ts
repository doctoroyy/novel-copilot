import 'dotenv/config';
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error('Missing GEMINI_API_KEY in .env file');
}

export const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

export const ai = new GoogleGenAI({ apiKey });

/**
 * 生成文本内容
 * @param args.system - System instruction (角色设定)
 * @param args.prompt - User prompt (用户输入)
 * @param args.temperature - 温度参数 (0.0-2.0)
 */
export async function generateText(args: {
  system: string;
  prompt: string;
  temperature?: number;
}): Promise<string> {
  const { system, prompt, temperature = 0.8 } = args;

  const response = await ai.models.generateContent({
    model: MODEL,
    config: {
      systemInstruction: system,
      temperature,
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  // 提取文本内容
  const text = extractText(response);

  if (!text.trim()) {
    throw new Error('Empty model response');
  }

  return text.trim();
}

/**
 * 从响应中提取文本
 */
function extractText(response: GenerateContentResponse): string {
  // 尝试多种方式提取文本
  if (response.text) {
    return response.text;
  }

  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts) {
    return candidate.content.parts
      .map((part) => ('text' in part ? part.text : ''))
      .join('');
  }

  return '';
}

/**
 * 带重试的文本生成
 */
export async function generateTextWithRetry(
  args: Parameters<typeof generateText>[0],
  maxRetries = 3
): Promise<string> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await generateText(args);
    } catch (error) {
      lastError = error as Error;
      console.warn(`Generation attempt ${i + 1} failed:`, lastError.message);

      // 如果是配额错误，等待更长时间
      if (lastError.message.includes('quota') || lastError.message.includes('429')) {
        await sleep(5000 * (i + 1));
      } else {
        await sleep(1000 * (i + 1));
      }
    }
  }

  throw new Error(`Failed after ${maxRetries} retries: ${lastError?.message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
