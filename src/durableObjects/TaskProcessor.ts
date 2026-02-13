import { DurableObject } from 'cloudflare:workers';
import type { QueuedTask, ChapterTaskParams, OutlineTaskParams } from './TaskQueue.js';
import type { Env } from '../worker.js';
import type { AIConfig } from '../services/aiClient.js';

export class TaskProcessor extends DurableObject<Env> {
  private isProcessing = false;
  private currentTaskId: string | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.isProcessing = await this.ctx.storage.get<boolean>('isProcessing') || false;
      this.currentTaskId = await this.ctx.storage.get<string | null>('currentTaskId') || null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/process-next' && request.method === 'GET') {
        return this.processNext();
      } else if (path === '/status' && request.method === 'GET') {
        return new Response(JSON.stringify({ 
          isProcessing: this.isProcessing, 
          currentTaskId: this.currentTaskId 
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  private async processNext(): Promise<Response> {
    // If already processing, skip
    if (this.isProcessing) {
      return new Response(JSON.stringify({ success: true, message: 'Already processing' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get the queue DO
    const queueId = this.env.TASK_QUEUE.idFromName('global-queue');
    const queue = this.env.TASK_QUEUE.get(queueId);

    // Dequeue next task
    const dequeueResp = await queue.fetch('https://task-queue/dequeue', {
      method: 'POST',
    });
    const dequeueData = await dequeueResp.json() as { success: boolean; task: QueuedTask | null };

    if (!dequeueData.success || !dequeueData.task) {
      return new Response(JSON.stringify({ success: true, message: 'No tasks to process' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const task = dequeueData.task;
    this.isProcessing = true;
    this.currentTaskId = task.id;
    await this.ctx.storage.put('isProcessing', true);
    await this.ctx.storage.put('currentTaskId', task.id);

    // Process the task in the background using ctx.waitUntil
    this.ctx.waitUntil(this.processTask(task));

    return new Response(JSON.stringify({ success: true, taskId: task.id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async processTask(task: QueuedTask): Promise<void> {
    try {
      console.log(`Processing task ${task.id} of type ${task.type}`);

      if (task.type === 'chapter') {
        await this.processChapterTask(task);
      } else if (task.type === 'outline') {
        await this.processOutlineTask(task);
      } else {
        throw new Error(`Unknown task type: ${task.type}`);
      }

      // Mark task as completed
      await this.updateTaskStatus(task.id, {
        status: 'completed',
        progress: 100,
        message: 'Task completed successfully',
      });

    } catch (error) {
      console.error(`Task ${task.id} failed:`, error);
      
      // Mark task as failed
      await this.updateTaskStatus(task.id, {
        status: 'failed',
        error: (error as Error).message,
      });
    } finally {
      // Clear processing state
      this.isProcessing = false;
      this.currentTaskId = null;
      await this.ctx.storage.put('isProcessing', false);
      await this.ctx.storage.put('currentTaskId', null);

      // Trigger processing of next task by calling ourselves
      // This is safe because we cleared isProcessing first
      this.fetch(new Request('https://task-processor/process-next')).catch((err: Error) => {
        console.error('Failed to trigger next task:', err);
      });
    }
  }

  private async processChapterTask(task: QueuedTask): Promise<void> {
    if (task.type !== 'chapter') {
      throw new Error('Invalid task type for processChapterTask');
    }
    
    const params = task.params as ChapterTaskParams;
    const { chaptersToGenerate = 1 } = params;
    const { projectId, userId } = task;

    // Import generation logic
    const { writeOneChapter } = await import('../generateChapter.js');
    const { createGenerationTask, updateTaskProgress, completeTask, updateTaskMessage } = await import('../routes/tasks.js');

    // Get project with state and outline
    const project = await this.env.DB.prepare(`
      SELECT p.id, p.bible, s.*, o.outline_json, c.characters_json
      FROM projects p
      JOIN states s ON p.id = s.project_id
      LEFT JOIN outlines o ON p.id = o.project_id
      LEFT JOIN characters c ON p.id = c.project_id
      WHERE p.id = ? AND p.user_id = ?
    `).bind(projectId, userId).first() as any;

    if (!project) {
      throw new Error('Project not found');
    }

    // Validate state
    const maxChapterResult = await this.env.DB.prepare(`
      SELECT MAX(chapter_index) as max_index FROM chapters WHERE project_id = ? AND deleted_at IS NULL
    `).bind(project.id).first() as any;

    const actualMaxChapter = maxChapterResult?.max_index || 0;
    const expectedNextIndex = actualMaxChapter + 1;

    if (project.next_chapter_index !== expectedNextIndex) {
      project.next_chapter_index = expectedNextIndex;
      await this.env.DB.prepare(`
        UPDATE states SET next_chapter_index = ? WHERE project_id = ?
      `).bind(expectedNextIndex, project.id).run();
    }

    const outline = project.outline_json ? JSON.parse(project.outline_json) : null;
    const characters = project.characters_json ? JSON.parse(project.characters_json) : undefined;
    const startingChapterIndex = project.next_chapter_index;

    // Create generation task in DB for tracking
    const dbTaskId = await createGenerationTask(
      this.env.DB,
      project.id,
      userId,
      chaptersToGenerate,
      startingChapterIndex
    );

    // Generate chapters
    for (let i = 0; i < chaptersToGenerate; i++) {
      const chapterIndex = startingChapterIndex + i;
      if (chapterIndex > project.total_chapters) break;

      // Update progress
      await this.updateTaskStatus(task.id, {
        progress: Math.floor((i / chaptersToGenerate) * 100),
        message: `正在生成第 ${chapterIndex} 章...`,
      });

      await updateTaskMessage(this.env.DB, dbTaskId, `正在生成第 ${chapterIndex} 章...`, chapterIndex);

      try {
        // Get last 2 chapters
        const { results: lastChapters } = await this.env.DB.prepare(`
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
              chapterGoalHint = ch.goal;
              outlineTitle = ch.title;
              break;
            }
          }
        }

        const recentChaptersText = (lastChapters as any[])
          .reverse()
          .map((c: any) => c.content);

        // Generate chapter
        const result = await writeOneChapter({
          aiConfig: task.aiConfig as AIConfig,
          bible: project.bible,
          rollingSummary: project.rolling_summary || '',
          openLoops: JSON.parse(project.open_loops || '[]'),
          lastChapters: recentChaptersText,
          chapterIndex,
          totalChapters: project.total_chapters,
          chapterGoalHint,
          chapterTitle: outlineTitle,
          characters,
        });

        // Save chapter
        await this.env.DB.prepare(`
          INSERT INTO chapters (project_id, chapter_index, content)
          VALUES (?, ?, ?)
        `).bind(project.id, chapterIndex, result.chapterText).run();

        // Update state - compute next state
        const nextChapterIndex = chapterIndex + 1;
        await this.env.DB.prepare(`
          UPDATE states 
          SET next_chapter_index = ?, rolling_summary = ?, open_loops = ?
          WHERE project_id = ?
        `).bind(
          nextChapterIndex,
          result.updatedSummary,
          JSON.stringify(result.updatedOpenLoops),
          project.id
        ).run();

        // Update task progress
        await updateTaskProgress(this.env.DB, dbTaskId, chapterIndex, false, `第 ${chapterIndex} 章完成`);

      } catch (error) {
        console.error(`Failed to generate chapter ${chapterIndex}:`, error);
        await updateTaskProgress(this.env.DB, dbTaskId, chapterIndex, true, `第 ${chapterIndex} 章生成失败: ${(error as Error).message}`);
      }
    }

    // Complete DB task
    await completeTask(this.env.DB, dbTaskId, true);
  }

  private async processOutlineTask(task: QueuedTask): Promise<void> {
    if (task.type !== 'outline') {
      throw new Error('Invalid task type for processOutlineTask');
    }
    
    const params = task.params as OutlineTaskParams;
    const { targetChapters = 400, targetWordCount = 100, customPrompt } = params;
    const { projectId, projectName, userId } = task;

    // Import generation logic
    const { generateMasterOutline, generateVolumeChapters } = await import('../generateOutline.js');

    // Get project
    const project = await this.env.DB.prepare(`
      SELECT id, bible FROM projects WHERE id = ? AND deleted_at IS NULL AND user_id = ?
    `).bind(projectId, userId).first() as any;

    if (!project) {
      throw new Error('Project not found');
    }

    let bible = project.bible;
    if (customPrompt) {
      bible = `${bible}\n\n## 用户自定义要求\n${customPrompt}`;
    }

    // Update progress
    await this.updateTaskStatus(task.id, {
      progress: 10,
      message: '正在生成总体大纲...',
    });

    // Phase 1: Generate master outline
    console.log('Phase 1: Generating master outline...');
    const masterOutline = await generateMasterOutline(task.aiConfig as AIConfig, { bible, targetChapters, targetWordCount });
    const totalVolumes = masterOutline.volumes?.length || 0;
    console.log(`Master outline generated: ${totalVolumes} volumes`);

    // Phase 2: Generate volume chapters
    const volumes = [];
    for (let i = 0; i < masterOutline.volumes.length; i++) {
      const vol = masterOutline.volumes[i];
      const previousVolumeEndState = i > 0 
        ? masterOutline.volumes[i - 1].volumeEndState || 
          `${masterOutline.volumes[i - 1].climax}（主角已达成：${masterOutline.volumes[i - 1].goal}）`
        : null;
      
      // Update progress
      await this.updateTaskStatus(task.id, {
        progress: 10 + Math.floor((i / totalVolumes) * 80),
        message: `正在生成第 ${i + 1}/${totalVolumes} 卷「${vol.title}」的章节...`,
      });

      console.log(`Phase 2.${i + 1}: Generating chapters for volume ${i + 1}/${totalVolumes} "${vol.title}"...`);
      
      const chapters = await generateVolumeChapters(task.aiConfig as AIConfig, { 
        bible, 
        masterOutline, 
        volume: vol, 
        previousVolumeSummary: previousVolumeEndState || undefined 
      });

      const normalizedVolume = this.normalizeVolume(vol, i, chapters);
      volumes.push(normalizedVolume);
    }

    // Build final outline
    const finalOutline = {
      totalChapters: targetChapters,
      targetWordCount,
      volumes,
      mainGoal: masterOutline.mainGoal,
      milestones: this.normalizeMilestones(masterOutline.milestones || []),
    };

    // Validate outline
    const validation = this.validateOutline(finalOutline, targetChapters);
    if (!validation.valid) {
      console.warn('Outline validation issues:', validation.issues);
    }

    // Save outline to DB
    await this.env.DB.prepare(`
      INSERT OR REPLACE INTO outlines (project_id, outline_json)
      VALUES (?, ?)
    `).bind(project.id, JSON.stringify(finalOutline)).run();

    // Update state - use projectName as fallback since masterOutline doesn't have bookTitle
    await this.env.DB.prepare(`
      UPDATE states SET book_title = ? WHERE project_id = ?
    `).bind(projectName, project.id).run();

    // Update progress
    await this.updateTaskStatus(task.id, {
      progress: 100,
      message: '大纲生成完成',
    });
  }

  private normalizeVolume(vol: any, volIndex: number, chapters: any[]): any {
    const startChapter = vol.startChapter ?? vol.start_chapter ?? (volIndex * 80 + 1);
    const endChapter = vol.endChapter ?? vol.end_chapter ?? ((volIndex + 1) * 80);

    return {
      title: vol.title || vol.volumeTitle || vol.volume_title || `第${volIndex + 1}卷`,
      startChapter,
      endChapter,
      goal: vol.goal || vol.summary || vol.volume_goal || '',
      conflict: vol.conflict || '',
      climax: vol.climax || '',
      chapters: chapters.map((ch, i) => this.normalizeChapter(ch, startChapter + i)),
    };
  }

  private normalizeChapter(ch: any, fallbackIndex: number): { index: number; title: string; goal: string; hook: string } {
    return {
      index: ch.index ?? ch.chapter_id ?? ch.chapter_number ?? fallbackIndex,
      title: ch.title || `第${fallbackIndex}章`,
      goal: ch.goal || ch.outline || ch.description || ch.plot_summary || '',
      hook: ch.hook || '',
    };
  }

  private normalizeMilestones(milestones: any[]): string[] {
    if (!Array.isArray(milestones)) return [];
    return milestones.map((m) => {
      if (typeof m === 'string') return m;
      return m.milestone || m.description || m.title || JSON.stringify(m);
    });
  }

  private validateOutline(outline: any, targetChapters: number): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    let totalChaptersInOutline = 0;
    const allIndices = new Set<number>();

    for (const vol of outline.volumes || []) {
      for (const ch of vol.chapters || []) {
        totalChaptersInOutline++;
        allIndices.add(ch.index);

        if (!ch.title || ch.title.match(/^第?\d+章?$/) || ch.title.includes('待补充')) {
          issues.push(`第${ch.index}章标题缺失或为占位符`);
        }

        if (!ch.goal || ch.goal === '待补充' || ch.goal.length < 10) {
          issues.push(`第${ch.index}章目标缺失或过短`);
        }
      }
    }

    for (let i = 1; i <= targetChapters; i++) {
      if (!allIndices.has(i)) {
        issues.push(`缺失第${i}章`);
      }
    }

    if (totalChaptersInOutline !== targetChapters) {
      issues.push(`章节总数不匹配: 实际${totalChaptersInOutline}章 vs 目标${targetChapters}章`);
    }

    return {
      valid: issues.length === 0,
      issues: issues.slice(0, 20),
    };
  }

  private async updateTaskStatus(taskId: string, updates: Partial<QueuedTask>): Promise<void> {
    const queueId = this.env.TASK_QUEUE.idFromName('global-queue');
    const queue = this.env.TASK_QUEUE.get(queueId);

    await queue.fetch('https://task-queue/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, updates }),
    });
  }
}
