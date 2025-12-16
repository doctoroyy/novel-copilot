// API client for novel automation backend
const API_BASE = '/api';

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
  const res = await fetch(`${API_BASE}/projects`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.projects;
}

export async function fetchProject(name: string): Promise<ProjectDetail> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.project;
}

export async function createProject(name: string, bible: string, totalChapters: number): Promise<void> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, bible, totalChapters }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export async function updateBible(name: string, bible: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/bible`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
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
  aiHeaders?: Record<string, string>
): Promise<NovelOutline> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/outline`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify({ targetChapters, targetWordCount, customPrompt }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.outline;
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

export async function fetchChapter(name: string, index: number): Promise<string> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/chapters/${index}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.content;
}

export async function deleteProject(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
}

export async function resetProject(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/reset`, {
    method: 'PUT',
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  const data = await res.json();
  return data;
}
