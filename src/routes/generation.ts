import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { generateText, type AIConfig } from '../services/aiClient.js';

export const generationRoutes = new Hono<{ Bindings: Env }>();

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

// Normalize chapter data from LLM output to consistent structure
function normalizeChapter(ch: any, fallbackIndex: number): { index: number; title: string; goal: string; hook: string } {
  return {
    index: ch.index ?? ch.chapter_id ?? ch.chapter_number ?? fallbackIndex,
    title: ch.title || `第${fallbackIndex}章`,
    goal: ch.goal || ch.outline || ch.description || ch.plot_summary || '',
    hook: ch.hook || '',
  };
}

// Normalize volume data from LLM output
function normalizeVolume(vol: any, volIndex: number, chapters: any[]): any {
  return {
    title: vol.title || vol.volumeTitle || vol.volume_title || `第${volIndex + 1}卷`,
    startChapter: vol.startChapter ?? vol.start_chapter ?? (volIndex * 80 + 1),
    endChapter: vol.endChapter ?? vol.end_chapter ?? ((volIndex + 1) * 80),
    goal: vol.goal || vol.summary || vol.volume_goal || '',
    conflict: vol.conflict || '',
    climax: vol.climax || '',
    chapters: chapters.map((ch, i) => normalizeChapter(ch, i + 1)),
  };
}

// Normalize milestones - ensure it's an array of strings
function normalizeMilestones(milestones: any[]): string[] {
  if (!Array.isArray(milestones)) return [];
  return milestones.map((m) => {
    if (typeof m === 'string') return m;
    // Handle object format like {milestone: '...', description: '...'}
    return m.milestone || m.description || m.title || JSON.stringify(m);
  });
}

// Generate outline
generationRoutes.post('/projects/:name/outline', async (c) => {
  const name = c.req.param('name');
  const aiConfig = getAIConfigFromHeaders(c);

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const { targetChapters = 400, targetWordCount = 100, customPrompt } = await c.req.json();

    // Get project
    const project = await c.env.DB.prepare(`
      SELECT id, bible FROM projects WHERE name = ?
    `).bind(name).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    let bible = (project as any).bible;
    if (customPrompt) {
      bible = `${bible}\n\n## 用户自定义要求\n${customPrompt}`;
    }

    // Generate master outline
    const masterOutline = await generateMasterOutline(aiConfig, bible, targetChapters, targetWordCount);
    
    // Generate volume chapters and normalize
    const volumes = [];
    for (let i = 0; i < masterOutline.volumes.length; i++) {
      const vol = masterOutline.volumes[i];
      const chapters = await generateVolumeChapters(aiConfig, bible, masterOutline, vol);
      volumes.push(normalizeVolume(vol, i, chapters));
    }

    const outline = {
      totalChapters: targetChapters,
      targetWordCount,
      volumes,
      mainGoal: masterOutline.mainGoal || '',
      milestones: normalizeMilestones(masterOutline.milestones || []),
    };

    // Save outline
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO outlines (project_id, outline_json) VALUES (?, ?)
    `).bind((project as any).id, JSON.stringify(outline)).run();

    // Update state
    await c.env.DB.prepare(`
      UPDATE states SET total_chapters = ? WHERE project_id = ?
    `).bind(targetChapters, (project as any).id).run();

    return c.json({ success: true, outline });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Generate chapters
generationRoutes.post('/projects/:name/generate', async (c) => {
  const name = c.req.param('name');
  const aiConfig = getAIConfigFromHeaders(c);

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const { chaptersToGenerate = 1 } = await c.req.json();

    // Get project with state and outline
    const project = await c.env.DB.prepare(`
      SELECT p.id, p.bible, s.*, o.outline_json
      FROM projects p
      JOIN states s ON p.id = s.project_id
      LEFT JOIN outlines o ON p.id = o.project_id
      WHERE p.name = ?
    `).bind(name).first() as any;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const outline = project.outline_json ? JSON.parse(project.outline_json) : null;
    const results: { chapter: number; title: string }[] = [];

    for (let i = 0; i < chaptersToGenerate; i++) {
      const chapterIndex = project.next_chapter_index + i;
      if (chapterIndex > project.total_chapters) break;

      // Get last 2 chapters
      const { results: lastChapters } = await c.env.DB.prepare(`
        SELECT content FROM chapters 
        WHERE project_id = ? AND chapter_index >= ?
        ORDER BY chapter_index DESC LIMIT 2
      `).bind(project.id, Math.max(1, chapterIndex - 2)).all();

      // Get chapter goal from outline
      let chapterGoalHint: string | undefined;
      let outlineTitle: string | undefined;
      if (outline) {
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
        bible: project.bible,
        rollingSummary: project.rolling_summary || '',
        openLoops: JSON.parse(project.open_loops || '[]'),
        lastChapters: lastChapters.map((c: any) => c.content).reverse(),
        chapterIndex,
        totalChapters: project.total_chapters,
        chapterGoalHint,
        chapterTitle: outlineTitle,
      });

      // Save chapter
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO chapters (project_id, chapter_index, content) VALUES (?, ?, ?)
      `).bind(project.id, chapterIndex, chapterText).run();

      // Extract title
      const titleMatch = chapterText.match(/^第?\d*[章回节]?\s*[：:.]?\s*(.+)/m);
      const title = titleMatch ? titleMatch[1] : (outlineTitle || `Chapter ${chapterIndex}`);

      results.push({ chapter: chapterIndex, title });

      // Update state
      await c.env.DB.prepare(`
        UPDATE states SET next_chapter_index = ? WHERE project_id = ?
      `).bind(chapterIndex + 1, project.id).run();
    }

    return c.json({ success: true, generated: results });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Generate bible
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

// Helper: Generate master outline
async function generateMasterOutline(
  aiConfig: AIConfig,
  bible: string,
  targetChapters: number,
  targetWordCount: number
) {
  const volumeCount = Math.ceil(targetChapters / 80);

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

// Migration endpoint to normalize existing outline data
generationRoutes.post('/migrate-outlines', async (c) => {
  try {
    // Get all outlines from database
    const { results } = await c.env.DB.prepare(`
      SELECT o.project_id, o.outline_json, p.name as project_name
      FROM outlines o
      JOIN projects p ON o.project_id = p.id
    `).all();

    const migrated: string[] = [];
    const errors: string[] = [];

    for (const row of results) {
      try {
        const outline = JSON.parse((row as any).outline_json);
        
        // Normalize the outline
        const normalizedOutline = {
          totalChapters: outline.totalChapters,
          targetWordCount: outline.targetWordCount,
          mainGoal: outline.mainGoal || '',
          milestones: normalizeMilestones(outline.milestones || []),
          volumes: (outline.volumes || []).map((vol: any, volIndex: number) => ({
            title: vol.title || vol.volumeTitle || vol.volume_title || `第${volIndex + 1}卷`,
            startChapter: vol.startChapter ?? vol.start_chapter ?? (volIndex * 80 + 1),
            endChapter: vol.endChapter ?? vol.end_chapter ?? ((volIndex + 1) * 80),
            goal: vol.goal || vol.summary || vol.volume_goal || '',
            conflict: vol.conflict || '',
            climax: vol.climax || '',
            chapters: (vol.chapters || []).map((ch: any, chIndex: number) => normalizeChapter(ch, chIndex + 1)),
          })),
        };

        // Update the database
        await c.env.DB.prepare(`
          UPDATE outlines SET outline_json = ? WHERE project_id = ?
        `).bind(JSON.stringify(normalizedOutline), (row as any).project_id).run();

        migrated.push((row as any).project_name);
      } catch (err) {
        errors.push(`${(row as any).project_name}: ${(err as Error).message}`);
      }
    }

    return c.json({ 
      success: true, 
      message: `Migrated ${migrated.length} outlines`,
      migrated,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});
