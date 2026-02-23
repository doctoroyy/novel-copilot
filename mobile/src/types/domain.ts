export type User = {
  id: string;
  username: string;
  role?: string;
  credit_balance?: number;
  allow_custom_provider?: boolean;
  createdAt?: number;
  lastLoginAt?: number;
};

export type BookState = {
  bookTitle: string;
  totalChapters: number;
  minChapterWords?: number;
  nextChapterIndex: number;
  rollingSummary: string;
  openLoops: string[];
  needHuman?: boolean;
  needHumanReason?: string;
};

export type ChapterOutline = {
  index: number;
  title: string;
  goal: string;
  hook: string;
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

export type NovelOutline = {
  totalChapters: number;
  targetWordCount: number;
  volumes: VolumeOutline[];
  mainGoal: string;
  milestones: string[];
};

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
  }>;
  status: 'ready' | 'error' | null;
  errorMessage: string | null;
  availableSnapshots: BibleTemplateSnapshotSummary[];
};

export type GenerationTask = {
  id: number;
  projectId: string;
  projectName: string;
  userId: string;
  targetCount: number;
  startChapter: number;
  completedChapters: number[];
  failedChapters: number[];
  currentProgress: number;
  currentMessage: string | null;
  status: 'running' | 'paused' | 'completed' | 'failed';
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  updatedAtMs: number;
};

export type AnimeProject = {
  id: string;
  name: string;
  novel_text?: string;
  total_episodes: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  error_message?: string | null;
  created_at: number;
  updated_at: number;
};

export type AnimeEpisode = {
  id: string;
  project_id: string;
  episode_num: number;
  status: 'pending' | 'script' | 'storyboard' | 'audio' | 'video' | 'done' | 'error' | 'processing';
  duration_seconds?: number | null;
  video_r2_key?: string | null;
  error_message?: string | null;
  updated_at?: number;
};

export type AIConfig = {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
};

export type AppConfig = {
  apiBaseUrl: string;
  ai?: {
    provider: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
  };
};

export type ApiSuccess<T> =
  | ({ success: true; error?: string } & T)
  | ({ success: false; error: string } & Partial<T>);

export type GenerationStreamEventType =
  | 'start'
  | 'progress'
  | 'chapter_complete'
  | 'chapter_error'
  | 'done'
  | 'error'
  | 'heartbeat'
  | 'task_resumed'
  | 'task_created';

export type GenerationStreamEvent = {
  type: GenerationStreamEventType;
  total?: number;
  taskId?: number;
  completedChapters?: number[];
  targetCount?: number;
  currentProgress?: number;
  currentMessage?: string;
  current?: number;
  chapterIndex?: number;
  status?:
  | 'preparing'
  | 'generating'
  | 'analyzing'
  | 'planning'
  | 'reviewing'
  | 'repairing'
  | 'saving'
  | 'updating_summary';
  message?: string;
  title?: string;
  preview?: string;
  wordCount?: number;
  error?: string;
  success?: boolean;
  generated?: { chapter: number; title: string }[];
  failedChapters?: number[];
  totalGenerated?: number;
  totalFailed?: number;
};

export type OutlineStreamEvent = {
  type:
  | 'heartbeat'
  | 'start'
  | 'progress'
  | 'master_outline'
  | 'volume_complete'
  | 'done'
  | 'error';
  message?: string;
  error?: string;
  totalVolumes?: number;
  volumeIndex?: number;
  volumeTitle?: string;
  chapterCount?: number;
  outline?: NovelOutline;
  success?: boolean;
};

export type ModelRegistry = {
  id: string;
  provider: string;
  model_name: string;
  display_name: string;
  api_key?: string;
  base_url?: string;
  credit_multiplier: number;
  is_active: boolean; // SQLite stores boolean as 0/1, but API might return boolean or number. Let's assume API normalizes it or check usage.
  is_default: boolean;
  capabilities: string;
  created_at: number;
  updated_at: number;
};

export type CreditFeature = {
  key: string;
  name: string;
  description: string;
  base_cost: number;
  is_active: boolean;
  created_at: number;
  updated_at: number;
};
