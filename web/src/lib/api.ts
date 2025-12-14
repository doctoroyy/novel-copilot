// API client for novel automation backend (Stateless AI Generation)
const API_BASE = '/api';

import type { NovelOutline } from './types';

export type { NovelOutline, VolumeOutline, ChapterOutline } from './types';

// BookState is used internally or by legacy? It seems not used in new stateless API directly (params use individual fields).
// But we can keep it if needed or remove if unused. It is unused in this file.


// Helper to merge headers
function mergeHeaders(base: Record<string, string>, aiHeaders?: Record<string, string>): Record<string, string> {
  return { ...base, ...aiHeaders };
}

// --- AI Generation APIs (Stateless) ---

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

export async function generateOutline(
  params: {
    bible: string;
    targetChapters: number;
    targetWordCount: number;
    customPrompt?: string;
  },
  aiHeaders?: Record<string, string>
): Promise<NovelOutline> {
  const res = await fetch(`${API_BASE}/generate-outline`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.outline;
}

export async function generateChapter(
  params: {
    bible: string;
    rollingSummary: string;
    openLoops: string[];
    lastChapters: string[];
    chapterIndex: number;
    totalChapters: number;
    outline?: NovelOutline | null;
  },
  aiHeaders?: Record<string, string>
): Promise<{ index: number; title: string; content: string }> {
  const res = await fetch(`${API_BASE}/generate-chapter`, {
    method: 'POST',
    headers: mergeHeaders({ 'Content-Type': 'application/json' }, aiHeaders),
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.chapter;
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
  return await res.json();
}

