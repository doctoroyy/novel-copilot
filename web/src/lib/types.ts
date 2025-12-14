export interface Project {
  id: string; // UUID
  name: string;
  bible: string;
  created_at: number;
}

export interface ProjectState {
  project_id: string;
  book_title: string;
  total_chapters: number;
  next_chapter_index: number;
  rolling_summary: string;
  open_loops: string[];
  need_human: boolean;
  need_human_reason?: string;
}

export interface Chapter {
  id?: number; 
  project_id: string;
  chapter_index: number;
  content: string;
  created_at: number;
}

export interface OutlineData {
  project_id: string;
  outline_json: NovelOutline;
}

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

// UI Aggregation Types

export type ProjectSummary = {
  id: string;
  name: string;
  state: ProjectState;
  hasOutline: boolean;
};

export type ProjectDetail = {
  id: string;
  name: string;
  state: ProjectState;
  bible: string;
  outline: NovelOutline | null;
  chapters: number[]; // Just indices
};
