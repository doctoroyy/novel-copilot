import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { generateText, type AIConfig } from '../services/aiClient.js';

export const editingRoutes = new Hono<{ Bindings: Env }>();

// Helper to get AI config from headers
function getAIConfigFromHeaders(c: any): AIConfig | null {
  const provider = c.req.header('x-ai-provider');
  const model = c.req.header('x-ai-model');
  const apiKey = c.req.header('x-ai-key');
  const baseUrl = c.req.header('x-ai-baseurl');
  
  if (!provider || !model || !apiKey) {
    return null;
  }
  
  return { provider, model, apiKey, baseUrl };
}

// Create a new chapter (user-scoped)
editingRoutes.post('/projects/:name/chapters', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  
  try {
    const { content, insertAfter } = await c.req.json();
    
    if (typeof content !== 'string') {
      return c.json({ success: false, error: 'content is required' }, 400);
    }

    // Get project
    const project = await c.env.DB.prepare(`
      SELECT p.id, s.next_chapter_index FROM projects p
      LEFT JOIN states s ON p.id = s.project_id
      WHERE p.name = ? AND p.deleted_at IS NULL AND p.user_id = ?
    `).bind(name, userId).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const projectId = (project as any).id;
    
    // Determine the chapter index
    let chapterIndex: number;
    
    if (typeof insertAfter === 'number') {
      // Insert after a specific chapter
      chapterIndex = insertAfter + 1;
      
      // Check if the position is valid (insertAfter chapter must exist or be 0)
      if (insertAfter > 0) {
        const prevChapter = await c.env.DB.prepare(`
          SELECT id FROM chapters WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
        `).bind(projectId, insertAfter).first();
        
        if (!prevChapter) {
          return c.json({ success: false, error: `Chapter ${insertAfter} does not exist` }, 400);
        }
      }
    } else {
      // Append at the end - use next_chapter_index from state
      chapterIndex = (project as any).next_chapter_index || 1;
    }

    // Check if chapter already exists (might happen if inserting)
    const existing = await c.env.DB.prepare(`
      SELECT id FROM chapters WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
    `).bind(projectId, chapterIndex).first();

    if (existing) {
      return c.json({ success: false, error: `Chapter ${chapterIndex} already exists` }, 400);
    }

    // Insert the new chapter
    await c.env.DB.prepare(`
      INSERT INTO chapters (project_id, chapter_index, content) VALUES (?, ?, ?)
    `).bind(projectId, chapterIndex, content).run();

    // Update next_chapter_index in state if we're appending at the end
    if (!insertAfter || chapterIndex >= ((project as any).next_chapter_index || 1)) {
      await c.env.DB.prepare(`
        UPDATE states SET next_chapter_index = ? WHERE project_id = ?
      `).bind(chapterIndex + 1, projectId).run();
    }

    return c.json({ 
      success: true, 
      chapterIndex,
      message: `Chapter ${chapterIndex} created`
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Update chapter content (user-scoped)
editingRoutes.put('/projects/:name/chapters/:index', async (c) => {
  const name = c.req.param('name');
  const index = parseInt(c.req.param('index'), 10);
  const userId = c.get('userId');
  
  try {
    const { content } = await c.req.json();
    
    if (typeof content !== 'string') {
      return c.json({ success: false, error: 'content is required' }, 400);
    }

    // Get project
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL AND user_id = ?
    `).bind(name, userId).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const projectId = (project as any).id;

    // Check if chapter exists
    const chapter = await c.env.DB.prepare(`
      SELECT id FROM chapters WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
    `).bind(projectId, index).first();

    if (!chapter) {
      return c.json({ success: false, error: 'Chapter not found' }, 404);
    }

    // Update chapter content
    await c.env.DB.prepare(`
      UPDATE chapters SET content = ?, updated_at = datetime('now') WHERE project_id = ? AND chapter_index = ?
    `).bind(content, projectId, index).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// AI refine selected text (user-scoped)
editingRoutes.post('/projects/:name/chapters/:index/refine', async (c) => {
  const name = c.req.param('name');
  const index = parseInt(c.req.param('index'), 10);
  const userId = c.get('userId');
  const aiConfig = getAIConfigFromHeaders(c);
  
  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }
  
  try {
    const { selectedText, instruction, context } = await c.req.json();
    
    if (!selectedText || !instruction) {
      return c.json({ success: false, error: 'selectedText and instruction are required' }, 400);
    }

    // Get project bible for context
    const project = await c.env.DB.prepare(`
      SELECT p.id, p.bible FROM projects p
      WHERE p.name = ? AND p.deleted_at IS NULL AND p.user_id = ?
    `).bind(name, userId).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const bible = (project as any).bible || '';

    // Generate refined text using AI
    const systemPrompt = `你是一位专业的小说编辑。你的任务是根据用户的指令优化一段文本。

规则：
1. 只输出优化后的文本，不要添加任何解释或说明
2. 保持文本的原有风格和语气
3. 确保修改后的文本与上下文衔接自然
4. 严格遵循用户的修改指令

故事背景：
${bible.substring(0, 2000)}`;

    const userPrompt = `请根据以下指令优化这段文本：

【原文】
${selectedText}

【上下文】
${context || '（无额外上下文）'}

【修改指令】
${instruction}

请直接输出优化后的文本，不要添加任何前缀或解释：`;

    const refinedText = await generateText(aiConfig, {
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.7,
    });

    return c.json({ 
      success: true, 
      originalText: selectedText,
      refinedText: refinedText.trim(),
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Update outline (user-scoped)
editingRoutes.put('/projects/:name/outline', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  
  try {
    const { outline } = await c.req.json();
    
    if (!outline) {
      return c.json({ success: false, error: 'outline is required' }, 400);
    }

    // Get project
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL AND user_id = ?
    `).bind(name, userId).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const projectId = (project as any).id;

    // Check if outline exists
    const existing = await c.env.DB.prepare(`
      SELECT id FROM outlines WHERE project_id = ?
    `).bind(projectId).first();

    if (existing) {
      // Update
      await c.env.DB.prepare(`
        UPDATE outlines SET outline_json = ?, updated_at = datetime('now') WHERE project_id = ?
      `).bind(JSON.stringify(outline), projectId).run();
    } else {
      // Insert (should strictly not happen if calling update, but good fallback)
      await c.env.DB.prepare(`
        INSERT INTO outlines (project_id, outline_json) VALUES (?, ?)
      `).bind(projectId, JSON.stringify(outline)).run();
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});
