// API client for novel automation backend
const API_BASE = '/api';

import type { CharacterRelationGraph } from '../types/characters';
import { getAuthHeaders } from './auth';

export type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  state: BookState;
  hasOutline: boolean;
  outlineSummary: {
    totalChapters: number;
    targetWordCount: number;
    volumeCount: number;
    mainGoal: string;
  } | null;
};

export type BookState = {
  bookTitle: string;
  totalChapters: number;
  minChapterWords: number;
  nextChapterIndex: number;
  rollingSummary: string;
  openLoops: string[];
  needHuman?: boolean;
  needHumanReason?: string;
};

export type NovelOutline = {
  totalChapters: number;
  targetWordCount: number;
  volumes: VolumeOutline[];
  mainGoal: string;
  milestones: string[];
};

export type VolumeOutline = {
  title: string;
  startChapter: number;
  endChapter: number;
  goal: string;
  conflict: string;
  climax: string;
  chapters: ChapterOutline[];
};

export type ChapterOutline = {
  index: number;
  title: string;
  goal: string;
  hook: string;
};

export type ProjectDetail = {
  id: string;
  name: string;
  path: string;
  state: BookState;
  bible: string;
  background?: string;
  role_settings?: string;
  outline: NovelOutline | null;
  chapters: string[];
};

export type BibleImagineTemplate = {
  id: string;
  name: string;
  genre: string;
  coreTheme: string;
  oneLineSellingPoint: string;
  keywords: string[];
  protagonistSetup: string;
  hookDesign: string;
  conflictDesign: string;
  growthRoute: string;
  fanqieSignals: string[];
  recommendedOpening: string;
  sourceBooks: string[];
};

export type BibleTemplateSnapshotSummary = {
  snapshotDate: string;
  templateCount: number;
  status: 'ready' | 'error';
  createdAt: number;
  updatedAt: number;
};

export type BibleTemplateSnapshotResponse = {
  snapshotDate: string | null;
  templates: BibleImagineTemplate[];
  ranking: Array<{
    rank: number;
    title: string;
    author?: string;
    summary?: string;
    status?: string;
    category?: string;
    url?: string;
    sourceUrl?: string;
  }>;
  status: 'ready' | 'error' | null;
  errorMessage: string | null;
  availableSnapshots: BibleTemplateSnapshotSummary[];
};

// Helper to merge headers with auth
function mergeHeaders(base: Record<string, string>, extra?: Record<string, string>): Record<string, string> {
  return { ...getAuthHeaders(), ...base, ...extra };
}

// Helper to get default headers with auth
function defaultHeaders(): Record<string, string> {
  return getAuthHeaders();
}

// API functions
export async function fetchProjects(): Promise<ProjectSummary[]> {
  const res = await fetch(`${API_BASE}/projects`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return (data.projects as Array<Record<string, unknown>>).map((project) => {
    const id = String(project.id || project.path || '');
    return {
      ...project,
      id,
      path: String(project.path || id),
    } as ProjectSummary;
  });
}

export async function fetchProject(name: string): Promise<ProjectDetail> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  const id = String(data.project.id || data.project.path || '');
  return {
    ...data.project,
    id,
    path: String(data.project.path || id),
  } as ProjectDetail;
}

export async function createProject(
  name: string,
  bible: string,
  totalChapters: number,
  minChapterWords?: number
): Promise<{ id: string; name: string }> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, bible, totalChapters, minChapterWords }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.project as { id: string; name: string };
}

export async function updateBible(name: string, bible: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/bible`, {
    method: 'PUT',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ bible }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export async function generateOutline(
  name: string,
  targetChapters: number,
  targetWordCount: number,
  minChapterWords?: number,
  customPrompt?: string,
  aiHeaders?: Record<string, string>,
  onProgress?: (message: string) => void
): Promise<NovelOutline> {
  const { taskId } = await startOutlineGeneration(
    name,
    targetChapters,
    targetWordCount,
    minChapterWords,
    customPrompt,
    aiHeaders
  );

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  let networkRetry = 0;
  const MAX_NETWORK_RETRY = 30;

  while (true) {
    try {
      const task = await getTaskById(taskId);
      if (!task) {
        throw new Error('大纲任务不存在或已失效');
      }

      if (task.currentMessage && onProgress) {
        onProgress(task.currentMessage);
      }

      if (task.status === 'completed') {
        const latestProject = await fetchProject(name);
        if (!latestProject.outline) {
          throw new Error('任务已完成，但未读取到大纲数据');
        }
        return latestProject.outline;
      }

      if (task.status === 'failed') {
        throw new Error(task.errorMessage || task.currentMessage || '大纲生成失败');
      }

      networkRetry = 0;
      await sleep(1500);
    } catch (error) {
      if (isLikelyNetworkError(error) && networkRetry < MAX_NETWORK_RETRY) {
        networkRetry += 1;
        onProgress?.(`网络波动，后台仍在执行，重连中（${networkRetry}/${MAX_NETWORK_RETRY}）...`);
        await sleep(Math.min(5000, 800 * networkRetry));
        continue;
      }
      throw error;
    }
  }
}

export async function startOutlineGeneration(
  name: string,
  targetChapters: number,
  targetWordCount: number,
  minChapterWords?: number,
  customPrompt?: string,
  aiHeaders?: Record<string, string>,
): Promise<{ taskId: number; message: string }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/outline`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ targetChapters, targetWordCount, customPrompt, minChapterWords }),
  });

  const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return {
    taskId: data.taskId,
    message: data.message || 'Task started',
  };
}

export async function refineOutline(
  name: string,
  volumeIndex?: number,
  aiHeaders?: Record<string, string>,
  callbacks?: {
    onStart?: (totalVolumes: number) => void;
    onProgress?: (data: { current: number; total: number; volumeIndex: number; volumeTitle: string; message: string }) => void;
    onVolumeComplete?: (data: { current: number; total: number; volumeIndex: number; volumeTitle: string; chapterCount: number; message: string }) => void;
    onDone?: (outline: NovelOutline, message: string) => void;
    onError?: (error: string) => void;
  }
): Promise<NovelOutline> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/outline/refine`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ volumeIndex }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(errorData.error || `Request failed: ${res.status}`);
  }

  if (!res.body) {
    throw new Error('No response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let resultOutline: NovelOutline | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr) {
            try {
              const event = JSON.parse(jsonStr);

              if (event.type === 'heartbeat') continue;

              if (event.type === 'start') {
                callbacks?.onStart?.(event.totalVolumes);
              } else if (event.type === 'progress') {
                callbacks?.onProgress?.(event);
              } else if (event.type === 'volume_complete') {
                callbacks?.onVolumeComplete?.(event);
              } else if (event.type === 'done') {
                resultOutline = event.outline;
                callbacks?.onDone?.(event.outline, event.message);
                reader.releaseLock();
                return event.outline as NovelOutline;
              } else if (event.type === 'error') {
                callbacks?.onError?.(event.error);
                throw new Error(event.error || 'Refine failed');
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!resultOutline) {
    throw new Error('No outline received from refine');
  }
  return resultOutline;
}

export async function updateOutline(name: string, outline: NovelOutline): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/outline`, {
    method: 'PUT',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ outline }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export async function generateChapters(
  name: string,
  chaptersToGenerate: number,
  minChapterWords?: number,
  aiHeaders?: Record<string, string>
): Promise<{ taskId: number; message: string }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/generate`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ chaptersToGenerate, minChapterWords }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (!data.success) throw new Error(data.error || 'Generation failed');
  return {
    taskId: data.taskId,
    message: data.message
  };
}

// Streaming generation event types
export type GenerationEventType =
  | 'start'
  | 'progress'
  | 'chapter_complete'
  | 'chapter_error'
  | 'done'
  | 'error'
  | 'heartbeat'
  | 'task_resumed'
  | 'task_created';

export type GenerationEvent = {
  type: GenerationEventType;
  // start event
  total?: number; // For start event
  // task_resumed event
  taskId?: number;
  completedChapters?: number[];
  targetCount?: number;
  currentProgress?: number;
  currentMessage?: string;
  // progress event
  current?: number;
  chapterIndex?: number;
  status?: 'preparing' | 'generating' | 'analyzing' | 'planning' | 'reviewing' | 'repairing' | 'saving' | 'updating_summary';
  message?: string;
  // chapter_complete event
  title?: string;
  preview?: string;
  wordCount?: number;
  // chapter_error event
  error?: string;
  cancelled?: boolean;
  // done event
  success?: boolean;
  generated?: { chapter: number; title: string }[];
  failedChapters?: number[];
  totalGenerated?: number;
  totalFailed?: number;
};



/**
 * Stream chapter generation with real-time updates
 * Returns an AsyncGenerator that yields GenerationEvent objects
 */
export async function* generateChaptersStream(
  name: string,
  chaptersToGenerate: number,
  aiHeaders?: Record<string, string>,
  signal?: AbortSignal,
  options?: { index?: number; regenerate?: boolean; minChapterWords?: number }
): AsyncGenerator<GenerationEvent, void, unknown> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/generate-stream`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({
      chaptersToGenerate,
      index: options?.index,
      regenerate: options?.regenerate,
      minChapterWords: options?.minChapterWords,
    }),
    signal,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(errorData.error || `Request failed: ${res.status}`);
  }

  if (!res.body) {
    throw new Error('No response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr) {
            try {
              const event = JSON.parse(jsonStr) as GenerationEvent;
              // Skip heartbeat events (but they keep connection alive)
              if (event.type !== 'heartbeat') {
                yield event;
              }
              // If done or error, we're finished correctly
              if (event.type === 'done' || event.type === 'error') {
                return;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Convenient wrapper for streaming generation with callbacks
 * Includes auto-reconnect logic for network failures
 */
export async function generateChaptersWithProgress(
  name: string,
  chaptersToGenerate: number,
  callbacks: {
    onStart?: (total: number) => void;
    onTaskResumed?: (event: GenerationEvent) => void;
    onTaskCreated?: (event: GenerationEvent) => void;
    onProgress?: (event: GenerationEvent) => void;
    onChapterComplete?: (chapterIndex: number, title: string, preview: string) => void;
    onChapterError?: (chapterIndex: number, error: string) => void;
    onDone?: (results: { chapter: number; title: string }[], failedChapters: number[]) => void;
    onError?: (error: string) => void;
    onReconnecting?: (attempt: number, maxAttempts: number) => void;
  },
  aiHeaders?: Record<string, string>,
  signal?: AbortSignal,
  options?: {
    index?: number;
    regenerate?: boolean;
    minChapterWords?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  }
): Promise<{ chapter: number; title: string }[]> {
  const { maxRetries = 5, retryDelayMs = 3000, index, regenerate, minChapterWords } = options || {};
  const results: { chapter: number; title: string }[] = [];
  let retryCount = 0;

  const isNetworkError = (error: unknown): boolean => {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return msg.includes('network') ||
        msg.includes('fetch') ||
        msg.includes('connection') ||
        msg.includes('net::err') ||
        msg.includes('aborted');
    }
    return false;
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  while (retryCount <= maxRetries) {
    try {
      // Check how many chapters we still need to generate
      // The backend will automatically resume from next_chapter_index

      // Only check remaining if NOT in resume mode yet (to avoid infinite loop if backend issue)
      // But actually, we just rely on calling generate-stream. 
      // If task is running, backend returns it.

      for await (const event of generateChaptersStream(name, chaptersToGenerate, aiHeaders, signal, {
        index,
        regenerate,
        minChapterWords,
      })) {
        switch (event.type) {
          case 'start':
            if (retryCount === 0) {
              callbacks.onStart?.(event.total || chaptersToGenerate);
            }
            break;
          case 'task_resumed':
            callbacks.onTaskResumed?.(event);
            break;
          case 'task_created':
            callbacks.onTaskCreated?.(event);
            break;
          case 'progress':
            callbacks.onProgress?.(event);
            break;
          case 'chapter_complete':
            if (event.chapterIndex !== undefined && event.title) {
              // Avoid duplicates if we resume multiple times
              if (!results.some(r => r.chapter === event.chapterIndex)) {
                results.push({ chapter: event.chapterIndex, title: event.title });
              }
              callbacks.onChapterComplete?.(event.chapterIndex, event.title, event.preview || '');
            }
            break;
          case 'chapter_error':
            if (event.chapterIndex !== undefined) {
              callbacks.onChapterError?.(event.chapterIndex, event.error || 'Unknown error');
            }
            break;
          case 'done':
            callbacks.onDone?.(event.generated || results, event.failedChapters || []);
            return event.generated || results;
          case 'error':
            if (event.cancelled) {
              callbacks.onError?.(event.error || '任务已取消');
              return results;
            }
            callbacks.onError?.(event.error || 'Unknown error');
            throw new Error(event.error || 'Generation failed');
        }
      }

      // Stream ended normally
      break;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled, don't retry
        return results;
      }

      if (isNetworkError(error) && retryCount < maxRetries) {
        retryCount++;
        callbacks.onReconnecting?.(retryCount, maxRetries);
        await sleep(retryDelayMs * retryCount);
        continue; // Retry - backend will resume from where it left off
      }

      // Non-network error or max retries exceeded
      throw error;
    }
  }

  return results;
}

// Generation Task type
export type GenerationTask = {
  id: number;
  taskType: 'chapters' | 'outline' | 'bible' | 'other';
  projectId: string;
  projectName: string;
  userId: string;
  targetCount: number;
  startChapter: number;
  completedChapters: number[];
  failedChapters: number[];
  currentProgress: number;  // Current chapter being processed
  currentMessage: string | null;  // Status message for sync
  cancelRequested: boolean;
  status: 'running' | 'paused' | 'completed' | 'failed';
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  updatedAtMs: number;  // Unix timestamp in ms for reliable health check
};

function isLikelyNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('network')
      || msg.includes('fetch')
      || msg.includes('connection')
      || msg.includes('net::err')
      || msg.includes('aborted')
      || msg.includes('failed to fetch');
  }
  return false;
}

export async function getTaskById(taskId: number): Promise<GenerationTask | null> {
  const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(String(taskId))}`, {
    headers: defaultHeaders(),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({ success: false }));
  if (!res.ok || !data.success) {
    return null;
  }
  return data.task;
}

// Get active generation task for a project
// Get active generation task for a project
export async function getActiveTask(name: string): Promise<GenerationTask | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/active-task?t=${Date.now()}`, {
    headers: defaultHeaders(),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!data.success) return null;
  return data.task;
}

// Cancel/delete a generation task
export async function cancelTask(name: string, taskId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/tasks/${taskId}/cancel`, {
    method: 'POST',
    headers: defaultHeaders(),
  });
  const data = await res.json().catch(() => ({ success: res.ok }));
  if (!res.ok || !data.success) {
    throw new Error(data.error || '取消任务失败');
  }
}

// Cancel a task directly by taskId (preferred, avoids project name/id mismatch)
export async function cancelTaskById(taskId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(String(taskId))}/cancel`, {
    method: 'POST',
    headers: defaultHeaders(),
  });
  const data = await res.json().catch(() => ({ success: res.ok }));
  if (!res.ok || !data.success) {
    throw new Error(data.error || '取消任务失败');
  }
}

// Request cancellation for ALL active generation tasks for a project
export async function cancelAllActiveTasks(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/active-tasks/cancel`, {
    method: 'POST',
    headers: defaultHeaders(),
  });
  const data = await res.json().catch(() => ({ success: res.ok }));
  if (!res.ok || !data.success) {
    throw new Error(data.error || '批量取消任务失败');
  }
}

// Get all active generation tasks for the current user (global)
export async function getAllActiveTasks(): Promise<GenerationTask[]> {
  const res = await fetch(`${API_BASE}/active-tasks`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) return [];
  return data.tasks;
}

export async function fetchChapter(name: string, index: number): Promise<string> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/${index}`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.content;
}

export async function deleteProject(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export async function resetProject(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/reset`, {
    method: 'PUT',
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export async function deleteChapter(name: string, index: number): Promise<{ newNextChapterIndex: number }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/${index}`, {
    method: 'DELETE',
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return { newNextChapterIndex: data.newNextChapterIndex };
}

export async function batchDeleteChapters(name: string, indices: number[]): Promise<{ deletedIndices: number[]; newNextChapterIndex: number }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/batch-delete`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ indices }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return { deletedIndices: data.deletedIndices, newNextChapterIndex: data.newNextChapterIndex };
}

export async function fetchBibleTemplates(snapshotDate?: string): Promise<BibleTemplateSnapshotResponse> {
  const suffix = snapshotDate ? `?snapshotDate=${encodeURIComponent(snapshotDate)}` : '';
  const res = await fetch(`${API_BASE}/bible-templates${suffix}`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch bible templates');
  return {
    snapshotDate: data.snapshotDate ?? null,
    templates: Array.isArray(data.templates) ? data.templates : [],
    ranking: Array.isArray(data.ranking) ? data.ranking : [],
    status: data.status ?? null,
    errorMessage: data.errorMessage ?? null,
    availableSnapshots: Array.isArray(data.availableSnapshots) ? data.availableSnapshots : [],
  };
}

export async function generateBible(
  options?: {
    genre?: string;
    theme?: string;
    keywords?: string;
    templateId?: string;
    templateSnapshotDate?: string;
    template?: BibleImagineTemplate;
  },
  aiHeaders?: Record<string, string>
): Promise<string> {
  const res = await fetch(`${API_BASE}/generate-bible`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({
      genre: options?.genre,
      theme: options?.theme,
      keywords: options?.keywords,
      templateId: options?.templateId,
      templateSnapshotDate: options?.templateSnapshotDate,
      template: options?.template,
    }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.bible;
}

export async function testAIConnection(config: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/config/test`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(config),
  });
  const data = await res.json();
  return data;
}
// Character API
export async function fetchCharacters(name: string): Promise<CharacterRelationGraph | null> {
  const res = await fetch(`${API_BASE}/characters/${encodeURIComponent(name)}`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.characters;
}

export async function generateCharacters(
  name: string,
  aiHeaders?: Record<string, string>
): Promise<CharacterRelationGraph> {
  const res = await fetch(`${API_BASE}/characters/${encodeURIComponent(name)}/generate`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.characters;
}

export async function updateCharacters(name: string, characters: CharacterRelationGraph): Promise<void> {
  const res = await fetch(`${API_BASE}/characters/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ characters }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

// Chapter editing APIs
export async function updateChapter(name: string, index: number, content: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/${index}`, {
    method: 'PUT',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export async function refineChapterText(
  name: string,
  index: number,
  selectedText: string,
  instruction: string,
  context?: string,
  aiHeaders?: Record<string, string>
): Promise<{ originalText: string; refinedText: string }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/${index}/refine`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ selectedText, instruction, context }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return { originalText: data.originalText, refinedText: data.refinedText };
}

export async function getChapterSuggestion(
  name: string,
  index: number,
  contextBefore: string,
  aiHeaders?: Record<string, string>
): Promise<string> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/${index}/suggest`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ contextBefore }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.suggestion;
}

export async function chatWithChapter(
  name: string,
  index: number,
  messages: { role: string; content: string }[],
  context: string,
  aiHeaders?: Record<string, string>
): Promise<string> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/${index}/chat`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ messages, context }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.response;
}

// generateSingleChapter is defined above

export async function createChapter(
  name: string,
  content: string,
  insertAfter?: number
): Promise<{ chapterIndex: number }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ content, insertAfter }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '创建章节失败');
  }
  if (typeof data.chapterIndex !== 'number') {
    throw new Error('创建章节失败：未返回章节编号');
  }
  return { chapterIndex: data.chapterIndex };
}

export async function updateProject(
  name: string,
  data: { bible?: string; background?: string; role_settings?: string; minChapterWords?: number }
): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  if (!json.success) throw new Error(json.error);
}

export interface ConsistencyIssue {
  type: 'conflict' | 'logic' | 'character' | 'style';
  severity: 'high' | 'medium' | 'low';
  description: string;
  quote?: string;
  suggestion?: string;
}

export interface ConsistencyReport {
  issues: ConsistencyIssue[];
  overall_score: number;
  summary: string;
  raw_response?: string;
}

export async function checkConsistency(
  name: string,
  chapterIndex: number,
  content: string,
  context?: string
): Promise<ConsistencyReport> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/${chapterIndex}/consistency`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ content, context }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.report;
}

// ==========================================
// Credit API
// ==========================================

export async function fetchCreditBalance(): Promise<{
  creditBalance: number;
  vipType: string;
  vipExpireAt: string | null;
  level: number;
}> {
  const res = await fetch(`${API_BASE}/credit/balance`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data;
}

export async function fetchCreditTransactions(
  limit: number = 20,
  offset: number = 0
): Promise<{ transactions: any[]; total: number }> {
  const res = await fetch(`${API_BASE}/credit/transactions?limit=${limit}&offset=${offset}`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return { transactions: data.transactions, total: data.total };
}

export async function fetchCreditFeatures(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/credit/features`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.features;
}

// ==========================================
// Admin Credit & Model Registry API
// ==========================================

export async function fetchAdminCreditFeatures(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/admin/credit-features`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.features;
}

export async function updateCreditFeature(key: string, updates: any): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/credit-features/${key}`, {
    method: 'PUT',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export async function createCreditFeature(feature: any): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/credit-features`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(feature),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export async function rechargeUserCredit(userId: string, amount: number, description?: string): Promise<{ balanceAfter: number }> {
  const res = await fetch(`${API_BASE}/admin/users/${userId}/credit`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ amount, description }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return { balanceAfter: data.balanceAfter };
}

export async function fetchModelRegistry(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/admin/model-registry`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.models;
}

export async function createModel(model: any): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/admin/model-registry`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(model),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return { id: data.id };
}

export async function updateModel(id: string, updates: any): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/model-registry/${id}`, {
    method: 'PUT',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export async function deleteModel(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/model-registry/${id}`, {
    method: 'DELETE',
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export async function fetchCreditStats(): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/credit-stats`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.stats;
}

export async function fetchGenerationSettings(): Promise<{ summaryUpdateInterval: number }> {
  const res = await fetch(`${API_BASE}/admin/generation-settings`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.settings as { summaryUpdateInterval: number };
}

export async function updateGenerationSettings(summaryUpdateInterval: number): Promise<{ summaryUpdateInterval: number }> {
  const res = await fetch(`${API_BASE}/admin/generation-settings`, {
    method: 'PUT',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ summaryUpdateInterval }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.settings as { summaryUpdateInterval: number };
}

// 从远程 AI 提供商获取可用模型列表
export async function fetchRemoteModels(
  provider: string,
  apiKey: string,
  baseUrl?: string
): Promise<{ id: string; name: string; displayName: string }[]> {
  const res = await fetch(`${API_BASE}/admin/fetch-models`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ provider, apiKey, baseUrl }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.models;
}

export type ProviderPreset = {
  id: string;
  label: string;
  protocol: 'openai' | 'gemini' | 'anthropic';
  defaultBaseUrl?: string;
  isCustom?: boolean;
};

export async function fetchProviderPresets(): Promise<ProviderPreset[]> {
  const res = await fetch(`${API_BASE}/admin/provider-presets`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.providers || [];
}

export async function fetchPublicProviderPresets(): Promise<ProviderPreset[]> {
  const res = await fetch(`${API_BASE}/config/provider-presets`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || data.message || '加载 provider 列表失败');
  return data.providers || [];
}
