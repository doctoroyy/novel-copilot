import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { getAIConfigFromHeaders, generateText, type AIConfig } from '../services/aiClient.js';



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

// Refactored Interfaces
interface AnimeSeriesScript {
  id: string;
  project_id: string;
  content: string; // The full script content
  outline?: string; // JSON string of outline
  created_at: string;
}

interface SerializedEpisode {
    episode_num: number;
    title?: string;
    synopsis?: string;
    // ... other metadata
}


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

// ==================== Series Script Routes ====================

// Get series script
animeRoutes.get('/projects/:id/script', async (c) => {
  const projectId = c.req.param('id');
  try {
    const script = await c.env.DB.prepare(`
      SELECT * FROM anime_series_scripts WHERE project_id = ?
    `).bind(projectId).first();

    return c.json({ success: true, script });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Generate series script
animeRoutes.post('/projects/:id/script', async (c) => {
  const projectId = c.req.param('id');
  const aiConfig = getAIConfigFromHeaders(c.req);

  if (!aiConfig?.apiKey) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 401);
  }

  try {
    // 1. Get Project Data
    const project = await c.env.DB.prepare(`
      SELECT * FROM anime_projects WHERE id = ?
    `).bind(projectId).first() as AnimeProject | null;

    if (!project) {
        return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // 2. Generate Script (Global)
    // For now, we'll process the novel text. If it's too long, we might need to chunk it. 
    // Assuming reasonable size for "Anime Project" (likely a few chapters).
    // If user selected 100 chapters, this will fail context window. 
    // We should warn or implement chained generation. 
    // For this MVP step, we will assume it fits or truncate/summarize.
    
    const scriptContent = await generateGlobalScript(project.novel_text, aiConfig);

    // 3. Save Script
    const scriptId = generateId();
    await c.env.DB.prepare(`
      INSERT INTO anime_series_scripts (id, project_id, content)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET content = excluded.content
    `).bind(scriptId, projectId, scriptContent).run();

    return c.json({ success: true, scriptId, content: scriptContent });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// ==================== Character Routes ====================

// Get characters for a project
animeRoutes.get('/projects/:id/characters', async (c) => {
  const projectId = c.req.param('id');
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM anime_characters WHERE project_id = ? ORDER BY created_at ASC
    `).bind(projectId).all();

    return c.json({ success: true, characters: results || [] });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Extract and Generate Characters
animeRoutes.post('/projects/:id/characters/generate', async (c) => {
  const projectId = c.req.param('id');
  const aiConfig = getAIConfigFromHeaders(c.req);

  if (!aiConfig?.apiKey) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 401);
  }

  try {
    // 1. Get Series Script (or fallback to Project Novel Text)
    const scriptRecord = await c.env.DB.prepare(`
        SELECT content FROM anime_series_scripts WHERE project_id = ?
    `).bind(projectId).first();

    const project = await c.env.DB.prepare(`
        SELECT novel_text FROM anime_projects WHERE id = ?
    `).bind(projectId).first();

    const sourceText = (scriptRecord?.content as string) || (project?.novel_text as string);

    if (!sourceText) {
        return c.json({ success: false, error: 'No script or novel text found' }, 404);
    }

    // 2. Extract Characters via AI
    const characters = await extractCharacters(sourceText, aiConfig);

    // 3. Save to DB (Status: pending)
    const savedCharacters = [];
    for (const char of characters) {
        const charId = generateId();
        await c.env.DB.prepare(`
            INSERT INTO anime_characters (id, project_id, name, description, status)
            VALUES (?, ?, ?, ?, 'pending')
        `).bind(charId, projectId, char.name, char.description).run();
        
        savedCharacters.push({ id: charId, ...char, status: 'pending' });
    }

    // 4. Trigger Image Generation (Async in background ideally, but here sequential for MVP)
    // We will return the list first, and let frontend trigger individual generation or batch.
    // Or we can generate one by one here if list is small. 
    // Let's just return the list so user can see them and click "Generate Images".

    return c.json({ success: true, characters: savedCharacters });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Generate Image for specific character
animeRoutes.post('/projects/:id/characters/:charId/image', async (c) => {
  const { id: projectId, charId } = c.req.param();
  const aiConfig = getAIConfigFromHeaders(c.req);

  if (!aiConfig?.apiKey) {
      return c.json({ success: false, error: 'Missing AI configuration' }, 401);
  }

  try {
      const char = await c.env.DB.prepare(`
          SELECT * FROM anime_characters WHERE id = ? AND project_id = ?
      `).bind(charId, projectId).first();

      if (!char) return c.json({ success: false, error: 'Character not found' }, 404);

      const { generateCharacterImage } = await import('../services/imageGen.js');
      
      // Returns Data URL
      const dataUrl = await generateCharacterImage(char.description as string, {
          ...aiConfig,
          imageModel: 'gemini-3-pro-preview' // Or from config
      });

      // Convert Data URL to ArrayBuffer for R2
      const base64Data = dataUrl.split(',')[1];
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Upload to R2
      const r2Key = `projects/${projectId}/characters/${charId}.png`;
      await c.env.ANIME_VIDEOS.put(r2Key, bytes.buffer, {
          httpMetadata: { contentType: 'image/png' }
      });

      // Generate a serve-able URL (Local API Proxy)
      // The frontend will load this URL
      const serveUrl = `/api/anime/projects/${projectId}/characters/${charId}/image.png`;

      // Update DB
      await c.env.DB.prepare(`
          UPDATE anime_characters 
          SET image_url = ?, status = 'generated', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
      `).bind(serveUrl, charId).run();

      return c.json({ success: true, imageUrl: serveUrl });
  } catch (error) {
      return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Serve Character Image
animeRoutes.get('/projects/:id/characters/:charId/image.png', async (c) => {
    const { id: projectId, charId } = c.req.param();
    const r2Key = `projects/${projectId}/characters/${charId}.png`;
    
    const object = await c.env.ANIME_VIDEOS.get(r2Key);
    if (!object) {
        return c.newResponse('Image not found', 404);
    }
    
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for a year
    
    return new Response(object.body, {
        headers,
    });
});

// Update Character (e.g., set Voice ID)
animeRoutes.patch('/projects/:id/characters/:charId', async (c) => {
    const { id: projectId, charId } = c.req.param();
    const { voiceId } = await c.req.json();

    try {
        if (voiceId) {
             await c.env.DB.prepare(`
                UPDATE anime_characters SET voice_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND project_id = ?
            `).bind(voiceId, charId, projectId).run();
        }
        return c.json({ success: true, message: 'Character updated' });
    } catch (error) {
        return c.json({ success: false, error: (error as Error).message }, 500);
    }
});

// List Available Voices
animeRoutes.get('/voices', async (c) => {
    const aiConfig = getAIConfigFromHeaders(c.req);
    // We don't necessarily need API key just to list static voices, but if dynamic...
    try {
        const { getVoiceProvider } = await import('../services/voiceService.js');
        const provider = getVoiceProvider(aiConfig?.apiKey); 
        const voices = await provider.getVoices();
        return c.json({ success: true, voices });
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

// Serve Episode Video (Main/Fallback)
animeRoutes.get('/projects/:projectId/episodes/:num/video', async (c) => {
    const projectId = c.req.param('projectId');
    const num = parseInt(c.req.param('num'), 10);

    try {
        const episode = await c.env.DB.prepare(`
            SELECT video_r2_key FROM anime_episodes 
            WHERE project_id = ? AND episode_num = ?
        `).bind(projectId, num).first();

        if (!episode || !episode.video_r2_key) {
            return c.newResponse('Video not found', 404);
        }

        const object = await c.env.ANIME_VIDEOS.get(episode.video_r2_key as string);
        if (!object) {
            return c.newResponse('Video object not found in storage', 404);
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        
        return new Response(object.body, {
            headers,
        });

    } catch (error) {
        return c.newResponse((error as Error).message, 500);
    }
});

// Serve Specific Shot Video
animeRoutes.get('/projects/:projectId/episodes/:num/shots/:shotId/video', async (c) => {
    const { projectId, num, shotId } = c.req.param();
    
    // Construct Key: projects/{projectId}/episodes/{num}/shot_{shotId}_video.mp4
    const key = `projects/${projectId}/episodes/${num}/shot_${shotId}_video.mp4`;

    try {
        const object = await c.env.ANIME_VIDEOS.get(key);
        if (!object) {
            return c.newResponse('Shot video not found', 404);
        }
        
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        
        return new Response(object.body, { headers });
    } catch (error) {
        return c.newResponse((error as Error).message, 500);
    }
});

// Serve Specific Shot Audio
animeRoutes.get('/projects/:projectId/episodes/:num/shots/:shotId/audio', async (c) => {
    const { projectId, num, shotId } = c.req.param();
    
    // Construct Key: projects/{projectId}/episodes/{num}/shot_{shotId}_audio.mp3
    const key = `projects/${projectId}/episodes/${num}/shot_${shotId}_audio.mp3`;

    try {
        const object = await c.env.ANIME_VIDEOS.get(key);
        if (!object) {
            return c.newResponse('Shot audio not found', 404);
        }
        
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        
        return new Response(object.body, { headers });
    } catch (error) {
        return c.newResponse((error as Error).message, 500);
    }
});

// Regenerate Shot
animeRoutes.post('/projects/:projectId/episodes/:num/shots/:shotId/regenerate', async (c) => {
    const { projectId, num, shotId: shotIdStr } = c.req.param();
    const shotId = parseInt(shotIdStr, 10);
    const aiConfig = getAIConfigFromHeaders(c.req);

    if (!aiConfig?.apiKey) {
        return c.json({ success: false, error: 'Missing AI Key' }, 401);
    }

    try {
        // 1. Get Episode
        const episode = await c.env.DB.prepare(`
            SELECT * FROM anime_episodes WHERE project_id = ? AND episode_num = ?
        `).bind(projectId, num).first();

        if (!episode || !episode.storyboard_json) {
             return c.json({ success: false, error: 'Episode not found' }, 404);
        }

        let storyboard: any[] = JSON.parse(episode.storyboard_json);
        const shotIndex = storyboard.findIndex((s: any) => s.shot_id === shotId);
        
        if (shotIndex === -1) {
             return c.json({ success: false, error: 'Shot not found' }, 404);
        }

        const shot = storyboard[shotIndex];

        // 2. Clear existing keys & error
        shot.video_key = null;
        shot.audio_key = null;
        shot.status = 'pending';
        shot.error = undefined;

        // 3. Save "Pending" state first
        storyboard[shotIndex] = shot;
        await c.env.DB.prepare(`
            UPDATE anime_episodes 
            SET storyboard_json = ?, status = 'processing', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).bind(JSON.stringify(storyboard), episode.id).run();

        // 4. Trigger Generation (Inline or Re-call generate endpoint??)
        // Since we want immediate feedback for this single shot, logic dictates we do it here.
        // We can reuse the logic block.
        
        const { getVoiceProvider } = await import('../services/voiceService.js');
        // aiConfig is guaranteed to have apiKey due to check above
        const voiceProvider = getVoiceProvider(aiConfig.apiKey);
        
        const { generateVideoWithVeo } = await import('../services/veoClient.js');

        // Look up characters (duplicate logic, should refactor helper)
        const characters = await c.env.DB.prepare(`
             SELECT name, image_url, voice_id FROM anime_characters 
             WHERE project_id = ? AND status = 'generated' AND image_url IS NOT NULL
        `).bind(projectId).all();
         
        const charImageUrls = (characters.results || []).map((c: any) => c.image_url as string).filter(url => !!url);
        const charVoices = (characters.results || []).reduce((acc: any, char: any) => {
             if (char.voice_id) acc[char.name] = char.voice_id;
             return acc;
        }, {});


        let updated = false;

        // --- TTS ---
        if (shot.dialogue || shot.narration_text || shot.narration) {
            const text = shot.dialogue || shot.narration_text || shot.narration;
            try {
                 let voiceId = 'Puck'; 
                 const colonIndex = text.indexOf('：');
                 if (colonIndex > -1 && colonIndex < 10) {
                      const name = text.substring(0, colonIndex);
                      const bestMatch = Object.keys(charVoices).find(cn => name.includes(cn) || cn.includes(name));
                      if (bestMatch && charVoices[bestMatch]) voiceId = charVoices[bestMatch];
                 }

                 const audioBuffer = await voiceProvider.generateSpeech(text, voiceId);
                 const audioKey = `projects/${projectId}/episodes/${num}/shot_${shotId}_audio.mp3`;
                 await c.env.ANIME_VIDEOS.put(audioKey, audioBuffer, { httpMetadata: { contentType: 'audio/mpeg' } });
                 shot.audio_key = audioKey;
                 updated = true;
            } catch (err) {
                 shot.status = 'error';
                 shot.error = 'TTS Error: ' + (err as Error).message;
                 updated = true;
            }
        }

        // --- Video ---
        if (shot.status !== 'error') { // Only proceed if TTS didn't fail hard (or allow partial?)
             try {
                // Sanitize prompt
                const promptParts = [
                    'Cinematic Chinese Manhua Animation',
                    shot.description || shot.visual_description,
                    shot.action || shot.action_motion,
                    'No text, no subtitles, high quality'
                ].filter(p => !!p);
                const shotPrompt = promptParts.join('. ');

                const videoTempUrl = await generateVideoWithVeo(shotPrompt, charImageUrls, aiConfig);
                const videoRes = await fetch(videoTempUrl);
                if (!videoRes.ok) throw new Error(`Download failed: ${videoRes.statusText}`);
                const videoBuffer = await videoRes.arrayBuffer();

                const videoKey = `projects/${projectId}/episodes/${num}/shot_${shotId}_video.mp4`;
                await c.env.ANIME_VIDEOS.put(videoKey, videoBuffer, { httpMetadata: { contentType: 'video/mp4' } });
                shot.video_key = videoKey;
                updated = true;
             } catch (err) {
                 shot.status = 'error';
                 shot.error = 'Video Error: ' + (err as Error).message;
                 updated = true;
             }
        }

        // 5. Save Final State
        if (updated) {
             storyboard[shotIndex] = shot;
             await c.env.DB.prepare(`
                 UPDATE anime_episodes SET storyboard_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
             `).bind(JSON.stringify(storyboard), episode.id).run();
        }

        return c.json({ success: true, shot });

    } catch (error) {
        return c.json({ success: false, error: (error as Error).message }, 500);
    }
});

// ==================== Generation Routes ====================

// Trigger generation for a project
animeRoutes.post('/projects/:id/generate', async (c) => {
  const projectId = c.req.param('id');

  try {
    // Read API config from headers
    const aiConfig = getAIConfigFromHeaders(c.req);
    
    const { startEpisode = 1, endEpisode } = await c.req.json();

    if (!aiConfig?.apiKey) {
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
        // Step 1: Generate Script & Storyboard (Merged)
        // If we don't have a storyboard yet, regenerate everything or allow partial updates?
        // Current logic: checks if (!episode.script).
        // New logic: generate JSON script.
        
        if (!episode.storyboard_json) {
           const { eventBus } = await import('../eventBus.js');
           eventBus.progress({
             projectName: project.name,
             current: processedCount,
             total: episodes.length,
             chapterIndex: episode.episode_num,
             status: 'planning', // Scripting/Storyboarding merged
             message: `正在设计第 ${episode.episode_num} 集分镜脚本 (Gemini 3 Flash)...`,
           });

           // Use the new prompt which returns JSON
           const rawScriptJson = await generateScript(episode.novel_chunk || '', episode.episode_num, aiConfig!);
           
           // Clean and Parse
           const jsonText = rawScriptJson.replace(/```json\s*|```\s*/g, '').trim();
           let storyboard = [];
           try {
              storyboard = JSON.parse(jsonText);
              // Handle if it's wrapped in { scenes: [] } or just []
              if (!Array.isArray(storyboard) && (storyboard as any).scenes) {
                  storyboard = (storyboard as any).scenes;
              }
           } catch (e) {
               console.error('Failed to parse storyboard JSON', e);
               throw new Error('Script generation failed to produce valid JSON');
           }
           
           // Create a readable script string for the UI 'Script' tab
           const readableScript = storyboard.map((s: any) => 
               `[Shot ${s.shot_id || s.id}] ${s.visual_description || s.visual_prompt}\nAction: ${s.action_motion || s.action_description}\nNarration: ${s.narration_text || s.narration}`
           ).join('\n\n');

           // Map to our internal storyboard format if keys differ
           const refinedStoryboard = storyboard.map((s: any, idx: number) => ({
               shot_id: s.shot_id || idx + 1,
               description: s.visual_description || s.visual_prompt,
               action: s.action_motion || s.action_description,
               dialogue: s.narration_text || s.narration,
               duration: s.duration || 5
           }));

           await c.env.DB.prepare(`
             UPDATE anime_episodes 
             SET script = ?, storyboard_json = ?, status = 'storyboard', updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
           `).bind(readableScript, JSON.stringify(refinedStoryboard), episode.id).run();
           
           episode.script = readableScript;
           episode.storyboard_json = JSON.stringify(refinedStoryboard);
        }

        // Step 2: Skip old generateStoryboard call (it's now done above)

            // Step 4: Generate video via Veo 3.1
        if (episode.storyboard_json) {
            const { generateVideoWithVeo } = await import('../services/veoClient.js');
            // const { synthesizeSpeech } = await import('../routes/anime.js'); // Use voice provider instead
            const { eventBus } = await import('../eventBus.js');

            let storyboard: any[] = [];
            try {
                storyboard = JSON.parse(episode.storyboard_json);
            } catch (e) {
                console.error('Failed to parse storyboard for generation', e);
                throw new Error('Invalid storyboard JSON');
            }

            // Fetch validated characters and their voices
            const characters = await c.env.DB.prepare(`
                SELECT name, image_url, voice_id FROM anime_characters 
                WHERE project_id = ? AND status = 'generated' AND image_url IS NOT NULL
            `).bind(projectId).all();
            
            const charImageUrls = (characters.results || [])
                .map((c: any) => c.image_url)
                .filter((url: string) => !!url); // Ensure no nulls
            
            const charVoices = (characters.results || []).reduce((acc: any, char: any) => {
                if (char.voice_id) acc[char.name] = char.voice_id;
                return acc;
            }, {});

            const { getVoiceProvider } = await import('../services/voiceService.js');
            const voiceProvider = getVoiceProvider(aiConfig?.apiKey);

            // Process all shots (resume logic will skip completed ones)
            const shotsToProcess = storyboard; 

            for (let i = 0; i < shotsToProcess.length; i++) {
                const shot = shotsToProcess[i];
                
                // RESUME LOGIC: Skip if already done
                if (shot.video_key && shot.audio_key) {
                    console.log(`Shot ${shot.shot_id} already has video/audio. Skipping.`);
                    continue;
                }

                eventBus.progress({
                    projectName: project.name,
                    current: processedCount,
                    total: episodes.length,
                    chapterIndex: episode.episode_num,
                    status: 'generating', 
                    message: `正在生成第 ${episode.episode_num} 集 - 镜头 ${shot.shot_id} (视频+TTS)...`,
                });

                let updated = false;

                if (!shot.audio_key && (shot.dialogue || shot.narration_text || shot.narration)) {
                    const text = shot.dialogue || shot.narration_text || shot.narration;
                    try {
                        // Find speaker voice
                        // Heuristic: If dialogue starts with "Name:", or if we have speaker field (not yet in storyboard)
                        // For now, let's assume random or default, unless we parse "Name: ..." from dialogue??
                        // The extraction prompt didn't strictly enforcing "Name: Content".
                        // Use a default voice if no specific binding found or random.
                        // Ideally strictly bind speaker in storyboard. 
                        // For this MVP, let's pick a default voice or the first character's voice.
                        
                        let voiceId = 'Puck'; // Default
                        
                        // Try to find speaker name in text (e.g. "陈宁：...")
                        const colonIndex = text.indexOf('：');
                        if (colonIndex > -1 && colonIndex < 10) {
                             const name = text.substring(0, colonIndex);
                             // matching logic... (simple substring match)
                             const bestMatch = Object.keys(charVoices).find(cn => name.includes(cn) || cn.includes(name));
                             if (bestMatch && charVoices[bestMatch]) {
                                 voiceId = charVoices[bestMatch];
                             }
                        }

                        const audioBuffer = await voiceProvider.generateSpeech(text, voiceId);
                        const audioKey = `projects/${projectId}/episodes/${episode.episode_num}/shot_${shot.shot_id}_audio.mp3`;
                        await c.env.ANIME_VIDEOS.put(audioKey, audioBuffer, {
                            httpMetadata: { contentType: 'audio/mpeg' }
                        });
                        shot.audio_key = audioKey;
                        updated = true;
                        // For backward compat or main audio
                        if (i === 0) episode.audio_r2_key = audioKey; 
                    } catch (err) {
                        console.error(`TTS failed for shot ${shot.shot_id}`, err);
                        shot.status = 'error';
                        shot.error = (err as Error).message || 'Unknown TTS error';
                        updated = true; // Even if failed, we want to save the status so UI shows error
                    }
                }

                // 2. Video Generation (Veo)
                if (!shot.video_key) {
                    try {
                        // Specific prompt for this shot - Sanitize inputs
                        const promptParts = [
                            'Cinematic Chinese Manhua Animation',
                            shot.description || shot.visual_description,
                            shot.action || shot.action_motion,
                            'No text, no subtitles, high quality'
                        ].filter(p => !!p); // Remove null/undefined/empty
                        
                        const shotPrompt = promptParts.join('. ');
                        
                        const videoTempUrl = await generateVideoWithVeo(
                            shotPrompt, 
                            charImageUrls, 
                            { ...aiConfig }
                        );

                        // Download and Upload to R2
                        const videoRes = await fetch(videoTempUrl);
                         if (!videoRes.ok) throw new Error(`Download failed: ${videoRes.statusText}`);
                        const videoBuffer = await videoRes.arrayBuffer();

                        const videoKey = `projects/${projectId}/episodes/${episode.episode_num}/shot_${shot.shot_id}_video.mp4`;
                        await c.env.ANIME_VIDEOS.put(videoKey, videoBuffer, {
                            httpMetadata: { contentType: 'video/mp4' }
                        });
                        
                        shot.video_key = videoKey;
                        updated = true;
                        // For backward compat, set main video key to first shot
                        if (i === 0) episode.video_r2_key = videoKey; 

                    } catch (err) {
                         console.error(`Veo failed for shot ${shot.shot_id}`, err);
                         // Continue to next shot but save what we have
                    }
                }

                // SAVE PROGRESS: Update DB after each shot
                if (updated) {
                    await c.env.DB.prepare(`
                        UPDATE anime_episodes 
                        SET storyboard_json = ?, video_r2_key = ?, audio_r2_key = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `).bind(JSON.stringify(storyboard), episode.video_r2_key || null, episode.audio_r2_key || null, episode.id).run();
                }
            }

            // Final status update
            await c.env.DB.prepare(`
                UPDATE anime_episodes 
                SET status = 'done', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(episode.id).run();
        }

        processedCount++;
      } catch (error) {
        const errMsg = `Episode ${episode.episode_num}: ${(error as Error).message}`;
        errors.push(errMsg);
        
        const { eventBus } = await import('../eventBus.js');
        
        // Emit progress update
        eventBus.progress({
          projectName: project.name,
          current: processedCount,
          total: episodes.length,
          chapterIndex: episode.episode_num || 0,
          status: 'error',
          message: `第 ${episode.episode_num} 集出错: ${(error as Error).message}`,
        });

        // Emit persistent log
        eventBus.error(`第 ${episode.episode_num} 集生成失败: ${(error as Error).message}`, project.name);

        
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

async function extractCharacters(text: string, aiConfig: AIConfig): Promise<Array<{name: string, description: string}>> {
    const system = `你是一个专业的动漫角色设计师。`;
    const prompt = `请从以下剧本/小说内容中提取主要角色（Main Characters）。
    
要求：
1. 提取 3-6 个核心角色。
2. 为每个角色生成一段详细的"Prompt"（中文），用于传递给 AI 模型。避免出现英文。
3. Prompt 格式：(角色名), (外貌标签), (服饰), (风格: 动漫风格, 色彩鲜艳, 高细节)。
4. 返回 JSON 数组：[{"name": "...", "description": "..."}]

内容：
${text.slice(0, 10000)}

请只输出 JSON。`;

    const raw = await generateText(aiConfig, {
        system,
        prompt,
        temperature: 0.5
    });

    try {
        const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
        const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch (e) {
        console.error('Failed to parse character extraction', e);
        return [];
    }
}

async function generateGlobalScript(novelText: string, aiConfig: AIConfig): Promise<string> {
  const system = `你是一个专业的动漫编剧统筹。`;
  const prompt = `请将以下小说内容（或节选）改编为动漫的"系列构成"（Global Series Script）。
  
要求：
1. 输出整部动漫的剧情大纲、核心冲突、人物小传。
2. 规划每一集的核心事件（Episode Outline）。
3. 如果内容较长，请重点输出前几集的详细剧本大纲。
4. 保持格式清晰，使用 Markdown。

小说内容：
${novelText.slice(0, 50000)} ... (已截断)

请输出完整的系列构成方案。`;

  return await generateText(aiConfig, {
    system,
    prompt,
    temperature: 0.7,
    maxTokens: 4000
  });
}

async function generateScript(novelChunk: string, episodeNum: number, aiConfig: AIConfig): Promise<string> {
    // User's detailed prompt for high-quality dynamic manhua script
    const SYSTEM_INSTRUCTION_SCRIPTWRITER = `
你是一位顶级“动态漫”导演。你的目标是创作具有极强视觉张力、类似于 B 站/抖音爆款悬疑漫剧的作品。
你的任务是将小说文本重构为带有【动态指令】的分镜脚本。

视觉规范：
1. **风格定位**：极致写实国漫风格 (Ultra-Realistic Manhua Concept Art)。光影必须深邃，具有强烈的电影质感（Cinematic Lighting）。
2. **动作指令 (Motion)**：每个分镜必须包含具体的动态。例如：“角色缓慢转头看向镜头”、“背景火光跳动”、“雨水划过玻璃”、“瞳孔微颤”。
3. **镜头语言**：
   - 使用 **Extreme Close-up (特写)** 表现情绪。
   - 使用 **Tracking Shot (推镜头)** 增强代入感。
4. **纯净画面**：严禁出现任何文字、气泡、UI。
5. **角色标签**：为主角设定独特的视觉记忆点（如：左眼下的泪痣、被冷汗浸湿的碎发、标志性的红色耳坠）。

输出内容：
- **Shot ID**: 镜头编号
- **Visual**: 画面主体及环境描述 (Visual Description, English)
- **Action**: 专门针对视频生成的动作描述词 (Action Motion, English) (e.g., slow tilt, subtle eye movement, hair flowing in wind)
- **Narration**: 富有张力的悬疑旁白 (Chinese)

请以 JSON 格式输出数组，结构如下：
[
  {
    "shot_id": 1,
    "visual_description": "...",
    "action_motion": "...",
    "narration_text": "...",
    "duration": 5
  }
]
`;

    const prompt = `请将以下小说片段转换为第${episodeNum}集的动漫剧本。

小说片段：
${novelChunk.slice(0, 4000)}

请直接输出 JSON，不要包含 Markdown 标记。`;

    return await generateText(aiConfig, {
        system: SYSTEM_INSTRUCTION_SCRIPTWRITER,
        prompt,
        temperature: 0.7
    });
}


async function generateStoryboard(script: string, aiConfig: AIConfig): Promise<StoryboardShot[]> {
  const system = `你是一个专业的动漫分镜师。`;
  const prompt = `请基于以下剧本生成分镜脚本。

要求：
1. 输出JSON数组格式
2. 每个镜头包含: shot_id, description (动漫风格视觉描述), duration (秒), dialogue (对白，如有)
3. 总时长90-120秒，10-20个镜头
4. 视觉描述要详细，便于AI图像生成
5. 只输出纯 JSON，不要包含 Markdown 标记

剧本：
${script}

格式示例：
[{"shot_id":1,"description":"阳光明媚的城市街道，高楼林立，主角站在人行道上","duration":5,"dialogue":"新的一天开始了..."}]`;

  const raw = await generateText(aiConfig, {
    system,
    prompt,
    temperature: 0.5
  });

  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
  
  // Extract JSON from response if still wrapped
  const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
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
