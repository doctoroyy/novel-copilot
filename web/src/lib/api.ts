// API client for novel automation backend
import { TIMEOUTS } from '@/config/timeouts';

const API_BASE = '/api';

/**
 * Wraps fetch with timeout functionality using AbortController
 * 
 * @param url - The URL to fetch
 * @param options - Standard fetch options
 * @param timeout - Timeout in milliseconds (defaults to TIMEOUTS.DEFAULT)
 * @returns Promise<Response> - The fetch response
 * @throws AbortError if the request times out
 */
function fetchWithTimeout(url: string, options: RequestInit = {}, timeout: number = TIMEOUTS.DEFAULT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
  });
}

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

// Helper to merge headers
function mergeHeaders(base: Record<string, string>, aiHeaders?: Record<string, string>): Record<string, string> {
  return { ...base, ...aiHeaders };
}

// API functions
export async function fetchProjects(): Promise<ProjectSummary[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.projects;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请重试');
    }
    throw error;
  }
}

export async function fetchProject(name: string): Promise<ProjectDetail> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${encodeURIComponent(name)}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.project;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请重试');
    }
    throw error;
  }
}

export async function createProject(name: string, bible: string, totalChapters: number): Promise<void> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, bible, totalChapters }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请重试');
    }
    throw error;
  }
}

export async function updateBible(name: string, bible: string): Promise<void> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${encodeURIComponent(name)}/bible`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bible }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请重试');
    }
    throw error;
  }
}

export async function generateOutline(
  name: string,
  targetChapters: number,
  targetWordCount: number,
  customPrompt?: string,
  aiHeaders?: Record<string, string>
): Promise<NovelOutline> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${encodeURIComponent(name)}/outline`, {
      method: 'POST',
      headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
      body: JSON.stringify({ targetChapters, targetWordCount, customPrompt }),
    }, TIMEOUTS.GENERATION);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.outline;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('生成超时（超过10分钟），请检查网络或重试');
    }
    throw error;
  }
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
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${encodeURIComponent(name)}/generate`, {
      method: 'POST',
      headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
      body: JSON.stringify({ chaptersToGenerate }),
    }, TIMEOUTS.GENERATION);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.generated;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('生成超时（超过10分钟），请检查网络或重试');
    }
    throw error;
  }
}

export async function fetchChapter(name: string, index: number): Promise<string> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/${index}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.content;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请重试');
    }
    throw error;
  }
}

export async function deleteProject(name: string): Promise<void> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请重试');
    }
    throw error;
  }
}

export async function resetProject(name: string): Promise<void> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${encodeURIComponent(name)}/reset`, {
      method: 'PUT',
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时，请重试');
    }
    throw error;
  }
}

export async function deleteChapter(name: string, index: number): Promise<{ newNextChapterIndex: number }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/${index}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return { newNextChapterIndex: data.newNextChapterIndex };
}

export async function batchDeleteChapters(name: string, indices: number[]): Promise<{ deletedIndices: number[]; newNextChapterIndex: number }> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/batch-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  try {
    const res = await fetchWithTimeout(`${API_BASE}/generate-bible`, {
      method: 'POST',
      headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
      body: JSON.stringify({ genre, theme, keywords }),
    }, TIMEOUTS.GENERATION);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.bible;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('生成超时（超过10分钟），请检查网络或重试');
    }
    throw error;
  }
}

export async function testAIConnection(config: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }, TIMEOUTS.TEST_CONNECTION);
    const data = await res.json();
    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { success: false, message: '连接超时（超过30秒），请检查网络或API配置' };
    }
    throw error;
  }
}
