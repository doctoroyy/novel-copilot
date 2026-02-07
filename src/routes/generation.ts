import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { generateText, type AIConfig } from '../services/aiClient.js';
import { writeOneChapter } from '../generateChapter.js';
import { writeEnhancedChapter } from '../enhancedChapterEngine.js';
import type { CharacterStateRegistry } from '../types/characterState.js';
import type { PlotGraph } from '../types/plotGraph.js';
import type { NarrativeArc, EnhancedChapterOutline } from '../types/narrative.js';
import { initializeRegistryFromGraph } from '../context/characterStateManager.js';
import { createEmptyPlotGraph } from '../types/plotGraph.js';
import { generateNarrativeArc } from '../narrative/pacingController.js';
import { createGenerationTask, updateTaskProgress, completeTask, checkRunningTask, updateTaskMessage } from './tasks.js';

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
  const startChapter = vol.startChapter ?? vol.start_chapter ?? (volIndex * 80 + 1);
  const endChapter = vol.endChapter ?? vol.end_chapter ?? ((volIndex + 1) * 80);

  return {
    title: vol.title || vol.volumeTitle || vol.volume_title || `第${volIndex + 1}卷`,
    startChapter,
    endChapter,
    goal: vol.goal || vol.summary || vol.volume_goal || '',
    conflict: vol.conflict || '',
    climax: vol.climax || '',
    // Use startChapter + i as the correct fallback index for each chapter
    chapters: chapters.map((ch, i) => normalizeChapter(ch, startChapter + i)),
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

// Validate outline for coverage and quality
function validateOutline(outline: any, targetChapters: number): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check total chapter coverage
  let totalChaptersInOutline = 0;
  const allIndices = new Set<number>();

  for (const vol of outline.volumes || []) {
    for (const ch of vol.chapters || []) {
      totalChaptersInOutline++;
      allIndices.add(ch.index);

      // Check for placeholder titles
      if (!ch.title || ch.title.match(/^第?\d+章?$/) || ch.title.includes('待补充')) {
        issues.push(`第${ch.index}章标题缺失或为占位符`);
      }

      // Check for missing goals
      if (!ch.goal || ch.goal === '待补充' || ch.goal.length < 10) {
        issues.push(`第${ch.index}章目标缺失或过短`);
      }
    }
  }

  // Check for missing indices
  for (let i = 1; i <= targetChapters; i++) {
    if (!allIndices.has(i)) {
      issues.push(`缺失第${i}章`);
    }
  }

  // Check total count
  if (totalChaptersInOutline !== targetChapters) {
    issues.push(`章节总数不匹配: 实际${totalChaptersInOutline}章 vs 目标${targetChapters}章`);
  }


  return {
    valid: issues.length === 0,
    issues: issues.slice(0, 20), // Limit to first 20 issues
  };
}

// Generate outline (streaming SSE to avoid Workers timeout)
generationRoutes.post('/projects/:name/outline', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  const aiConfig = getAIConfigFromHeaders(c);

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  const encoder = new TextEncoder();

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      // Helper to send SSE event
      const sendEvent = (type: string, data: any) => {
        const payload = JSON.stringify({ type, ...data });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      // Heartbeat to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: {"type":"heartbeat"}\n\n`));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 5000);

      try {
        const { targetChapters = 400, targetWordCount = 100, customPrompt } = await c.req.json();

        sendEvent('start', { targetChapters, targetWordCount });

        // Get project (user-scoped)
        const project = await c.env.DB.prepare(`
          SELECT id, bible FROM projects WHERE name = ? AND deleted_at IS NULL AND user_id = ?
        `).bind(name, userId).first();

        if (!project) {
          sendEvent('error', { error: 'Project not found' });
          controller.close();
          clearInterval(heartbeatInterval);
          return;
        }

        let bible = (project as any).bible;
        if (customPrompt) {
          bible = `${bible}\n\n## 用户自定义要求\n${customPrompt}`;
        }

        console.log(`Starting outline generation for ${name}: ${targetChapters} chapters, ${targetWordCount}万字`);

        // Phase 1: Generate master outline
        sendEvent('progress', { phase: 1, message: '正在生成总体大纲...' });
        console.log('Phase 1: Generating master outline...');
        const masterOutline = await generateMasterOutline(aiConfig, bible, targetChapters, targetWordCount);
        const totalVolumes = masterOutline.volumes?.length || 0;
        console.log(`Master outline generated: ${totalVolumes} volumes`);
        sendEvent('master_outline', { totalVolumes, mainGoal: masterOutline.mainGoal });

        // Phase 2: Generate volume chapters
        const volumes = [];
        for (let i = 0; i < masterOutline.volumes.length; i++) {
          const vol = masterOutline.volumes[i];
          const previousVolumeEndState = i > 0 
            ? masterOutline.volumes[i - 1].volumeEndState || 
              `${masterOutline.volumes[i - 1].climax}（主角已达成：${masterOutline.volumes[i - 1].goal}）`
            : null;
          
          sendEvent('progress', { 
            phase: 2, 
            volumeIndex: i + 1, 
            totalVolumes, 
            volumeTitle: vol.title,
            message: `正在生成第 ${i + 1}/${totalVolumes} 卷「${vol.title}」的章节...` 
          });
          console.log(`Phase 2.${i + 1}: Generating chapters for volume ${i + 1}/${totalVolumes} "${vol.title}"...`);
          
          const chapters = await generateVolumeChapters(aiConfig, bible, masterOutline, vol, previousVolumeEndState);
          const normalizedVolume = normalizeVolume(vol, i, chapters);
          volumes.push(normalizedVolume);
          
          sendEvent('volume_complete', { 
            volumeIndex: i + 1, 
            totalVolumes, 
            volumeTitle: normalizedVolume.title,
            chapterCount: normalizedVolume.chapters?.length || 0
          });
        }

        const outline = {
          totalChapters: targetChapters,
          targetWordCount,
          volumes,
          mainGoal: masterOutline.mainGoal || '',
          milestones: normalizeMilestones(masterOutline.milestones || []),
        };

        // Phase 3: Validate
        sendEvent('progress', { phase: 3, message: '正在验证大纲...' });
        console.log('Phase 3: Validating outline...');
        const validation = validateOutline(outline, targetChapters);
        if (!validation.valid) {
          console.warn('Outline validation issues:', validation.issues);
        }

        // Save outline
        await c.env.DB.prepare(`
          INSERT OR REPLACE INTO outlines (project_id, outline_json) VALUES (?, ?)
        `).bind((project as any).id, JSON.stringify(outline)).run();

        // Update state
        await c.env.DB.prepare(`
          UPDATE states SET total_chapters = ? WHERE project_id = ?
        `).bind(targetChapters, (project as any).id).run();

        console.log(`Outline generation complete for ${name}!`);

        sendEvent('done', { 
          success: true, 
          outline,
          validation: validation.valid ? undefined : validation 
        });

        clearInterval(heartbeatInterval);
        controller.close();
      } catch (error) {
        sendEvent('error', { error: (error as Error).message });
        clearInterval(heartbeatInterval);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

// Generate chapters
generationRoutes.post('/projects/:name/generate', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  const aiConfig = getAIConfigFromHeaders(c);
  
  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const { chaptersToGenerate = 1 } = await c.req.json();

    // Get project with state and outline
    const project = await c.env.DB.prepare(`
      SELECT p.id, p.bible, s.*, o.outline_json, c.characters_json
      FROM projects p
      JOIN states s ON p.id = s.project_id
      LEFT JOIN outlines o ON p.id = o.project_id
      LEFT JOIN characters c ON p.id = c.project_id
      WHERE p.name = ? AND p.user_id = ?
    `).bind(name, userId).first() as any;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // Validate state: check if nextChapterIndex matches actual chapter data
    const maxChapterResult = await c.env.DB.prepare(`
      SELECT MAX(chapter_index) as max_index FROM chapters WHERE project_id = ? AND deleted_at IS NULL
    `).bind(project.id).first() as any;

    const actualMaxChapter = maxChapterResult?.max_index || 0;
    const expectedNextIndex = actualMaxChapter + 1;

    if (project.next_chapter_index !== expectedNextIndex) {
      console.log(`State mismatch: next_chapter_index=${project.next_chapter_index}, actual max=${actualMaxChapter}. Auto-correcting to ${expectedNextIndex}`);
      project.next_chapter_index = expectedNextIndex;
      await c.env.DB.prepare(`
        UPDATE states SET next_chapter_index = ? WHERE project_id = ?
      `).bind(expectedNextIndex, project.id).run();
    }

    const outline = project.outline_json ? JSON.parse(project.outline_json) : null;
    const characters = project.characters_json ? JSON.parse(project.characters_json) : undefined;
    const results: { chapter: number; title: string }[] = [];

    // Store the starting index BEFORE the loop to avoid double-increment bug
    const startingChapterIndex = project.next_chapter_index;

    for (let i = 0; i < chaptersToGenerate; i++) {
      // Use the ORIGINAL starting index + i, NOT the constantly-updating project.next_chapter_index
      const chapterIndex = startingChapterIndex + i;
      if (chapterIndex > project.total_chapters) break;

      // Get last 2 chapters
      const { results: lastChapters } = await c.env.DB.prepare(`
        SELECT content FROM chapters 
        WHERE project_id = ? AND chapter_index >= ? AND deleted_at IS NULL
        ORDER BY chapter_index DESC LIMIT 2
      `).bind(project.id, Math.max(1, chapterIndex - 2)).all();

      // Get chapter goal from outline
      let chapterGoalHint: string | undefined;
      let outlineTitle: string | undefined;
      if (outline) {
        for (const vol of outline.volumes) {
          const ch = vol.chapters?.find((c: any) => c.index === chapterIndex);
          if (ch) {
            outlineTitle = ch.title;
            chapterGoalHint = `【章节大纲】\n- 标题: ${ch.title}\n- 目标: ${ch.goal}\n- 章末钩子: ${ch.hook}`;
            break;
          }
        }
      }

      // Generate chapter
      const result = await writeOneChapter({
        aiConfig,
        bible: project.bible,
        rollingSummary: project.rolling_summary || '',
        openLoops: JSON.parse(project.open_loops || '[]'),
        lastChapters: lastChapters.map((c: any) => c.content).reverse(),
        chapterIndex,
        totalChapters: project.total_chapters,
        chapterGoalHint,
        chapterTitle: outlineTitle,
        characters,
        onProgress: (message, status) => {
          // Import eventBus dynamically to avoid top-level side effects if possible, or just use it
          import('../eventBus.js').then(({ eventBus }) => {
            eventBus.progress({
              projectName: name,
              current: i,
              total: chaptersToGenerate,
              chapterIndex,
              status: status || 'generating',
              message,
            });
          });
        },
      });


      const chapterText = result.chapterText;

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
        UPDATE states SET 
          next_chapter_index = ?,
          rolling_summary = ?,
          open_loops = ?
        WHERE project_id = ?
      `).bind(
        chapterIndex + 1,
        result.updatedSummary,
        JSON.stringify(result.updatedOpenLoops),
        project.id
      ).run();

      // Update project object for next iteration in loop
      project.rolling_summary = result.updatedSummary;
      project.open_loops = JSON.stringify(result.updatedOpenLoops);
      project.next_chapter_index = chapterIndex + 1;
    }

    return c.json({ success: true, generated: results });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Streaming chapter generation with SSE
generationRoutes.post('/projects/:name/generate-stream', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  const aiConfig = getAIConfigFromHeaders(c);

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  const encoder = new TextEncoder();

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      // Track if client is still connected
      let clientConnected = true;

      // Helper to send SSE event - silently fails if client disconnected
      const sendEvent = (type: string, data: any) => {
        if (!clientConnected) return; // Skip if already disconnected
        try {
          const payload = JSON.stringify({ type, ...data });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          // Client disconnected, mark as disconnected but continue generation
          clientConnected = false;
          console.log(`Client disconnected, continuing generation in background...`);
        }
      };

      // Heartbeat to keep connection alive
      const heartbeatInterval = setInterval(() => {
        if (!clientConnected) {
          clearInterval(heartbeatInterval);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: {"type":"heartbeat"}\n\n`));
        } catch {
          clientConnected = false;
          clearInterval(heartbeatInterval);
        }
      }, 5000);
      
      let dbHeartbeatInterval: ReturnType<typeof setInterval> | undefined;

      try {
        const { chaptersToGenerate = 1 } = await c.req.json();

        sendEvent('start', { total: chaptersToGenerate });

        // Get project with state and outline (user-scoped)
        const project = await c.env.DB.prepare(`
          SELECT p.id, p.bible, s.*, o.outline_json, c.characters_json
          FROM projects p
          JOIN states s ON p.id = s.project_id
          LEFT JOIN outlines o ON p.id = o.project_id
          LEFT JOIN characters c ON p.id = c.project_id
          WHERE p.name = ? AND p.user_id = ?
        `).bind(name, userId).first() as any;

        if (!project) {
          sendEvent('error', { error: 'Project not found' });
          controller.close();
          clearInterval(heartbeatInterval);
          return;
        }

        // Validate state
        const maxChapterResult = await c.env.DB.prepare(`
          SELECT MAX(chapter_index) as max_index FROM chapters WHERE project_id = ? AND deleted_at IS NULL
        `).bind(project.id).first() as any;

        const actualMaxChapter = maxChapterResult?.max_index || 0;
        const expectedNextIndex = actualMaxChapter + 1;

        if (project.next_chapter_index !== expectedNextIndex) {
          project.next_chapter_index = expectedNextIndex;
          await c.env.DB.prepare(`
            UPDATE states SET next_chapter_index = ? WHERE project_id = ?
          `).bind(expectedNextIndex, project.id).run();
        }

        const outline = project.outline_json ? JSON.parse(project.outline_json) : null;
        const characters = project.characters_json ? JSON.parse(project.characters_json) : undefined;
        const results: { chapter: number; title: string }[] = [];
        const failedChapters: number[] = [];

        const startingChapterIndex = project.next_chapter_index;

        // Check if there's already a running task
        // If so, and we are here, it implies the client wants to start fresh (or we should error)
        // But since we simplified the frontend to cancel old tasks, we can assume we are good to go.
        // However, just in case, we can check.
        const { isRunning } = await checkRunningTask(c.env.DB, project.id);
        if (isRunning) {
           // If a task is still appearing as running, we should just let the new one proceed
           // (Assuming user clicked "Continue" which executed cancelAllActiveTasks)
           // But if cancel failed, we might have 2 running tasks.
           // Let's just log it.
           console.warn('Starting new task while another might be running');
        }

        // Create generation task for persistence
        const taskId = await createGenerationTask(
          c.env.DB,
          project.id,
          userId!,
          chaptersToGenerate,
          startingChapterIndex
        );
        sendEvent('task_created', { taskId });

        // No more heartbeat interval needed for simple generation (unless preventing timeout?)
        // Standard generation logic follows



        for (let i = 0; i < chaptersToGenerate; i++) {
          const chapterIndex = startingChapterIndex + i;
          if (chapterIndex > project.total_chapters) break;

          sendEvent('progress', {
            current: i + 1,
            total: chaptersToGenerate,
            chapterIndex,
            status: 'preparing',
            message: `准备生成第 ${chapterIndex} 章...`,
          });

          // Update task progress in DB for cross-device sync
          await updateTaskMessage(c.env.DB, taskId, `正在生成第 ${chapterIndex} 章...`, chapterIndex);

          try {
            // Get last 2 chapters
            const { results: lastChapters } = await c.env.DB.prepare(`
              SELECT content FROM chapters 
              WHERE project_id = ? AND chapter_index >= ? AND deleted_at IS NULL
              ORDER BY chapter_index DESC LIMIT 2
            `).bind(project.id, Math.max(1, chapterIndex - 2)).all();

            // Get chapter goal from outline
            let chapterGoalHint: string | undefined;
            let outlineTitle: string | undefined;
            if (outline) {
              for (const vol of outline.volumes) {
                const ch = vol.chapters?.find((c: any) => c.index === chapterIndex);
                if (ch) {
                  outlineTitle = ch.title;
                  chapterGoalHint = `【章节大纲】\n- 标题: ${ch.title}\n- 目标: ${ch.goal}\n- 章末钩子: ${ch.hook}`;
                  break;
                }
              }
            }

            sendEvent('progress', {
              current: i + 1,
              total: chaptersToGenerate,
              chapterIndex,
              status: 'generating',
              message: `正在生成第 ${chapterIndex} 章: ${outlineTitle || '未命名'}...`,
            });

            // Generate chapter with per-chapter retry logic
            const CHAPTER_MAX_RETRIES = 3;
            let result;
            let lastChapterError;
            
            for (let retryAttempt = 0; retryAttempt < CHAPTER_MAX_RETRIES; retryAttempt++) {
              try {
                if (retryAttempt > 0) {
                  const retryDelay = 5000 * Math.pow(2, retryAttempt - 1); // 5s, 10s, 20s
                  sendEvent('progress', {
                    current: i + 1,
                    total: chaptersToGenerate,
                    chapterIndex,
                    status: 'generating',
                    message: `第 ${chapterIndex} 章生成失败，${retryDelay/1000}秒后重试 (${retryAttempt}/${CHAPTER_MAX_RETRIES})...`,
                  });
                  await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
                
                // Heartbeat before AI call
                await updateTaskMessage(c.env.DB, taskId, `正在调用 AI 生成第 ${chapterIndex} 章...`, chapterIndex);
                
                result = await writeOneChapter({
                  aiConfig,
                  bible: project.bible,
                  rollingSummary: project.rolling_summary || '',
                  openLoops: JSON.parse(project.open_loops || '[]'),
                  lastChapters: lastChapters.map((c: any) => c.content).reverse(),
                  chapterIndex,
                  totalChapters: project.total_chapters,
                  chapterGoalHint,
                  chapterTitle: outlineTitle,
                  characters,
                  onProgress: (message, status) => {
                    sendEvent('progress', {
                      current: i + 1,
                      total: chaptersToGenerate,
                      chapterIndex,
                      status: status || 'generating',
                      message,
                    });
                    // Also update DB heartbeat on certain progress events
                    // Also update DB heartbeat on all progress events for resumption support
                    updateTaskMessage(c.env.DB, taskId, message, chapterIndex).catch(err => {
                       console.warn('Failed to update task message', err);
                    });
                  },
                });
                
                // Heartbeat after AI call completes
                await updateTaskMessage(c.env.DB, taskId, `第 ${chapterIndex} 章 AI 生成完成，正在保存...`, chapterIndex);
                
                // Success, break out of retry loop
                break;
              } catch (retryError) {
                lastChapterError = retryError;
                console.warn(`Chapter ${chapterIndex} attempt ${retryAttempt + 1} failed:`, (retryError as Error).message);
                
                // If this is the last retry, throw to trigger the outer catch
                if (retryAttempt === CHAPTER_MAX_RETRIES - 1) {
                  throw lastChapterError;
                }
              }
            }
            
            if (!result) {
              throw lastChapterError || new Error('Unknown error during chapter generation');
            }

            const chapterText = result.chapterText;

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
              UPDATE states SET 
                next_chapter_index = ?,
                rolling_summary = ?,
                open_loops = ?
              WHERE project_id = ?
            `).bind(
              chapterIndex + 1,
              result.updatedSummary,
              JSON.stringify(result.updatedOpenLoops),
              project.id
            ).run();

            // Update project object for next iteration
            project.rolling_summary = result.updatedSummary;
            project.open_loops = JSON.stringify(result.updatedOpenLoops);
            project.next_chapter_index = chapterIndex + 1;

            // Update task progress
            await updateTaskProgress(c.env.DB, taskId, chapterIndex, false);

            // Send chapter complete event with content snippet
            sendEvent('chapter_complete', {
              chapterIndex,
              title,
              preview: chapterText.slice(0, 200) + '...',
              wordCount: chapterText.length,
            });

          } catch (chapterError) {
            // Single chapter failed after all retries
            console.error(`Failed to generate chapter ${chapterIndex} after all retries:`, chapterError);
            failedChapters.push(chapterIndex);
            // Update task with failed chapter
            await updateTaskProgress(c.env.DB, taskId, chapterIndex, true);
            sendEvent('chapter_error', {
              chapterIndex,
              error: (chapterError as Error).message,
              retriesExhausted: true,
            });
            // Continue to next chapter instead of stopping
          }
        }

        // Mark task as completed
        await completeTask(c.env.DB, taskId, true);

        // Send completion event
        sendEvent('done', {
          success: true,
          generated: results,
          failedChapters,
          totalGenerated: results.length,
          totalFailed: failedChapters.length,
          taskId,
        });

      } catch (error) {
        sendEvent('error', { error: (error as Error).message });
      } finally {
        clearInterval(dbHeartbeatInterval);
        clearInterval(heartbeatInterval);
        // Safely close controller (may already be closed if client disconnected)
        try {
          controller.close();
        } catch {
          // Already closed, ignore
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

// Enhanced chapter generation with full context engineering
generationRoutes.post('/projects/:name/generate-enhanced', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  const aiConfig = getAIConfigFromHeaders(c);

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const {
      chaptersToGenerate = 1,
      enableContextOptimization = true,
      enableFullQC = false,
      enableAutoRepair = false,
    } = await c.req.json();

    // Get project with state and outline (user-scoped)
    const project = await c.env.DB.prepare(`
      SELECT p.id, p.bible, s.*, o.outline_json, c.characters_json,
             cs.registry_json as character_states_json, cs.last_updated_chapter as states_chapter,
             pg.graph_json as plot_graph_json, pg.last_updated_chapter as plot_chapter,
             nc.narrative_arc_json
      FROM projects p
      JOIN states s ON p.id = s.project_id
      LEFT JOIN outlines o ON p.id = o.project_id
      LEFT JOIN characters c ON p.id = c.project_id
      LEFT JOIN character_states cs ON p.id = cs.project_id
      LEFT JOIN plot_graphs pg ON p.id = pg.project_id
      LEFT JOIN narrative_config nc ON p.id = nc.project_id
      WHERE p.name = ? AND p.user_id = ?
    `).bind(name, userId).first() as any;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // Validate state
    const maxChapterResult = await c.env.DB.prepare(`
      SELECT MAX(chapter_index) as max_index FROM chapters WHERE project_id = ? AND deleted_at IS NULL
    `).bind(project.id).first() as any;

    const actualMaxChapter = maxChapterResult?.max_index || 0;
    const expectedNextIndex = actualMaxChapter + 1;

    if (project.next_chapter_index !== expectedNextIndex) {
      console.log(`State mismatch: auto-correcting to ${expectedNextIndex}`);
      project.next_chapter_index = expectedNextIndex;
      await c.env.DB.prepare(`
        UPDATE states SET next_chapter_index = ? WHERE project_id = ?
      `).bind(expectedNextIndex, project.id).run();
    }

    const outline = project.outline_json ? JSON.parse(project.outline_json) : null;
    const characters = project.characters_json ? JSON.parse(project.characters_json) : undefined;

    // Initialize or load context engineering state
    let characterStates: CharacterStateRegistry | undefined;
    if (project.character_states_json) {
      characterStates = JSON.parse(project.character_states_json);
    } else if (characters) {
      characterStates = initializeRegistryFromGraph(characters);
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO character_states (project_id, registry_json, last_updated_chapter)
        VALUES (?, ?, 0)
      `).bind(project.id, JSON.stringify(characterStates)).run();
    }

    let plotGraph: PlotGraph | undefined;
    if (project.plot_graph_json) {
      plotGraph = JSON.parse(project.plot_graph_json);
    } else {
      plotGraph = createEmptyPlotGraph();
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO plot_graphs (project_id, graph_json, last_updated_chapter)
        VALUES (?, ?, 0)
      `).bind(project.id, JSON.stringify(plotGraph)).run();
    }

    let narrativeArc: NarrativeArc | undefined;
    if (project.narrative_arc_json) {
      narrativeArc = JSON.parse(project.narrative_arc_json);
    } else if (outline) {
      narrativeArc = generateNarrativeArc(outline.volumes || [], project.total_chapters);
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO narrative_config (project_id, narrative_arc_json)
        VALUES (?, ?)
      `).bind(project.id, JSON.stringify(narrativeArc)).run();
    }

    const results: {
      chapter: number;
      title: string;
      qcScore?: number;
      wasRewritten: boolean;
    }[] = [];

    const startingChapterIndex = project.next_chapter_index;
    let previousPacing: number | undefined;

    for (let i = 0; i < chaptersToGenerate; i++) {
      const chapterIndex = startingChapterIndex + i;
      if (chapterIndex > project.total_chapters) break;

      // Get last 2 chapters
      const { results: lastChapters } = await c.env.DB.prepare(`
        SELECT content FROM chapters
        WHERE project_id = ? AND chapter_index >= ? AND deleted_at IS NULL
        ORDER BY chapter_index DESC LIMIT 2
      `).bind(project.id, Math.max(1, chapterIndex - 2)).all();

      // Get chapter info from outline
      let chapterGoalHint: string | undefined;
      let outlineTitle: string | undefined;
      let enhancedOutline: EnhancedChapterOutline | undefined;

      if (outline) {
        for (const vol of outline.volumes) {
          const ch = vol.chapters?.find((c: any) => c.index === chapterIndex);
          if (ch) {
            outlineTitle = ch.title;
            chapterGoalHint = `【章节大纲】\n- 标题: ${ch.title}\n- 目标: ${ch.goal}\n- 章末钩子: ${ch.hook}`;
            break;
          }
        }
      }

      // Generate chapter using enhanced engine
      const result = await writeEnhancedChapter({
        aiConfig,
        bible: project.bible,
        rollingSummary: project.rolling_summary || '',
        openLoops: JSON.parse(project.open_loops || '[]'),
        lastChapters: lastChapters.map((c: any) => c.content).reverse(),
        chapterIndex,
        totalChapters: project.total_chapters,
        chapterGoalHint,
        chapterTitle: outlineTitle,
        characters,
        characterStates,
        plotGraph,
        narrativeArc,
        enhancedOutline,
        previousPacing,
        enableContextOptimization,
        enableFullQC,
        enableAutoRepair,
        onProgress: (message, status) => {
          import('../eventBus.js').then(({ eventBus }) => {
            eventBus.progress({
              projectName: name,
              current: i,
              total: chaptersToGenerate,
              chapterIndex,
              status: status || 'generating',
              message,
            });
          });
        },
      });


      const chapterText = result.chapterText;

      // Save chapter
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO chapters (project_id, chapter_index, content) VALUES (?, ?, ?)
      `).bind(project.id, chapterIndex, chapterText).run();

      // Extract title
      const titleMatch = chapterText.match(/^第?\d*[章回节]?\s*[：:.]?\s*(.+)/m);
      const title = titleMatch ? titleMatch[1] : (outlineTitle || `Chapter ${chapterIndex}`);

      results.push({
        chapter: chapterIndex,
        title,
        qcScore: result.qcResult?.score,
        wasRewritten: result.wasRewritten,
      });

      // Update state
      await c.env.DB.prepare(`
        UPDATE states SET
          next_chapter_index = ?,
          rolling_summary = ?,
          open_loops = ?
        WHERE project_id = ?
      `).bind(
        chapterIndex + 1,
        result.updatedSummary,
        JSON.stringify(result.updatedOpenLoops),
        project.id
      ).run();

      // Update character states if changed
      if (result.updatedCharacterStates) {
        characterStates = result.updatedCharacterStates;
        await c.env.DB.prepare(`
          UPDATE character_states SET registry_json = ?, last_updated_chapter = ?, updated_at = CURRENT_TIMESTAMP
          WHERE project_id = ?
        `).bind(JSON.stringify(characterStates), chapterIndex, project.id).run();
      }

      // Update plot graph if changed
      if (result.updatedPlotGraph) {
        plotGraph = result.updatedPlotGraph;
        await c.env.DB.prepare(`
          UPDATE plot_graphs SET graph_json = ?, last_updated_chapter = ?, updated_at = CURRENT_TIMESTAMP
          WHERE project_id = ?
        `).bind(JSON.stringify(plotGraph), chapterIndex, project.id).run();
      }

      // Save QC result if available
      if (result.qcResult) {
        await c.env.DB.prepare(`
          INSERT OR REPLACE INTO chapter_qc (project_id, chapter_index, qc_json, passed, score)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          project.id,
          chapterIndex,
          JSON.stringify(result.qcResult),
          result.qcResult.passed ? 1 : 0,
          result.qcResult.score
        ).run();
      }

      // Update for next iteration
      project.rolling_summary = result.updatedSummary;
      project.open_loops = JSON.stringify(result.updatedOpenLoops);
      project.next_chapter_index = chapterIndex + 1;
      previousPacing = result.narrativeGuide?.pacingTarget;
    }

    return c.json({
      success: true,
      generated: results,
      contextStats: {
        characterStatesActive: characterStates ? Object.keys(characterStates.snapshots).length : 0,
        plotNodesCount: plotGraph ? plotGraph.nodes.length : 0,
        pendingForeshadowing: plotGraph ? plotGraph.pendingForeshadowing.length : 0,
      },
    });
  } catch (error) {
    console.error('Enhanced generation error:', error);
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

    // Genre-specific templates for better quality
    const genreTemplates: Record<string, string> = {
      '都市重生': `
【类型特点】都市重生文，主角带着前世记忆重生，利用信息差和先知优势逆袭。
【核心爽点】打脸装逼、商战逆袭、弥补遗憾、复仇雪恨、把握机遇。
【金手指建议】重生记忆、系统辅助、空间储物、前世技能传承。
【注意事项】时代背景要有年代感（如90年代），要有大量可利用的历史机遇（房产、股票、互联网）。`,
      '玄幻修仙': `
【类型特点】东方玄幻修仙文，主角在修仙世界从废材崛起，踏上巅峰之路。
【核心爽点】逆天改命、越级挑战、获得机缘、实力碾压、悟道突破。
【金手指建议】特殊体质、神秘传承、系统面板、时间加速修炼、因果反馈。
【注意事项】力量体系要清晰（如练气-筑基-金丹-元婴），要有宗门势力等级划分。`,
      '系统流': `
【类型特点】系统流文，主角获得特殊系统，通过完成任务获得奖励升级。
【核心爽点】任务奖励、签到福利、抽奖开箱、属性加点、技能解锁。
【金手指建议】任务系统、商城系统、抽奖系统、签到系统、成就系统。
【注意事项】系统规则要明确，奖励要有吸引力但不能太超模，要有成长曲线。`,
      '都市异能': `
【类型特点】都市异能文，主角在现代都市获得超凡能力，游走于普通人与异能世界之间。
【核心爽点】实力碾压、身份反转、拯救美人、惩恶扬善、逐步揭秘。
【金手指建议】异能觉醒、血脉传承、神器认主、空间能力、时间能力。
【注意事项】要平衡日常与战斗，异能世界设定要有层次感。`,
      '无敌流': `
【类型特点】无敌流爽文，主角从一开始就拥有绝对实力，横扫一切障碍。
【核心爽点】一拳秒杀、装弱扮猪吃虎、震惊全场、身份曝光、实力展示。
【金手指建议】无限复活、绝对防御、一击必杀、时间静止、规则掌控。
【注意事项】不能只靠战力，要有情感线、成长线（心境成长）、谜团揭示。`,
    };

    // Get genre template or use default
    const genreTemplate = genre && genreTemplates[genre] ? genreTemplates[genre] : '';

    const system = `你是一个**番茄/起点爆款网文策划专家**，精通读者心理和平台推荐算法。

你的任务是生成一个**极具吸引力**的 Story Bible，它将直接决定这本书能否获得流量。

【硬性要求】
1. 必须设计至少 3 个明确的"读者爽点"（打脸、逆袭、升级、复仇、装逼等）
2. 必须有独特且有成长空间的金手指/系统设计
3. 必须有能在前 100 字抓住读者的"开篇钩子"设计
4. 主角必须有强烈的行动动机（复仇、保护、证明自己等）
5. 要有清晰的力量体系/社会阶层，让读者能感受到主角的攀升

【输出格式 - Markdown】

# 《书名》

## 一句话卖点
（30字内，能让读者立刻想点进去的核心吸引力）

## 核心爽点设计
1. 爽点一：（描述 + 预计出现时机）
2. 爽点二：（描述 + 预计出现时机）
3. 爽点三：（描述 + 预计出现时机）

## 主角设定
- 姓名：
- 身份/职业：
- 前世/背景：
- 性格特点：
- 核心动机：（什么驱动他不断前进？）
- 金手指/系统：（详细描述能力、限制、成长空间）

## 配角矩阵
### 助力型配角
1. 配角A：（身份、与主角关系、作用）
### 反派/竞争者
1. 反派A：（身份、与主角的冲突、结局预期）

## 力量体系/社会阶层
（从最底层到最顶层的"天梯"设计，让读者能感受到主角的攀升路径）

## 世界观设定
（简洁但完整的世界背景）

## 主线剧情节点
1. 开篇危机：（第1-5章，主角遭遇什么困境？如何激发读者同情/好奇？）
2. 金手指觉醒：（主角如何获得能力？第一次使用的震撼感）
3. 第一次打脸：（谁看不起主角？主角如何证明自己？）
4. 中期高潮：（更大的挑战和更强的敌人）
5. 低谷转折：（主角遭遇挫折，如何逆转？）
6. 终极对决：（最终boss和主线冲突的解决）

## 开篇钩子设计
（第一章前100字应该怎么写？用什么场景/冲突/悬念抓住读者？给出具体的开篇思路）`;

    const prompt = `请为以下网文生成 Story Bible：

【用户需求】
${genre ? `- 类型: ${genre}` : '- 类型: 未指定，请根据主题推断最适合的类型'}
${theme ? `- 主题/核心创意: ${theme}` : ''}
${keywords ? `- 关键词/元素: ${keywords}` : ''}

${genreTemplate ? `【类型参考模板】\n${genreTemplate}` : ''}

请基于以上信息，生成一个**能在番茄获得流量**的完整 Story Bible：`;

    const bible = await generateText(aiConfig, { system, prompt, temperature: 0.9 });

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
  const chaptersPerVolume = Math.ceil(targetChapters / volumeCount);

  const system = `你是一个**网文爆款大纲策划专家**，精通长篇连载的节奏把控。

【硬性要求】
1. 必须严格按照目标章数分配各卷章节，确保分卷章节数之和**恰好等于**目标总章数
2. 每一卷必须有明确的"阶段性爽点"和"卷末高潮"设计
3. volumes 数组中的每个卷必须包含: title, startChapter, endChapter, goal, conflict, climax, volumeEndState
4. endChapter 必须紧接着下一卷的 startChapter（无重叠无间隙）
5. 最后一卷的 endChapter 必须等于目标总章数

【⚠️ 剧情连贯性 - 关键约束】
6. **剧情单向递进原则**：主角的重大状态变化（如称帝、结婚、突破境界）一旦发生，后续所有卷必须以此为前提，绝不可回退
7. **卷末状态延续**：每卷的 volumeEndState（卷末主角状态）必须成为下一卷的起始前提
8. **里程碑时间顺序**：milestones 必须按照剧情发展顺序排列，不可出现逻辑冲突（如"第100章称帝"不可出现在"第200章起兵"之后）

输出严格的 JSON 格式，不要有其他文字。

JSON 结构:
{
  "mainGoal": "全书核心目标",
  "milestones": ["里程碑1（按时间顺序）", "里程碑2", ...],
  "volumes": [
    {
      "title": "第一卷 卷名",
      "startChapter": 1,
      "endChapter": 80,
      "goal": "本卷剧情目标",
      "conflict": "本卷核心冲突",
      "climax": "本卷高潮/爽点",
      "volumeEndState": "本卷结束时主角的状态（身份、实力、处境等，下一卷必须从此状态开始）"
    },
    ...
  ]
}`;

  const prompt = `【Story Bible】
${bible}

【目标规模 - 必须严格遵守】
- 总章数: ${targetChapters} 章（分卷章节数之和必须恰好等于此数）
- 总字数: ${targetWordCount} 万字
- 预计分卷数: ${volumeCount} 卷
- 建议每卷约 ${chaptersPerVolume} 章

请生成符合要求的 JSON 格式总大纲：`;

  const raw = await generateText(aiConfig, { system, prompt, temperature: 0.7 });
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
  const outline = JSON.parse(jsonText);

  // Validate and auto-correct volume chapter coverage
  const volumes = outline.volumes || [];
  let expectedStart = 1;

  for (let i = 0; i < volumes.length; i++) {
    const vol = volumes[i];
    // Ensure startChapter is correct
    if (vol.startChapter !== expectedStart) {
      console.log(`Auto-correcting volume ${i + 1} startChapter: ${vol.startChapter} -> ${expectedStart}`);
      vol.startChapter = expectedStart;
    }

    // For the last volume, ensure endChapter equals targetChapters
    if (i === volumes.length - 1 && vol.endChapter !== targetChapters) {
      console.log(`Auto-correcting last volume endChapter: ${vol.endChapter} -> ${targetChapters}`);
      vol.endChapter = targetChapters;
    }

    expectedStart = vol.endChapter + 1;
  }

  // Verify total coverage
  const totalCoverage = volumes.reduce((sum: number, v: any) => sum + (v.endChapter - v.startChapter + 1), 0);
  if (totalCoverage !== targetChapters) {
    console.warn(`Volume coverage mismatch: ${totalCoverage} vs target ${targetChapters}. Auto-adjusting last volume.`);
    if (volumes.length > 0) {
      const lastVol = volumes[volumes.length - 1];
      lastVol.endChapter = targetChapters;
    }
  }

  return outline;
}

// Helper: Generate volume chapters with chunked generation and validation
async function generateVolumeChapters(
  aiConfig: AIConfig,
  bible: string,
  masterOutline: any,
  volume: any,
  previousVolumeEndState: string | null = null
): Promise<any[]> {
  const startChapter = volume.startChapter;
  const endChapter = volume.endChapter;
  const totalChapters = endChapter - startChapter + 1;

  // Chunk size for generation (to avoid token limits)
  const CHUNK_SIZE = 20;
  const allChapters: any[] = [];

  // Generate chapters in chunks
  for (let chunkStart = startChapter; chunkStart <= endChapter; chunkStart += CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, endChapter);
    const chunkSize = chunkEnd - chunkStart + 1;

    console.log(`Generating chapters ${chunkStart}-${chunkEnd} for volume "${volume.title}"...`);

    const system = `你是一个**网文章节大纲策划专家**，擅长设计引人入胜的章节结构。

【硬性要求】
1. 必须生成 **恰好 ${chunkSize} 个章节**，索引从 ${chunkStart} 到 ${chunkEnd}
2. 每章必须有**独特且有创意的标题**，严禁使用"第X章"作为占位符
3. 每章标题应该体现本章的核心冲突或转折点
4. 每章必须有 goal（本章目标，至少20字） 和 hook（章末钩子，让读者想看下一章）
5. 章节之间要有逻辑递进，不能跳跃

输出严格的 JSON 数组格式，不要有其他文字。

JSON 结构:
[
  {
    "index": ${chunkStart},
    "title": "创意章节标题（不要包含'第X章'）",
    "goal": "本章具体剧情目标和要完成的内容",
    "hook": "章末悬念/钩子，让读者想立刻看下一章"
  },
  ...
]`;

    // Build context from previously generated chapters in this volume
    const prevChaptersContext = allChapters.length > 0
      ? `\n【本卷已生成章节】\n${allChapters.slice(-5).map(c => `- 第${c.index}章 ${c.title}: ${c.goal.slice(0, 50)}...`).join('\n')}`
      : '';

    const prompt = `【Story Bible】
${bible.slice(0, 1500)}...

【全书进度定位】
- 总目标: ${masterOutline.mainGoal}
${previousVolumeEndState 
  ? `- 前卷结局状态: ${previousVolumeEndState}
- ⚠️ 重要约束：本卷剧情必须从上述状态开始，主角身份/实力/处境不可回退！` 
  : '- 这是第一卷，故事开端'}

【本卷信息】
- ${volume.title}
- 本卷目标: ${volume.goal}
- 本卷冲突: ${volume.conflict || '待发展'}
- 本卷高潮: ${volume.climax || '待发展'}
${prevChaptersContext}

【本次生成任务】
请生成第 ${chunkStart} 章到第 ${chunkEnd} 章的大纲（共 ${chunkSize} 章），输出 JSON 数组：`;

    try {
      const raw = await generateText(aiConfig, { system, prompt, temperature: 0.75 });
      const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
      const chapters = JSON.parse(jsonText);

      // Validate and fix chapter indices
      const validatedChapters = chapters.map((ch: any, i: number) => ({
        index: chunkStart + i,
        title: ch.title && !ch.title.match(/^第?\d+章?$/) ? ch.title : `${volume.title.replace(/第.+卷\s*/, '')}·${chunkStart + i}`,
        goal: ch.goal || ch.description || ch.plot || '剧情推进',
        hook: ch.hook || ch.cliffhanger || '悬念待续',
      }));

      allChapters.push(...validatedChapters);
    } catch (error) {
      console.error(`Error generating chapters ${chunkStart}-${chunkEnd}:`, error);
      // Generate placeholder chapters for this chunk if API fails
      for (let idx = chunkStart; idx <= chunkEnd; idx++) {
        allChapters.push({
          index: idx,
          title: `${volume.title.replace(/第.+卷\s*/, '')}·${idx}`,
          goal: '待补充',
          hook: '待补充',
        });
      }
    }
  }

  // Final validation: ensure all indices are present
  const indexSet = new Set(allChapters.map(c => c.index));
  const missingIndices: number[] = [];
  for (let i = startChapter; i <= endChapter; i++) {
    if (!indexSet.has(i)) {
      missingIndices.push(i);
    }
  }

  // Fill in any missing chapters
  if (missingIndices.length > 0) {
    console.warn(`Missing chapter indices: ${missingIndices.join(', ')}. Filling with placeholders.`);
    for (const idx of missingIndices) {
      allChapters.push({
        index: idx,
        title: `${volume.title.replace(/第.+卷\s*/, '')}·${idx}`,
        goal: '待补充',
        hook: '待补充',
      });
    }
  }

  // Sort by index
  allChapters.sort((a, b) => a.index - b.index);

  console.log(`Volume "${volume.title}" complete: ${allChapters.length}/${totalChapters} chapters generated.`);

  return allChapters;
}




// Refine outline (regenerate missing/incomplete volumes)
generationRoutes.post('/projects/:name/outline/refine', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  const aiConfig = getAIConfigFromHeaders(c);

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    // Get project (user-scoped)
    const project = await c.env.DB.prepare(`
      SELECT id, bible FROM projects WHERE name = ? AND user_id = ?
    `).bind(name, userId).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // Get current outline
    const outlineRecord = await c.env.DB.prepare(`
      SELECT outline_json FROM outlines WHERE project_id = ?
    `).bind((project as any).id).first();

    if (!outlineRecord) {
      return c.json({ success: false, error: 'Outline not found' }, 404);
    }

    let outline = JSON.parse((outlineRecord as any).outline_json);
    const bible = (project as any).bible;

    let volumeIndex: number | undefined;
    try {
      const body = await c.req.json();
      volumeIndex = body.volumeIndex;
    } catch (e) {
      // Start with undefined
    }

    let updated = false;
    const volumes = outline.volumes || [];

    if (typeof volumeIndex === 'number' && volumeIndex >= 0 && volumeIndex < volumes.length) {
      // Force refine specific volume
      console.log(`Force refining Volume ${volumeIndex + 1}`);
      const vol = volumes[volumeIndex];
      const chaptersData = await generateVolumeChapters(aiConfig, bible, outline, vol);
      volumes[volumeIndex] = normalizeVolume({ ...vol, chapters: chaptersData }, volumeIndex, chaptersData);
      updated = true;
    } else {
      // Auto-detect incomplete volumes
      for (let i = 0; i < volumes.length; i++) {
        const vol = volumes[i];
        const chapters = vol.chapters || [];
        const expectedCount = (vol.endChapter - vol.startChapter) + 1;

        // Heuristic for "incomplete":
        // 1. No chapters
        // 2. Significantly fewer chapters than expected (e.g., < 20% of expected, or just placeholder 1 chapter)
        // 3. Most chapters are empty (no goal)

        const hasContentCount = chapters.filter((c: any) => c.goal && c.goal.length > 5).length;
        const isPlaceholder = chapters.length <= 1;
        const isEmpty = hasContentCount < (Math.max(5, expectedCount * 0.1)); // Less than 10% content populated

        if (isPlaceholder || isEmpty) {
          console.log(`Refining Volume ${i + 1}: ${vol.title}`);

          const chaptersData = await generateVolumeChapters(aiConfig, bible, outline, vol);
          volumes[i] = normalizeVolume({ ...vol, chapters: chaptersData }, i, chaptersData);
          updated = true;
        }
      }
    }

    if (updated) {
      outline.volumes = volumes;

      // Save updated outline
      await c.env.DB.prepare(`
        UPDATE outlines SET outline_json = ? WHERE project_id = ?
      `).bind(JSON.stringify(outline), (project as any).id).run();

      return c.json({ success: true, message: 'Outline refined successfully', outline });
    } else {
      return c.json({ success: true, message: 'Outline is already complete', outline });
    }

  } catch (error) {
    console.error('Refine outline error:', error);
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

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
