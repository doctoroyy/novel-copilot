// API client for novel automation backend
const API_BASE = '/api';

import type { CharacterRelationGraph } from '../types/characters';
import { getAuthHeaders } from './auth';

export type ProjectSummary = {
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
  name: string;
  path: string;
  state: BookState;
  bible: string;
  outline: NovelOutline | null;
  chapters: string[];
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
  return data.projects;
}

export async function fetchProject(name: string): Promise<ProjectDetail> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.project;
}

export async function createProject(name: string, bible: string, totalChapters: number): Promise<void> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, bible, totalChapters }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
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
  customPrompt?: string,
  aiHeaders?: Record<string, string>,
  onProgress?: (message: string) => void
): Promise<NovelOutline> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/outline`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ targetChapters, targetWordCount, customPrompt }),
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
  let outline: NovelOutline | null = null;

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
              
              // Skip heartbeat events
              if (event.type === 'heartbeat') continue;
              
              // Handle progress events
              if (event.type === 'progress' && event.message && onProgress) {
                onProgress(event.message);
              }
              
              // Handle volume complete
              if (event.type === 'volume_complete' && onProgress) {
                onProgress(`第 ${event.volumeIndex}/${event.totalVolumes} 卷「${event.volumeTitle}」完成 (${event.chapterCount} 章)`);
              }
              
              // Handle master outline
              if (event.type === 'master_outline' && onProgress) {
                onProgress(`总体大纲生成完成: ${event.totalVolumes} 卷`);
              }
              
              // Handle done event
              if (event.type === 'done') {
                if (!event.success) {
                  throw new Error(event.error || 'Generation failed');
                }
                reader.releaseLock();
                return event.outline as NovelOutline;
              }
              
              // Handle error event
              if (event.type === 'error') {
                throw new Error(event.error || 'Unknown error');
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue; // Skip malformed JSON
              throw e;
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!outline) {
    throw new Error('No outline received');
  }

  return outline;
}

export async function refineOutline(
  name: string,
  volumeIndex?: number,
  aiHeaders?: Record<string, string>
): Promise<NovelOutline> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/outline/refine`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ volumeIndex }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.outline;
}

export async function generateChapters(
  name: string,
  chaptersToGenerate: number,
  aiHeaders?: Record<string, string>
): Promise<{ chapter: number; title: string }[]> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/generate`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ chaptersToGenerate }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.generated;
}

// Streaming generation event types
export type GenerationEventType = 
  | 'start' 
  | 'progress' 
  | 'chapter_complete' 
  | 'chapter_error' 
  | 'done' 
  | 'error' 
  | 'heartbeat';

export type GenerationEvent = {
  type: GenerationEventType;
  // start event
  total?: number;
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
  signal?: AbortSignal
): AsyncGenerator<GenerationEvent, void, unknown> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/generate-stream`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ chaptersToGenerate }),
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
              // If done or error, we're finished
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
    maxRetries?: number;
    retryDelayMs?: number;
  }
): Promise<{ chapter: number; title: string }[]> {
  const { maxRetries = 5, retryDelayMs = 3000 } = options || {};
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
      const task = await getActiveTask(name);
      const completedCount = task?.completedChapters?.length || 0;
      const remaining = task ? (task.targetCount - completedCount) : chaptersToGenerate;
      
      if (remaining <= 0) {
        // Task already completed
        callbacks.onDone?.(results, []);
        break;
      }

      for await (const event of generateChaptersStream(name, remaining, aiHeaders, signal)) {
        switch (event.type) {
          case 'start':
            if (retryCount === 0) {
              callbacks.onStart?.(event.total || chaptersToGenerate);
            }
            break;
          case 'progress':
            callbacks.onProgress?.(event);
            break;
          case 'chapter_complete':
            if (event.chapterIndex !== undefined && event.title) {
              results.push({ chapter: event.chapterIndex, title: event.title });
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
            return results;
          case 'error':
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
  projectId: string;
  projectName: string;
  userId: string;
  targetCount: number;
  startChapter: number;
  completedChapters: number[];
  failedChapters: number[];
  currentProgress: number;  // Current chapter being processed
  currentMessage: string | null;  // Status message for sync
  status: 'running' | 'paused' | 'completed' | 'failed';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

// Get active generation task for a project
export async function getActiveTask(name: string): Promise<GenerationTask | null> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/active-task`, {
    headers: defaultHeaders(),
  });
  const data = await res.json();
  if (!data.success) return null;
  return data.task;
}

// Cancel/delete a generation task
export async function cancelTask(name: string, taskId: number): Promise<void> {
  await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/tasks/${taskId}`, {
    method: 'DELETE',
    headers: defaultHeaders(),
  });
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

export async function generateBible(
  genre?: string,
  theme?: string,
  keywords?: string,
  aiHeaders?: Record<string, string>
): Promise<string> {
  const res = await fetch(`${API_BASE}/generate-bible`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ genre, theme, keywords }),
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
