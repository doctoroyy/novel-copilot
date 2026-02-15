import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { generateText, getAIConfigFromRegistry, type AIConfig } from '../services/aiClient.js';
import { consumeCredit } from '../services/creditService.js';
import { writeOneChapter } from '../generateChapter.js';
import { generateMasterOutline, generateVolumeChapters } from '../generateOutline.js';
import { writeEnhancedChapter } from '../enhancedChapterEngine.js';
import type { CharacterStateRegistry } from '../types/characterState.js';
import type { PlotGraph } from '../types/plotGraph.js';
import type { NarrativeArc, EnhancedChapterOutline } from '../types/narrative.js';
import { initializeRegistryFromGraph } from '../context/characterStateManager.js';
import { createEmptyPlotGraph } from '../types/plotGraph.js';
import { generateNarrativeArc } from '../narrative/pacingController.js';
import { createGenerationTask, updateTaskProgress, completeTask, checkRunningTask, updateTaskMessage, getTaskById } from './tasks.js';

export const generationRoutes = new Hono<{ Bindings: Env }>();

// Helper to get AI config from Model Registry (server-side)
// Helper to get AI config from Model Registry (server-side) or Custom Headers
// Helper to get AI config from Model Registry (server-side) or Custom Headers
async function getAIConfig(c: any, db: D1Database, featureKey?: string): Promise<AIConfig | null> {
  const userId = c.get('userId');
  
  // 1. Check if user has permission for custom provider
  if (userId) {
    const user = await db.prepare('SELECT allow_custom_provider FROM users WHERE id = ?').bind(userId).first() as any;
    if (user?.allow_custom_provider) {
       // 2. Try to get config from headers
       // Note: headers in Hono are accessible via c.req.header()
       // We map x-custom-* headers to what getAIConfigFromHeaders expects (x-ai-*) or just read them directly here
       const headers = c.req.header();
       const customProvider = headers['x-custom-provider'];
       const customModel = headers['x-custom-model'];
       const customBaseUrl = headers['x-custom-base-url'];
       const customApiKey = headers['x-custom-api-key'];

       if (customProvider && customModel && customApiKey) {
         return {
           provider: customProvider as any,
           model: customModel,
           apiKey: customApiKey,
           baseUrl: customBaseUrl,
         };
       }
    }
  }

  // 3. Fallback to registry
  return getAIConfigFromRegistry(db, featureKey || 'generate_chapter'); 
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
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_outline');

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
          SELECT p.id, p.bible, p.name
          FROM projects p
          WHERE (p.id = ? OR p.name = ?) AND p.deleted_at IS NULL AND p.user_id = ?
          ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
          LIMIT 1
        `).bind(name, name, userId, name).first();

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

        // 查询是否已有人物关系数据（先建人物再生成大纲的场景）
        const charRecord = await c.env.DB.prepare(`
          SELECT characters_json FROM characters WHERE project_id = ?
        `).bind(project.id).first();
        const characters = charRecord?.characters_json ? JSON.parse(charRecord.characters_json as string) : undefined;

        console.log(`Starting outline generation for ${(project as any).name}: ${targetChapters} chapters, ${targetWordCount}万字${characters ? ' (with characters)' : ''}`);

        // Phase 1: Generate master outline
        sendEvent('progress', { phase: 1, message: characters ? '正在基于人物关系生成总体大纲...' : '正在生成总体大纲...' });
        console.log('Phase 1: Generating master outline...');
      // 0. Consume Credit
    try {
        await consumeCredit(c.env.DB, userId, 'generate_outline', `生成大纲: ${project.name}`);
    } catch (error) {
        sendEvent('error', { error: (error as Error).message, status: 402 });
        controller.close();
        clearInterval(heartbeatInterval);
        return;
    }

    // 1. Generate Outline (传入 characters 以获得更好的大局观)
    const masterOutline = await generateMasterOutline(aiConfig, { bible, targetChapters, targetWordCount, characters });
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
          
          const chapters = await generateVolumeChapters(aiConfig, { bible, masterOutline, volume: vol, previousVolumeSummary: previousVolumeEndState || undefined });
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

// Generate single chapter (with order validation)
generationRoutes.post('/projects/:name/chapters/:index/generate', async (c) => {
  const name = c.req.param('name');
  const index = parseInt(c.req.param('index'), 10);
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_chapter');

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  const encoder = new TextEncoder();

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      // Helper to send SSE event
      const sendEvent = (type: string, data: any) => {
        try {
          const payload = JSON.stringify({ type, ...data });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch (e) {
          console.error('Error sending event', e);
        }
      };

      try {
        const { regenerate = false } = await c.req.json().catch(() => ({}));

        // Get project with state and outline
        const project = await c.env.DB.prepare(`
          SELECT p.id, p.name, p.bible, s.*, o.outline_json, c.characters_json
          FROM projects p
          JOIN states s ON p.id = s.project_id
          LEFT JOIN outlines o ON p.id = o.project_id
          LEFT JOIN characters c ON p.id = c.project_id
          WHERE (p.id = ? OR p.name = ?) AND p.user_id = ?
          ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
          LIMIT 1
        `).bind(name, name, userId, name).first() as any;

        if (!project) {
          sendEvent('error', { error: 'Project not found' });
          controller.close();
          return;
        }

        const runningTask = await checkRunningTask(c.env.DB, project.id, userId);
        if (runningTask.isRunning) {
          sendEvent('error', { error: '当前有后台章节任务正在运行，请先等待完成或取消任务后再单章生成。' });
          controller.close();
          return;
        }

        // Validate chapter order
        const maxChapterResult = await c.env.DB.prepare(`
          SELECT MAX(chapter_index) as max_index FROM chapters WHERE project_id = ? AND deleted_at IS NULL
        `).bind(project.id).first() as any;

        const maxIndex = maxChapterResult?.max_index || 0;

        if (index > maxIndex + 1) {
          sendEvent('error', { error: `无法跳过生成。当前最大章节为第 ${maxIndex} 章，必须先生成第 ${maxIndex + 1} 章。` });
          controller.close();
          return;
        }

        // Check if chapter already exists when not regenerating
        if (index <= maxIndex && !regenerate) {
           sendEvent('error', { error: `第 ${index} 章已存在。如需重写，请使用重新生成功能。` });
           controller.close();
           return;
        }

        // Prepare prompt context
        // If regenerating a middle chapter, we use the content of the PREVIOUS chapter as 'lastChapters' logic
        const { results: lastChapters } = await c.env.DB.prepare(`
          SELECT content FROM chapters 
          WHERE project_id = ? AND chapter_index < ? AND deleted_at IS NULL
          ORDER BY chapter_index DESC LIMIT 2
        `).bind(project.id, index).all();

        // Get chapter goal from outline
        const outline = project.outline_json ? JSON.parse(project.outline_json) : null;
        const characters = project.characters_json ? JSON.parse(project.characters_json) : undefined;
        
        let chapterGoalHint: string | undefined;
        let outlineTitle: string | undefined;
        if (outline) {
          for (const vol of outline.volumes) {
            const ch = vol.chapters?.find((c: any) => c.index === index);
            if (ch) {
              outlineTitle = ch.title;
              chapterGoalHint = `【章节大纲】\n- 标题: ${ch.title}\n- 目标: ${ch.goal}\n- 章末钩子: ${ch.hook}`;
              break;
            }
          }
        }

        sendEvent('start', { index, title: outlineTitle });
        sendEvent('progress', { message: '正在调用 AI 生成...' });

        // 0. Consume Credit
        try {
            await consumeCredit(c.env.DB, userId, 'generate_chapter', `生成章节: ${project.name || '未知项目'} 第 ${index} 章`);
        } catch (error) {
            sendEvent('error', { error: (error as Error).message, status: 402 }); // 402 Payment Required
            controller.close();
            return;
        }

        // Generate chapter
        const result = await writeOneChapter({
          aiConfig,
          bible: project.bible,
          rollingSummary: project.rolling_summary || '', // Use current summary (might be slightly off for mid-chapter regen, but acceptable)
          openLoops: JSON.parse(project.open_loops || '[]'),
          lastChapters: lastChapters.map((c: any) => c.content).reverse(),
          chapterIndex: index,
          totalChapters: project.total_chapters,
          chapterGoalHint,
          chapterTitle: outlineTitle,
          characters,
          onProgress: (message, status) => {
            sendEvent('progress', { message, status });
          },
        });

        const chapterText = result.chapterText;

        // Save chapter
        await c.env.DB.prepare(`
          INSERT OR REPLACE INTO chapters (project_id, chapter_index, content) VALUES (?, ?, ?)
        `).bind(project.id, index, chapterText).run();

        // ONLY update state if we are appending a new chapter (not regenerating old ones)
        // Updating state for old chapters is dangerous as it invalidates future summaries
        if (index === maxIndex + 1) {
          await c.env.DB.prepare(`
            UPDATE states SET 
              next_chapter_index = ?,
              rolling_summary = ?,
              open_loops = ?
            WHERE project_id = ?
          `).bind(
            index + 1,
            result.updatedSummary,
            JSON.stringify(result.updatedOpenLoops),
            project.id
          ).run();
        }

        sendEvent('done', { success: true, index, content: chapterText });
        controller.close();

      } catch (error) {
        console.error('Generation error:', error);
        sendEvent('error', { error: (error as Error).message });
        controller.close();
      }
    },
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
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_chapter');
  
  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const { chaptersToGenerate = 1 } = await c.req.json();

    // Get project with state and outline
    const project = await c.env.DB.prepare(`
      SELECT p.id, p.name, p.bible, s.*, o.outline_json, c.characters_json
      FROM projects p
      JOIN states s ON p.id = s.project_id
      LEFT JOIN outlines o ON p.id = o.project_id
      LEFT JOIN characters c ON p.id = c.project_id
      WHERE (p.id = ? OR p.name = ?) AND p.user_id = ?
      ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
      LIMIT 1
    `).bind(name, name, userId, name).first() as any;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const runningTask = await checkRunningTask(c.env.DB, project.id, userId);
    if (runningTask.isRunning) {
      return c.json(
        { success: false, error: '当前有后台章节任务正在运行，请先等待完成或取消任务后再发起此请求。' },
        409
      );
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

      // 0. Consume Credit
      try {
          await consumeCredit(c.env.DB, userId, 'generate_chapter', `生成章节: ${project.name || '未知项目'} 第 ${chapterIndex} 章`);
      } catch (error) {
          return c.json({ success: false, error: (error as Error).message }, 402); // 402 Payment Required
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

type RealtimeProgressStatus =
  | 'starting'
  | 'analyzing'
  | 'planning'
  | 'generating'
  | 'reviewing'
  | 'repairing'
  | 'saving'
  | 'updating_summary'
  | 'done'
  | 'error';

let eventBusModulePromise: Promise<typeof import('../eventBus.js')> | null = null;

function normalizeRealtimeStatus(status?: string): RealtimeProgressStatus {
  if (!status) return 'generating';
  if (status === 'preparing') return 'starting';
  const known = new Set<RealtimeProgressStatus>([
    'starting',
    'analyzing',
    'planning',
    'generating',
    'reviewing',
    'repairing',
    'saving',
    'updating_summary',
    'done',
    'error',
  ]);
  return known.has(status as RealtimeProgressStatus)
    ? (status as RealtimeProgressStatus)
    : 'generating';
}

async function emitProgressEvent(data: {
  projectName: string;
  current: number;
  total: number;
  chapterIndex: number;
  status?: string;
  message?: string;
}) {
  try {
    if (!eventBusModulePromise) {
      eventBusModulePromise = import('../eventBus.js');
    }
    const { eventBus } = await eventBusModulePromise;
    eventBus.progress({
      projectName: data.projectName,
      current: data.current,
      total: data.total,
      chapterIndex: data.chapterIndex,
      status: normalizeRealtimeStatus(data.status),
      message: data.message,
    });
  } catch (err) {
    console.warn('Failed to emit progress event:', (err as Error).message);
  }
}

type TaskRuntimeControl = {
  exists: boolean;
  status: string | null;
  cancelRequested: boolean;
};

async function getTaskRuntimeControl(db: D1Database, taskId: number): Promise<TaskRuntimeControl> {
  const row = await db.prepare(`
    SELECT status, cancel_requested
    FROM generation_tasks
    WHERE id = ?
  `).bind(taskId).first() as { status: string; cancel_requested: number | null } | null;

  if (!row) {
    return { exists: false, status: null, cancelRequested: false };
  }

  return {
    exists: true,
    status: row.status,
    cancelRequested: Boolean(row.cancel_requested),
  };
}

async function handleTaskCancellationIfNeeded(params: {
  db: D1Database;
  taskId: number;
  projectName: string;
  total: number;
  chapterIndex: number;
  current: number;
}): Promise<{ shouldStop: boolean; cancelled: boolean }> {
  const runtime = await getTaskRuntimeControl(params.db, params.taskId);

  if (!runtime.exists || runtime.status !== 'running') {
    return { shouldStop: true, cancelled: false };
  }

  if (!runtime.cancelRequested) {
    return { shouldStop: false, cancelled: false };
  }

  await completeTask(params.db, params.taskId, false, '任务已取消');
  await emitProgressEvent({
    projectName: params.projectName,
    current: params.current,
    total: params.total,
    chapterIndex: params.chapterIndex,
    status: 'error',
    message: '任务已取消',
  });

  return { shouldStop: true, cancelled: true };
}

async function runChapterGenerationTaskInBackground(params: {
  env: Env;
  aiConfig: AIConfig;
  userId: string;
  projectName: string;
  projectId: string;
  taskId: number;
  chaptersToGenerate: number;
  startingChapterIndex: number;
}) {
  const {
    env,
    aiConfig,
    userId,
    projectName,
    projectId,
    taskId,
    chaptersToGenerate,
    startingChapterIndex,
  } = params;

  try {
    const project = await env.DB.prepare(`
      SELECT p.id, p.bible, s.*, o.outline_json, c.characters_json
      FROM projects p
      JOIN states s ON p.id = s.project_id
      LEFT JOIN outlines o ON p.id = o.project_id
      LEFT JOIN characters c ON p.id = c.project_id
      WHERE p.id = ? AND p.user_id = ?
    `).bind(projectId, userId).first() as any;

    if (!project) {
      await completeTask(env.DB, taskId, false, 'Project not found');
      return;
    }

    const outline = project.outline_json ? JSON.parse(project.outline_json) : null;
    const characters = project.characters_json ? JSON.parse(project.characters_json) : undefined;
    const failedChapters: number[] = [];
    let completedCount = 0;

    for (let i = 0; i < chaptersToGenerate; i++) {
      const chapterIndex = startingChapterIndex + i;
      if (chapterIndex > project.total_chapters) break;

      const startControl = await handleTaskCancellationIfNeeded({
        db: env.DB,
        taskId,
        projectName,
        total: chaptersToGenerate,
        chapterIndex,
        current: completedCount,
      });
      if (startControl.shouldStop) {
        return;
      }

      await updateTaskMessage(env.DB, taskId, `正在生成第 ${chapterIndex} 章...`, chapterIndex);
      await emitProgressEvent({
        projectName,
        current: completedCount,
        total: chaptersToGenerate,
        chapterIndex,
        status: 'starting',
        message: `准备生成第 ${chapterIndex} 章...`,
      });

      try {
        // 0. Consume Credit
        try {
          await consumeCredit(env.DB, userId, 'generate_chapter', `生成章节: ${projectName || '未知项目'} 第 ${chapterIndex} 章`);
        } catch (creditError) {
          await updateTaskMessage(env.DB, taskId, `能量不足: ${(creditError as Error).message}`, chapterIndex);
          await completeTask(env.DB, taskId, false, (creditError as Error).message);
          
          void emitProgressEvent({
            projectName,
            current: completedCount,
            total: chaptersToGenerate,
            chapterIndex,
            status: 'error',
            message: `创作能量不足: ${(creditError as Error).message}`,
          });

          // Terminate task due to insufficient credits
          return;
        }
        const { results: lastChapters } = await env.DB.prepare(`
          SELECT content FROM chapters
          WHERE project_id = ? AND chapter_index >= ? AND deleted_at IS NULL
          ORDER BY chapter_index DESC LIMIT 2
        `).bind(project.id, Math.max(1, chapterIndex - 2)).all();

        let chapterGoalHint: string | undefined;
        let outlineTitle: string | undefined;
        if (outline) {
          for (const vol of outline.volumes) {
            const ch = vol.chapters?.find((chapter: any) => chapter.index === chapterIndex);
            if (ch) {
              outlineTitle = ch.title;
              chapterGoalHint = `【章节大纲】\n- 标题: ${ch.title}\n- 目标: ${ch.goal}\n- 章末钩子: ${ch.hook}`;
              break;
            }
          }
        }

        const CHAPTER_MAX_RETRIES = 3;
        let result: Awaited<ReturnType<typeof writeOneChapter>> | undefined;
        let lastChapterError: unknown;

        for (let retryAttempt = 0; retryAttempt < CHAPTER_MAX_RETRIES; retryAttempt++) {
          try {
            if (retryAttempt > 0) {
              const retryDelay = 5000 * Math.pow(2, retryAttempt - 1);
              const retryMessage = `第 ${chapterIndex} 章生成失败，${retryDelay / 1000}秒后重试 (${retryAttempt}/${CHAPTER_MAX_RETRIES})...`;
              await updateTaskMessage(env.DB, taskId, retryMessage, chapterIndex);
              await emitProgressEvent({
                projectName,
                current: completedCount,
                total: chaptersToGenerate,
                chapterIndex,
                status: 'generating',
                message: retryMessage,
              });
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
            }

            const retryControl = await handleTaskCancellationIfNeeded({
              db: env.DB,
              taskId,
              projectName,
              total: chaptersToGenerate,
              chapterIndex,
              current: completedCount,
            });
            if (retryControl.shouldStop) {
              return;
            }

            await updateTaskMessage(env.DB, taskId, `正在调用 AI 生成第 ${chapterIndex} 章...`, chapterIndex);

            result = await writeOneChapter({
              aiConfig,
              bible: project.bible,
              rollingSummary: project.rolling_summary || '',
              openLoops: JSON.parse(project.open_loops || '[]'),
              lastChapters: lastChapters.map((chapter: any) => chapter.content).reverse(),
              chapterIndex,
              totalChapters: project.total_chapters,
              chapterGoalHint,
              chapterTitle: outlineTitle,
              characters,
              onProgress: (message, status) => {
                updateTaskMessage(env.DB, taskId, message, chapterIndex).catch((err) => {
                  console.warn('Failed to update task message:', err);
                });
                void emitProgressEvent({
                  projectName,
                  current: completedCount,
                  total: chaptersToGenerate,
                  chapterIndex,
                  status,
                  message,
                });
              },
            });

            await updateTaskMessage(env.DB, taskId, `第 ${chapterIndex} 章 AI 生成完成，正在保存...`, chapterIndex);
            break;
          } catch (retryError) {
            lastChapterError = retryError;
            if (retryAttempt === CHAPTER_MAX_RETRIES - 1) {
              throw retryError;
            }
          }
        }

        if (!result) {
          throw lastChapterError || new Error('Unknown error during chapter generation');
        }

        const beforeSaveControl = await handleTaskCancellationIfNeeded({
          db: env.DB,
          taskId,
          projectName,
          total: chaptersToGenerate,
          chapterIndex,
          current: completedCount,
        });
        if (beforeSaveControl.shouldStop) {
          return;
        }

        const chapterText = result.chapterText;

        await env.DB.prepare(`
          INSERT OR REPLACE INTO chapters (project_id, chapter_index, content) VALUES (?, ?, ?)
        `).bind(project.id, chapterIndex, chapterText).run();

        await env.DB.prepare(`
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

        project.rolling_summary = result.updatedSummary;
        project.open_loops = JSON.stringify(result.updatedOpenLoops);
        project.next_chapter_index = chapterIndex + 1;

        await updateTaskProgress(env.DB, taskId, chapterIndex, false);
        completedCount += 1;
        await emitProgressEvent({
          projectName,
          current: completedCount,
          total: chaptersToGenerate,
          chapterIndex,
          status: 'saving',
          message: `第 ${chapterIndex} 章已完成`,
        });
      } catch (chapterError) {
        failedChapters.push(chapterIndex);
        await updateTaskProgress(env.DB, taskId, chapterIndex, true);
        await emitProgressEvent({
          projectName,
          current: completedCount + failedChapters.length,
          total: chaptersToGenerate,
          chapterIndex,
          status: 'error',
          message: `第 ${chapterIndex} 章失败: ${(chapterError as Error).message}`,
        });
      }
    }

    const finishControl = await handleTaskCancellationIfNeeded({
      db: env.DB,
      taskId,
      projectName,
      total: chaptersToGenerate,
      chapterIndex: Math.max(startingChapterIndex, project.next_chapter_index || startingChapterIndex),
      current: completedCount,
    });
    if (!finishControl.shouldStop) {
      await completeTask(env.DB, taskId, true);
      await emitProgressEvent({
        projectName,
        current: chaptersToGenerate,
        total: chaptersToGenerate,
        chapterIndex: startingChapterIndex + chaptersToGenerate - 1,
        status: 'done',
        message: `生成完成：成功 ${chaptersToGenerate - failedChapters.length} 章，失败 ${failedChapters.length} 章`,
      });
    }
  } catch (error) {
    console.error(`Background generation task ${taskId} failed:`, error);
    try {
      await completeTask(env.DB, taskId, false, (error as Error).message);
    } catch (dbError) {
      console.warn('Failed to mark task as failed:', dbError);
    }
    await emitProgressEvent({
      projectName,
      current: 0,
      total: chaptersToGenerate,
      chapterIndex: startingChapterIndex,
      status: 'error',
      message: `生成失败: ${(error as Error).message}`,
    });
  }
}

// Streaming chapter generation monitor (task runs in background)
generationRoutes.post('/projects/:name/generate-stream', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_chapter');
  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  const body = await c.req.json().catch(() => ({} as { chaptersToGenerate?: unknown }));
  const requestedCountRaw = Number.parseInt(String(body.chaptersToGenerate ?? '1'), 10);
  const requestedCount = Number.isInteger(requestedCountRaw) && requestedCountRaw > 0 ? requestedCountRaw : 1;

  const project = await c.env.DB.prepare(`
    SELECT p.id, p.name, s.next_chapter_index, s.total_chapters
    FROM projects p
    JOIN states s ON p.id = s.project_id
    WHERE (p.id = ? OR p.name = ?) AND p.user_id = ? AND p.deleted_at IS NULL
    ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
    LIMIT 1
  `).bind(name, name, userId, name).first() as {
    id: string;
    name: string;
    next_chapter_index: number;
    total_chapters: number;
  } | null;

  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404);
  }

  const maxChapterResult = await c.env.DB.prepare(`
    SELECT MAX(chapter_index) as max_index FROM chapters WHERE project_id = ? AND deleted_at IS NULL
  `).bind(project.id).first() as { max_index: number | null } | null;

  const actualMaxChapter = maxChapterResult?.max_index || 0;
  const expectedNextIndex = actualMaxChapter + 1;
  if (project.next_chapter_index !== expectedNextIndex) {
    project.next_chapter_index = expectedNextIndex;
    await c.env.DB.prepare(`
      UPDATE states SET next_chapter_index = ? WHERE project_id = ?
    `).bind(expectedNextIndex, project.id).run();
  }

  const remaining = Math.max(0, project.total_chapters - actualMaxChapter);
  if (remaining <= 0) {
    return c.json({ success: false, error: '已达到目标章节数，无需继续生成' }, 400);
  }
  const chaptersToGenerate = Math.min(requestedCount, remaining);

  const runningTaskCheck = await checkRunningTask(c.env.DB, project.id, userId);
  const runningTaskUpdatedAt = runningTaskCheck.task?.updated_at
    ? new Date(`${runningTaskCheck.task.updated_at}Z`).getTime()
    : 0;
  const runningTaskFreshThresholdMs = 30 * 60 * 1000;
  const isRunningTaskFresh = runningTaskUpdatedAt > 0 && (Date.now() - runningTaskUpdatedAt) < runningTaskFreshThresholdMs;
  const isResumed = Boolean(runningTaskCheck.isRunning && runningTaskCheck.taskId && isRunningTaskFresh);

  if (runningTaskCheck.isRunning && runningTaskCheck.taskId && !isRunningTaskFresh) {
    await completeTask(
      c.env.DB,
      runningTaskCheck.taskId,
      false,
      '任务长时间无进展，已标记失败，请重新发起'
    );
  }

  const taskId = isResumed
    ? (runningTaskCheck.taskId as number)
    : await createGenerationTask(
      c.env.DB,
      project.id,
      userId,
      chaptersToGenerate,
      project.next_chapter_index
    );

  if (!isResumed) {
    c.executionCtx.waitUntil(
      runChapterGenerationTaskInBackground({
        env: c.env,
        aiConfig,
        userId,
        projectName: project.name,
        projectId: project.id,
        taskId,
        chaptersToGenerate,
        startingChapterIndex: project.next_chapter_index,
      })
    );
  }

  const initialTask = await getTaskById(c.env.DB, taskId, userId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let pollInFlight = false;
      let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
      let pollInterval: ReturnType<typeof setInterval> | undefined;
      let lastMessage = initialTask?.currentMessage || null;
      let lastProgress = initialTask?.currentProgress || 0;

      const seenCompleted = new Set<number>(initialTask?.completedChapters || []);
      const seenFailed = new Set<number>(initialTask?.failedChapters || []);

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (pollInterval) clearInterval(pollInterval);
        try {
          controller.close();
        } catch {
          // no-op
        }
      };

      const sendEvent = (type: string, data: Record<string, unknown> = {}) => {
        if (closed) return;
        try {
          const payload = JSON.stringify({ type, ...data });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          close();
        }
      };

      const emitTaskSnapshot = async () => {
        if (pollInFlight || closed) return;
        pollInFlight = true;
        try {
          const task = await getTaskById(c.env.DB, taskId, userId);
          if (!task) {
            sendEvent('error', { error: '任务已取消或不存在', taskId });
            close();
            return;
          }

          const newlyCompleted = task.completedChapters
            .filter((chapterIndex) => !seenCompleted.has(chapterIndex))
            .sort((a, b) => a - b);
          for (const chapterIndex of newlyCompleted) {
            seenCompleted.add(chapterIndex);
            sendEvent('chapter_complete', {
              chapterIndex,
              title: `第 ${chapterIndex} 章`,
              preview: '',
              wordCount: 0,
            });
          }

          const newlyFailed = task.failedChapters
            .filter((chapterIndex) => !seenFailed.has(chapterIndex))
            .sort((a, b) => a - b);
          for (const chapterIndex of newlyFailed) {
            seenFailed.add(chapterIndex);
            sendEvent('chapter_error', {
              chapterIndex,
              error: `第 ${chapterIndex} 章生成失败`,
            });
          }

          if (task.currentMessage !== lastMessage || task.currentProgress !== lastProgress) {
            lastMessage = task.currentMessage;
            lastProgress = task.currentProgress;
            sendEvent('progress', {
              current: task.completedChapters.length,
              total: task.targetCount,
              chapterIndex: task.currentProgress || undefined,
              status: 'generating',
              message: task.currentMessage || '任务执行中...',
            });
          }

          if (task.status === 'completed') {
            const generated = [...task.completedChapters]
              .sort((a, b) => a - b)
              .map((chapter) => ({ chapter, title: `第 ${chapter} 章` }));
            const failedChapters = [...task.failedChapters].sort((a, b) => a - b);
            sendEvent('done', {
              success: true,
              taskId: task.id,
              generated,
              failedChapters,
              totalGenerated: generated.length,
              totalFailed: failedChapters.length,
            });
            close();
            return;
          }

          if (task.status === 'failed') {
            const cancelled = Boolean(
              (task.errorMessage && task.errorMessage.includes('取消'))
              || (task.currentMessage && task.currentMessage.includes('取消'))
              || task.cancelRequested
            );
            sendEvent('error', {
              error: task.errorMessage || '任务执行失败',
              cancelled,
              taskId: task.id,
            });
            close();
            return;
          }

          if (task.status === 'paused') {
            sendEvent('error', {
              error: task.currentMessage || '任务已暂停，请重新发起',
              cancelled: Boolean(task.cancelRequested),
              taskId: task.id,
            });
            close();
            return;
          }
        } catch (err) {
          sendEvent('error', { error: (err as Error).message, taskId });
          close();
        } finally {
          pollInFlight = false;
        }
      };

      sendEvent('start', {
        total: initialTask?.targetCount || chaptersToGenerate,
      });

      if (isResumed && initialTask) {
        sendEvent('task_resumed', {
          taskId: initialTask.id,
          completedChapters: initialTask.completedChapters,
          targetCount: initialTask.targetCount,
          currentProgress: initialTask.currentProgress,
          currentMessage: initialTask.currentMessage,
        });
      } else {
        sendEvent('task_created', { taskId });
      }

      heartbeatInterval = setInterval(() => {
        sendEvent('heartbeat');
      }, 5000);

      pollInterval = setInterval(() => {
        void emitTaskSnapshot();
      }, 1200);

      void emitTaskSnapshot();

      c.req.raw.signal.addEventListener('abort', () => {
        close();
      });
    },
    cancel() {
      // no-op
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
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_chapter');

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
      SELECT p.id, p.name, p.bible, s.*, o.outline_json, c.characters_json,
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
      WHERE (p.id = ? OR p.name = ?) AND p.user_id = ?
      ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
      LIMIT 1
    `).bind(name, name, userId, name).first() as any;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const runningTask = await checkRunningTask(c.env.DB, project.id, userId);
    if (runningTask.isRunning) {
      return c.json(
        { success: false, error: '当前有后台章节任务正在运行，请先等待完成或取消任务后再发起此请求。' },
        409
      );
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
              projectName: project.name,
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
  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_outline');

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





// Refine outline (regenerate missing/incomplete volumes) - SSE streaming
generationRoutes.post('/projects/:name/outline/refine', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const aiConfig = await getAIConfig(c, c.env.DB, 'refine_outline');

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (type: string, data: any) => {
        try {
          const payload = JSON.stringify({ type, ...data });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch (e) {
          console.error('Error sending SSE event', e);
        }
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
        // Get project (user-scoped)
        const project = await c.env.DB.prepare(`
          SELECT id, bible
          FROM projects
          WHERE (id = ? OR name = ?) AND user_id = ?
          ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at DESC
          LIMIT 1
        `).bind(name, name, userId, name).first();

        if (!project) {
          sendEvent('error', { error: 'Project not found' });
          clearInterval(heartbeatInterval);
          controller.close();
          return;
        }

        // Get current outline
        const outlineRecord = await c.env.DB.prepare(`
          SELECT outline_json FROM outlines WHERE project_id = ?
        `).bind((project as any).id).first();

        if (!outlineRecord) {
          sendEvent('error', { error: 'Outline not found' });
          clearInterval(heartbeatInterval);
          controller.close();
          return;
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
        const volumesToRefine: number[] = [];

        if (typeof volumeIndex === 'number' && volumeIndex >= 0 && volumeIndex < volumes.length) {
          volumesToRefine.push(volumeIndex);
        } else {
          // Auto-detect incomplete volumes
          for (let i = 0; i < volumes.length; i++) {
            const vol = volumes[i];
            const chapters = vol.chapters || [];
            const expectedCount = (vol.endChapter - vol.startChapter) + 1;
            const hasContentCount = chapters.filter((c: any) => c.goal && c.goal.length > 5).length;
            const isPlaceholder = chapters.length <= 1;
            const isEmpty = hasContentCount < (Math.max(5, expectedCount * 0.1));

            if (isPlaceholder || isEmpty) {
              volumesToRefine.push(i);
            }
          }
        }

        sendEvent('start', { 
          totalVolumes: volumesToRefine.length,
          volumeIndices: volumesToRefine,
        });

        for (let vi = 0; vi < volumesToRefine.length; vi++) {
          const idx = volumesToRefine[vi];
          const vol = volumes[idx];

          sendEvent('progress', {
            current: vi + 1,
            total: volumesToRefine.length,
            volumeIndex: idx,
            volumeTitle: vol.title,
            message: `正在生成第 ${idx + 1} 卷「${vol.title}」的章节大纲... (${vi + 1}/${volumesToRefine.length})`,
          });

          console.log(`Refining Volume ${idx + 1}: ${vol.title}`);

          // Build previousVolumeSummary from the preceding volume for context alignment
          let previousVolumeSummary: string | undefined;
          if (idx > 0) {
            const prevVol = volumes[idx - 1];
            previousVolumeSummary = prevVol.volumeEndState ||
              `${prevVol.climax}（主角已达成：${prevVol.goal}）`;
          }

          const chaptersData = await generateVolumeChapters(aiConfig, { 
            bible, 
            masterOutline: outline, 
            volume: vol,
            previousVolumeSummary,
          });
          volumes[idx] = normalizeVolume({ ...vol, chapters: chaptersData }, idx, chaptersData);
          updated = true;

          sendEvent('volume_complete', {
            current: vi + 1,
            total: volumesToRefine.length,
            volumeIndex: idx,
            volumeTitle: vol.title,
            chapterCount: chaptersData.length,
            message: `第 ${idx + 1} 卷「${vol.title}」完成 (${chaptersData.length} 章)`,
          });
        }

        if (updated) {
          outline.volumes = volumes;

          // Save updated outline
          await c.env.DB.prepare(`
            UPDATE outlines SET outline_json = ? WHERE project_id = ?
          `).bind(JSON.stringify(outline), (project as any).id).run();

          sendEvent('done', { success: true, message: 'Outline refined successfully', outline });
        } else {
          sendEvent('done', { success: true, message: 'Outline is already complete', outline });
        }

        clearInterval(heartbeatInterval);
        controller.close();
      } catch (error) {
        console.error('Refine outline error:', error);
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
