import { Hono } from 'hono';
import type { Env } from '../worker.js';

// Types
interface StoryboardShot {
  shot_id: number;
  description: string;
  duration: number;
  dialogue?: string;
}

interface AnimeProject {
  id: string;
  name: string;
  novel_text: string;
  total_episodes: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  error_message?: string;
  created_at: string;
  updated_at: string;
}

interface AnimeEpisode {
  id: string;
  project_id: string;
  episode_num: number;
  novel_chunk?: string;
  script?: string;
  storyboard_json?: string;
  video_r2_key?: string;
  audio_r2_key?: string;
  duration_seconds?: number;
  status: 'pending' | 'script' | 'storyboard' | 'audio' | 'video' | 'done' | 'error';
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export const animeRoutes = new Hono<{ Bindings: Env }>();

// Helper to generate UUID
function generateId(): string {
  return crypto.randomUUID();
}

// ==================== Project Routes ====================

// List all anime projects
animeRoutes.get('/projects', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM anime_projects ORDER BY created_at DESC
    `).all();

    return c.json({ success: true, projects: results || [] });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get single project with episodes
animeRoutes.get('/projects/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const project = await c.env.DB.prepare(`
      SELECT * FROM anime_projects WHERE id = ?
    `).bind(id).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const { results: episodes } = await c.env.DB.prepare(`
      SELECT id, episode_num, status, duration_seconds, video_r2_key, error_message, updated_at
      FROM anime_episodes 
      WHERE project_id = ?
      ORDER BY episode_num ASC
    `).bind(id).all();

    return c.json({ 
      success: true, 
      project,
      episodes: episodes || [],
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Create new anime project
animeRoutes.post('/projects', async (c) => {
  try {
    const { name, novelText, totalEpisodes = 60 } = await c.req.json();

    if (!name || !novelText) {
      return c.json({ success: false, error: 'name and novelText are required' }, 400);
    }

    // Check if project name already exists
    const existing = await c.env.DB.prepare(`
      SELECT id FROM anime_projects WHERE name = ?
    `).bind(name).first();

    if (existing) {
      return c.json({ success: false, error: 'Project name already exists' }, 400);
    }

    const projectId = generateId();

    // Insert project
    await c.env.DB.prepare(`
      INSERT INTO anime_projects (id, name, novel_text, total_episodes, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).bind(projectId, name, novelText, totalEpisodes).run();

    // Split novel into chunks and create episode records
    const chunkSize = Math.ceil(novelText.length / totalEpisodes);
    const statements = [];

    for (let i = 1; i <= totalEpisodes; i++) {
      const start = (i - 1) * chunkSize;
      const chunk = novelText.slice(start, start + chunkSize);
      const episodeId = generateId();

      statements.push(
        c.env.DB.prepare(`
          INSERT INTO anime_episodes (id, project_id, episode_num, novel_chunk, status)
          VALUES (?, ?, ?, ?, 'pending')
        `).bind(episodeId, projectId, i, chunk)
      );
    }

    // Batch insert episodes
    await c.env.DB.batch(statements);

    return c.json({ 
      success: true, 
      projectId,
      message: `Created project with ${totalEpisodes} episodes`,
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Delete project
animeRoutes.delete('/projects/:id', async (c) => {
  const id = c.req.param('id');

  try {
    // Episodes will be cascade deleted
    await c.env.DB.prepare(`
      DELETE FROM anime_projects WHERE id = ?
    `).bind(id).run();

    // TODO: Also delete R2 videos

    return c.json({ success: true, message: 'Project deleted' });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==================== Episode Routes ====================

// Get single episode details
animeRoutes.get('/projects/:projectId/episodes/:num', async (c) => {
  const projectId = c.req.param('projectId');
  const num = parseInt(c.req.param('num'), 10);

  try {
    const episode = await c.env.DB.prepare(`
      SELECT * FROM anime_episodes 
      WHERE project_id = ? AND episode_num = ?
    `).bind(projectId, num).first();

    if (!episode) {
      return c.json({ success: false, error: 'Episode not found' }, 404);
    }

    // Parse storyboard JSON if exists
    const result: any = { ...episode };
    if (result.storyboard_json) {
      try {
        result.storyboard = JSON.parse(result.storyboard_json);
      } catch {
        // Keep as string if parse fails
      }
    }

    return c.json({ success: true, episode: result });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==================== Generation Routes ====================

// Trigger generation for a project
animeRoutes.post('/projects/:id/generate', async (c) => {
  const projectId = c.req.param('id');

  try {
    // Read API key from headers (matches novel-copilot pattern)
    const apiKey = c.req.header('X-AI-Key');
    const { startEpisode = 1, endEpisode } = await c.req.json();

    if (!apiKey) {
      return c.json({ success: false, error: '请先在设置中配置 AI API Key' }, 400);
    }

    // Get project
    const project = await c.env.DB.prepare(`
      SELECT * FROM anime_projects WHERE id = ?
    `).bind(projectId).first() as AnimeProject | null;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const end = endEpisode || project.total_episodes;

    // Update project status
    await c.env.DB.prepare(`
      UPDATE anime_projects SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(projectId).run();

    // Get episodes to process
    const { results: episodes } = await c.env.DB.prepare(`
      SELECT * FROM anime_episodes 
      WHERE project_id = ? AND episode_num >= ? AND episode_num <= ?
      ORDER BY episode_num ASC
    `).bind(projectId, startEpisode, end).all() as { results: AnimeEpisode[] };

    let processedCount = 0;
    const errors: string[] = [];

    // Process each episode (simplified - in production use queue/durable objects)
    for (const episode of episodes) {
      try {
        // Step 1: Generate script
        if (!episode.script) {
          const script = await generateScript(episode.novel_chunk || '', episode.episode_num, apiKey);
          await c.env.DB.prepare(`
            UPDATE anime_episodes 
            SET script = ?, status = 'script', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(script, episode.id).run();
          episode.script = script;
        }

        // Step 2: Generate storyboard
        if (!episode.storyboard_json) {
          const storyboard = await generateStoryboard(episode.script, apiKey);
          await c.env.DB.prepare(`
            UPDATE anime_episodes 
            SET storyboard_json = ?, status = 'storyboard', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(JSON.stringify(storyboard), episode.id).run();
        }

        // Step 3: Generate audio via Edge TTS (optional - can be done during video generation)
        // Step 4: Generate video (placeholder - requires Veo API)

        // Mark as done for now (until video generation is implemented)
        await c.env.DB.prepare(`
          UPDATE anime_episodes 
          SET status = 'done', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(episode.id).run();

        processedCount++;
      } catch (error) {
        const errMsg = `Episode ${episode.episode_num}: ${(error as Error).message}`;
        errors.push(errMsg);
        
        await c.env.DB.prepare(`
          UPDATE anime_episodes 
          SET status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind((error as Error).message, episode.id).run();
      }
    }

    // Update project status
    const finalStatus = errors.length === episodes.length ? 'error' : 'done';
    await c.env.DB.prepare(`
      UPDATE anime_projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(finalStatus, projectId).run();

    return c.json({
      success: true,
      processed: processedCount,
      total: episodes.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==================== AI Generation Functions ====================

async function generateScript(novelChunk: string, episodeNum: number, apiKey: string): Promise<string> {
  const prompt = `你是一个专业的动漫剧本作家。请将以下小说片段转换为第${episodeNum}集的动漫剧本。

要求：
1. 剧本时长控制在90-120秒（约500-800字）
2. 包含场景描述、角色对白、动作指示
3. 对白要简洁有力，适合配音
4. 保持原作的情感和节奏

小说片段：
${novelChunk.slice(0, 5000)}

请直接输出剧本内容，不要包含其他解释。`;

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function generateStoryboard(script: string, apiKey: string): Promise<StoryboardShot[]> {
  const prompt = `你是一个专业的动漫分镜师。请基于以下剧本生成分镜脚本。

要求：
1. 输出JSON数组格式
2. 每个镜头包含: shot_id, description (动漫风格视觉描述), duration (秒), dialogue (对白，如有)
3. 总时长90-120秒，10-20个镜头
4. 视觉描述要详细，便于AI图像生成

剧本：
${script}

请只输出JSON数组，不要包含其他内容。格式示例：
[{"shot_id":1,"description":"阳光明媚的城市街道，高楼林立，主角站在人行道上","duration":5,"dialogue":"新的一天开始了..."}]`;

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 4096,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  
  // Extract JSON from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Failed to parse storyboard JSON');
  }

  return JSON.parse(jsonMatch[0]);
}

// Edge TTS synthesis (for future video generation)
export async function synthesizeSpeech(text: string, voice: string = 'zh-CN-YunxiNeural'): Promise<ArrayBuffer> {
  const response = await fetch('https://tts-api.doctoroyy.net/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, voice }),
  });

  if (!response.ok) {
    throw new Error(`Edge TTS error: ${response.status}`);
  }

  return response.arrayBuffer();
}
