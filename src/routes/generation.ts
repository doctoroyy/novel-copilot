import { Hono } from 'hono';
import { generateText, type AIConfig } from '../services/aiClient.js';

export const generationRoutes = new Hono();

// Helper to get AI config from headers
function getAIConfigFromHeaders(c: any): AIConfig | null {
  const provider = c.req.header('X-AI-Provider');
  const model = c.req.header('X-AI-Model');
  const apiKey = c.req.header('X-AI-Key');
  const baseUrl = c.req.header('X-AI-BaseUrl');

  if (!provider || !model || !apiKey) {
    return null;
  }

  return { provider: provider as AIConfig['provider'], model, apiKey, baseUrl };
}

// Generate Story Bible (Stateless)
generationRoutes.post('/generate-bible', async (c) => {
  const aiConfig = getAIConfigFromHeaders(c);

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const { genre, theme, keywords } = await c.req.json();

    const system = `你是一个网文策划专家。根据用户的要求，生成一个完整的 Story Bible。
Story Bible 应该包含：书名、类型、核心设定、主角信息、主要配角、金手指/系统、主线剧情、世界观等。
输出格式为 Markdown。`;

    const prompt = `请为以下网文生成 Story Bible：
${genre ? `- 类型: ${genre}` : ''}
${theme ? `- 主题: ${theme}` : ''}
${keywords ? `- 关键词: ${keywords}` : ''}

请生成完整的 Story Bible：`;

    const bible = await generateText(aiConfig, { system, prompt });

    return c.json({ success: true, bible });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Generate Outline (Stateless)
generationRoutes.post('/generate-outline', async (c) => {
  const aiConfig = getAIConfigFromHeaders(c);

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const { bible, targetChapters = 400, targetWordCount = 100, customPrompt } = await c.req.json();

    if (!bible) {
      return c.json({ success: false, error: 'Bible content is required' }, 400);
    }

    let promptBible = bible;
    if (customPrompt) {
      promptBible = `${bible}\n\n## 用户自定义要求\n${customPrompt}`;
    }

    // Generate master outline
    const masterOutline = await generateMasterOutline(aiConfig, promptBible, targetChapters, targetWordCount);
    
    // Generate volume chapters
    const volumes = [];
    for (const vol of masterOutline.volumes) {
      const chapters = await generateVolumeChapters(aiConfig, promptBible, masterOutline, vol);
      volumes.push({ ...vol, chapters });
    }

    const outline = {
      totalChapters: targetChapters,
      targetWordCount,
      volumes,
      mainGoal: masterOutline.mainGoal,
      milestones: masterOutline.milestones,
    };

    return c.json({ success: true, outline });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Generate Chapter (Stateless)
generationRoutes.post('/generate-chapter', async (c) => {
  const aiConfig = getAIConfigFromHeaders(c);

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const { 
      bible, 
      rollingSummary, 
      openLoops, 
      lastChapters, // Array of strings (content)
      chapterIndex, 
      totalChapters,
      outline, // Full outline JSON object
    } = await c.req.json();

    if (!bible || !chapterIndex) {
      return c.json({ success: false, error: 'Missing required context (bible, chapterIndex)' }, 400);
    }

    // Get chapter goal from outline
    let chapterGoalHint: string | undefined;
    let outlineTitle: string | undefined;
    
    if (outline && outline.volumes) {
      for (const vol of outline.volumes) {
        const ch = vol.chapters.find((c: any) => c.index === chapterIndex);
        if (ch) {
          outlineTitle = ch.title;
          chapterGoalHint = `【章节大纲】\n- 标题: ${ch.title}\n- 目标: ${ch.goal}\n- 章末钩子: ${ch.hook}`;
          break;
        }
      }
    }

    // Generate chapter
    const chapterText = await generateChapter(aiConfig, {
      bible,
      rollingSummary: rollingSummary || '',
      openLoops: openLoops || [],
      lastChapters: lastChapters || [],
      chapterIndex,
      totalChapters: totalChapters || 100,
      chapterGoalHint,
      chapterTitle: outlineTitle,
    });

    // Extract title
    const titleMatch = chapterText.match(/^第?\d*[章回节]?\s*[：:.]?\s*(.+)/m);
    const title = titleMatch ? titleMatch[1] : (outlineTitle || `Chapter ${chapterIndex}`);

    return c.json({ 
      success: true, 
      chapter: {
        index: chapterIndex,
        title,
        content: chapterText
      }
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Helper: Generate master outline
async function generateMasterOutline(
  aiConfig: AIConfig,
  bible: string,
  targetChapters: number,
  targetWordCount: number
) {
  const volumeCount = Math.max(1, Math.ceil(targetChapters / 80));

  const system = `你是一个网文大纲策划专家。请根据 Story Bible 生成一个完整的总大纲。
输出严格的 JSON 格式，不要有其他文字。`;

  const prompt = `【Story Bible】
${bible}

【目标规模】
- 总章数: ${targetChapters} 章
- 总字数: ${targetWordCount} 万字
- 预计分卷数: ${volumeCount} 卷

请生成JSON格式的总大纲，包含 mainGoal, milestones, volumes 数组。`;

  const raw = await generateText(aiConfig, { system, prompt, temperature: 0.7 });
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
  return JSON.parse(jsonText);
}

// Helper: Generate volume chapters
async function generateVolumeChapters(
  aiConfig: AIConfig,
  bible: string,
  masterOutline: any,
  volume: any
) {
  const chapterCount = volume.endChapter - volume.startChapter + 1;

  const system = `你是一个网文章节大纲策划专家。请为一卷生成所有章节的大纲。
输出严格的 JSON 数组格式，不要有其他文字。`;

  const prompt = `【Story Bible】
${bible.slice(0, 2000)}...

【总目标】${masterOutline.mainGoal}

【本卷信息】
- ${volume.title}
- 章节范围: 第${volume.startChapter}章 ~ 第${volume.endChapter}章 (共${chapterCount}章)
- 本卷目标: ${volume.goal}

请生成本卷所有 ${chapterCount} 章的大纲（JSON数组）：`;

  const raw = await generateText(aiConfig, { system, prompt, temperature: 0.7 });
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
  return JSON.parse(jsonText);
}

// Helper: Generate chapter
async function generateChapter(
  aiConfig: AIConfig,
  params: {
    bible: string;
    rollingSummary: string;
    openLoops: string[];
    lastChapters: string[];
    chapterIndex: number;
    totalChapters: number;
    chapterGoalHint?: string;
    chapterTitle?: string;
  }
) {
  const { bible, rollingSummary, openLoops, lastChapters, chapterIndex, totalChapters, chapterGoalHint, chapterTitle } = params;
  const isFinal = chapterIndex === totalChapters;

  const system = `你是一个"稳定连载"的网文写作引擎。

硬性规则：
- 只有当 is_final_chapter=true 才允许收束主线、写结局
- 若 is_final_chapter=false：严禁出现任何收尾表达
- 每章必须推进冲突，并以强钩子结尾
- 每章字数建议 2500~3500 汉字

输出格式：
- 第一行必须是章节标题
- 其后是正文
- 严禁写任何元说明

当前是否为最终章：${isFinal}`;

  const prompt = `【章节信息】
- chapter_index: ${chapterIndex}
- total_chapters: ${totalChapters}
- is_final_chapter: ${isFinal}

【Story Bible】
${bible}

【Rolling Summary】
${rollingSummary || '（暂无）'}

【Open Loops】
${openLoops.length ? openLoops.map((x, i) => `${i + 1}. ${x}`).join('\n') : '（暂无）'}

【Last Chapters】
${lastChapters.length ? lastChapters.map((t, i) => `---近章${i + 1}---\n${t.slice(0, 1000)}`).join('\n\n') : '（暂无）'}

【本章写作目标】
${chapterGoalHint || '承接上一章结尾，推进主线一步。'}

请写出本章内容：`;

  return generateText(aiConfig, { system, prompt, temperature: 0.85 });
}
