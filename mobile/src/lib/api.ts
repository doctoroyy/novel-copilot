import type {
  AnimeEpisode,
  AnimeProject,
  ApiSuccess,
  CreditFeature,
  GenerationStreamEvent,
  GenerationTask,
  ModelRegistry,
  NovelOutline,
  OutlineStreamEvent,
  ProjectDetail,
  ProjectSummary,
  User,
  AppConfig,
} from '../types/domain';

function buildApiUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}/api${normalizedPath}`;
}

function authHeaders(token: string | null, aiConfig?: AppConfig['ai']): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  if (aiConfig) {
    if (aiConfig.provider) headers['x-custom-provider'] = aiConfig.provider;
    if (aiConfig.model) headers['x-custom-model'] = aiConfig.model;
    if (aiConfig.baseUrl) headers['x-custom-base-url'] = aiConfig.baseUrl;
    if (aiConfig.apiKey) headers['x-custom-api-key'] = aiConfig.apiKey;
  }
  
  return headers;
}

// aiHeaders function removed

async function parseJsonResponse<T>(response: Response): Promise<ApiSuccess<T>> {
  const json = (await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }))) as ApiSuccess<T>;
  return json;
}

export async function login(
  apiBaseUrl: string,
  username: string,
  password: string,
): Promise<ApiSuccess<{ user: User; token: string }>> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  return parseJsonResponse<{ user: User; token: string }>(res);
}

export async function register(
  apiBaseUrl: string,
  username: string,
  password: string,
  invitationCode: string,
): Promise<ApiSuccess<{ user: User; token: string }>> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/auth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, invitationCode }),
  });

  return parseJsonResponse<{ user: User; token: string }>(res);
}

export async function fetchCurrentUser(
  apiBaseUrl: string,
  token: string,
): Promise<ApiSuccess<{ user: User }>> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/auth/me'), {
    headers: authHeaders(token),
  });
  return parseJsonResponse<{ user: User }>(res);
}

export async function fetchProjects(
  apiBaseUrl: string,
  token: string,
): Promise<ProjectSummary[]> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/projects'), {
    headers: authHeaders(token),
  });

  const json = await parseJsonResponse<{ projects: ProjectSummary[] }>(res);
  if (!json.success) throw new Error(json.error || 'Failed to fetch projects');
  return json.projects || [];
}

export async function fetchProject(
  apiBaseUrl: string,
  token: string,
  projectName: string,
): Promise<ProjectDetail> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/projects/${encodeURIComponent(projectName)}`), {
    headers: authHeaders(token),
  });

  const json = await parseJsonResponse<{ project: ProjectDetail }>(res);
  if (!json.success || !json.project) throw new Error(json.error || 'Failed to fetch project');
  return json.project;
}

export async function createProject(
  apiBaseUrl: string,
  token: string,
  payload: { name: string; bible: string; totalChapters: number },
): Promise<void> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/projects'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  });

  const json = await parseJsonResponse<{ project: { id: string; name: string } }>(res);
  if (!json.success) throw new Error(json.error || 'Failed to create project');
}

export async function deleteProject(
  apiBaseUrl: string,
  token: string,
  projectName: string,
): Promise<void> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/projects/${encodeURIComponent(projectName)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });

  const json = await parseJsonResponse<Record<string, never>>(res);
  if (!json.success) throw new Error(json.error || 'Failed to delete project');
}

export async function resetProject(
  apiBaseUrl: string,
  token: string,
  projectName: string,
): Promise<void> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/projects/${encodeURIComponent(projectName)}/reset`), {
    method: 'PUT',
    headers: authHeaders(token),
  });

  const json = await parseJsonResponse<Record<string, never>>(res);
  if (!json.success) throw new Error(json.error || 'Failed to reset project');
}

export async function generateBible(
  apiBaseUrl: string,
  token: string,
  genre: string,
  theme: string,
  keywords: string,
  aiConfig?: AppConfig['ai'],
): Promise<string> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/bible/generate'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token, aiConfig),
    },
    body: JSON.stringify({ genre, theme, keywords }),
  });

  const json = await parseJsonResponse<{ bible: string }>(res);
  if (!json.success || !json.bible) throw new Error(json.error || 'Failed to generate bible');
  return json.bible;
}

async function parseSSE(
  response: Response,
  onEvent: (event: any) => void,
): Promise<void> {
// ... (omitting huge chunk of unchanged code for parseSSE)
}

export async function generateOutlineStream(
  apiBaseUrl: string,
  token: string,
  projectName: string,
  payload: {
    targetChapters: number;
    targetWordCount: number;
    customPrompt?: string;
  },
  onEvent: (event: OutlineStreamEvent) => void,
  aiConfig?: AppConfig['ai'],
): Promise<NovelOutline> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/projects/${encodeURIComponent(projectName)}/outline`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token, aiConfig),
    },
    body: JSON.stringify(payload),
  });

  let finalOutline: NovelOutline | null = null;
  let finalError: string | null = null;

  await parseSSE(res, (event: OutlineStreamEvent) => {
    if (event.type === 'heartbeat') return;
    if (event.type === 'done') {
      if (!event.success) {
        finalError = event.error || 'Outline generation failed';
      } else if (event.outline) {
        finalOutline = event.outline;
      }
    }
    if (event.type === 'error') {
      finalError = event.error || 'Outline generation failed';
    }
    onEvent(event);
  });

  if (finalError) throw new Error(finalError);
  if (!finalOutline) throw new Error('No outline received');
  return finalOutline;
}

export async function generateChaptersStream(
  apiBaseUrl: string,
  token: string,
  projectName: string,
  payload: { chaptersToGenerate: number },
  onEvent: (event: GenerationStreamEvent) => void,
  aiConfig?: AppConfig['ai'],
): Promise<{ generated: { chapter: number; title: string }[]; failedChapters: number[] }> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/projects/${encodeURIComponent(projectName)}/generate-stream`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token, aiConfig),
    },
    body: JSON.stringify(payload),
  });

  const generated: { chapter: number; title: string }[] = [];
  let failedChapters: number[] = [];
  let finalError: string | null = null;

  await parseSSE(res, (event: GenerationStreamEvent) => {
    if (event.type === 'heartbeat') return;

    if (event.type === 'chapter_complete' && event.chapterIndex) {
      generated.push({
        chapter: event.chapterIndex,
        title: event.title || `Chapter ${event.chapterIndex}`,
      });
    }

    if (event.type === 'done') {
      if (!event.success) {
        finalError = event.error || 'Generation failed';
      }
      if (event.generated) {
        generated.splice(0, generated.length, ...event.generated);
      }
      failedChapters = event.failedChapters || [];
    }

    if (event.type === 'error') {
      finalError = event.error || 'Generation failed';
    }

    onEvent(event);
  });

  if (finalError) throw new Error(finalError);
  return { generated, failedChapters };
}

export async function fetchChapterContent(
  apiBaseUrl: string,
  token: string,
  projectName: string,
  chapterIndex: number,
): Promise<string> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/projects/${encodeURIComponent(projectName)}/chapters/${chapterIndex}`), {
    headers: authHeaders(token),
  });

  const json = await parseJsonResponse<{ content: string }>(res);
  if (!json.success) throw new Error(json.error || 'Failed to load chapter');
  return json.content || '';
}

export async function fetchActiveTasks(
  apiBaseUrl: string,
  token: string,
): Promise<GenerationTask[]> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/active-tasks'), {
    headers: authHeaders(token),
  });

  const json = await parseJsonResponse<{ tasks: GenerationTask[] }>(res);
  if (!json.success) throw new Error(json.error || 'Failed to fetch active tasks');
  return json.tasks || [];
}

export async function fetchProjectActiveTask(
  apiBaseUrl: string,
  token: string,
  projectName: string,
): Promise<GenerationTask | null> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/projects/${encodeURIComponent(projectName)}/active-task`), {
    headers: authHeaders(token),
  });

  const json = await parseJsonResponse<{ task: GenerationTask | null }>(res);
  if (!json.success) throw new Error(json.error || 'Failed to fetch project task');
  return json.task || null;
}

export async function pauseTask(
  apiBaseUrl: string,
  token: string,
  projectName: string,
  taskId: number,
): Promise<void> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/projects/${encodeURIComponent(projectName)}/tasks/${taskId}/pause`), {
    method: 'POST',
    headers: authHeaders(token),
  });

  const json = await parseJsonResponse<Record<string, never>>(res);
  if (!json.success) throw new Error(json.error || 'Failed to pause task');
}

export async function cancelAllActiveTasks(
  apiBaseUrl: string,
  token: string,
  projectName: string,
): Promise<void> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/projects/${encodeURIComponent(projectName)}/active-tasks`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });

  const json = await parseJsonResponse<Record<string, never>>(res);
  if (!json.success) throw new Error(json.error || 'Failed to cancel active tasks');
}

export async function fetchAnimeProjects(
  apiBaseUrl: string,
  token: string,
): Promise<AnimeProject[]> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/anime/projects'), {
    headers: authHeaders(token),
  });

  const json = await parseJsonResponse<{ projects: AnimeProject[] }>(res);
  if (!json.success) throw new Error(json.error || 'Failed to fetch anime projects');
  return json.projects || [];
}

export async function fetchAnimeProjectDetail(
  apiBaseUrl: string,
  token: string,
  animeProjectId: string,
): Promise<{ project: AnimeProject; episodes: AnimeEpisode[] }> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/anime/projects/${encodeURIComponent(animeProjectId)}`), {
    headers: authHeaders(token),
  });

  const json = await parseJsonResponse<{ project: AnimeProject; episodes: AnimeEpisode[] }>(res);
  if (!json.success || !json.project) {
    throw new Error(json.error || 'Failed to fetch anime project detail');
  }
  return { project: json.project, episodes: json.episodes || [] };
}

export async function createAnimeProject(
  apiBaseUrl: string,
  token: string,
  payload: { name: string; novelText: string; totalEpisodes: number },
  aiConfig?: AppConfig['ai'],
): Promise<{ projectId: string }> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/anime/projects'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token, aiConfig),
    },
    body: JSON.stringify(payload),
  });

  const json = await parseJsonResponse<{ projectId: string }>(res);
  if (!json.success || !json.projectId) throw new Error(json.error || 'Failed to create anime project');
  return { projectId: json.projectId };
}

export async function generateAnimeEpisodes(
  apiBaseUrl: string,
  token: string,
  animeProjectId: string,
  options?: { startEpisode?: number; endEpisode?: number },
  aiConfig?: AppConfig['ai'],
): Promise<void> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/anime/projects/${encodeURIComponent(animeProjectId)}/generate`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token, aiConfig),
    },
    body: JSON.stringify({
      ...(options?.startEpisode ? { startEpisode: options.startEpisode } : {}),
      ...(options?.endEpisode ? { endEpisode: options.endEpisode } : {}),
    }),
  });

  const json = await parseJsonResponse<Record<string, never>>(res);
  if (!json.success) throw new Error(json.error || 'Failed to start anime generation');
}

// Admin API

export async function fetchModelRegistry(
  apiBaseUrl: string,
  token: string,
): Promise<ModelRegistry[]> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/admin/model-registry'), {
    headers: authHeaders(token),
  });
  const json = await parseJsonResponse<{ models: ModelRegistry[] }>(res);
  if (!json.success) throw new Error(json.error || 'Failed to fetch model registry');
  return json.models || [];
}

export async function createModel(
  apiBaseUrl: string,
  token: string,
  model: Partial<ModelRegistry>,
): Promise<{ id: string }> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/admin/model-registry'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify(model),
  });
  const json = await parseJsonResponse<{ id: string }>(res);
  if (!json.success) throw new Error(json.error || 'Failed to create model');
  return { id: json.id! };
}

export async function updateModel(
  apiBaseUrl: string,
  token: string,
  id: string,
  updates: Partial<ModelRegistry>,
): Promise<void> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/admin/model-registry/${id}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify(updates),
  });
  const json = await parseJsonResponse<Record<string, never>>(res);
  if (!json.success) throw new Error(json.error || 'Failed to update model');
}

export async function deleteModel(
  apiBaseUrl: string,
  token: string,
  id: string,
): Promise<void> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/admin/model-registry/${id}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  const json = await parseJsonResponse<Record<string, never>>(res);
  if (!json.success) throw new Error(json.error || 'Failed to delete model');
}

export async function fetchAdminCreditFeatures(
  apiBaseUrl: string,
  token: string,
): Promise<CreditFeature[]> {
  const res = await fetch(buildApiUrl(apiBaseUrl, '/admin/credit-features'), {
    headers: authHeaders(token),
  });
  const json = await parseJsonResponse<{ features: CreditFeature[] }>(res);
  if (!json.success) throw new Error(json.error || 'Failed to fetch credit features');
  return json.features || [];
}

export async function updateCreditFeature(
  apiBaseUrl: string,
  token: string,
  key: string,
  updates: Partial<CreditFeature>,
): Promise<void> {
  const res = await fetch(buildApiUrl(apiBaseUrl, `/admin/credit-features/${key}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify(updates),
  });
  const json = await parseJsonResponse<Record<string, never>>(res);
  if (!json.success) throw new Error(json.error || 'Failed to update credit feature');
}

