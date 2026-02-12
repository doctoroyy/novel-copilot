import { useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAIConfig, getAIConfigHeaders } from '@/hooks/useAIConfig';
import {
  createChapter,
  createProject,
  fetchChapter,
  fetchProject,
  fetchProjects,
  generateChapters,
  generateOutline,
  updateChapter,
} from '@/lib/api';

type ToolInput = Record<string, unknown>;

const EMPTY_SCHEMA: WebMCPJsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function asObject(input: unknown): ToolInput {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Tool input must be an object.');
  }
  return input as ToolInput;
}

function requireString(input: ToolInput, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`"${key}" must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(input: ToolInput, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`"${key}" must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requirePositiveInteger(input: ToolInput, key: string): number {
  const value = input[key];
  const parsed = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`"${key}" must be a positive integer.`);
  }
  return parsed;
}

function optionalInteger(input: ToolInput, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`"${key}" must be an integer greater than or equal to 0.`);
  }
  return parsed;
}

function asWebMCPTool(tool: WebMCPTool): WebMCPTool {
  return tool;
}

export function WebMCPProvider() {
  const { isLoggedIn, loading } = useAuth();
  const { config, isConfigured } = useAIConfig();
  const aiHeaders = useMemo(() => getAIConfigHeaders(config), [config]);

  const tools = useMemo(() => {
    const requireAuth = () => {
      if (loading) {
        throw new Error('Authentication status is still loading. Try again in a moment.');
      }
      if (!isLoggedIn) {
        throw new Error('You must log in to Novel Copilot before using this tool.');
      }
    };

    const requireAI = () => {
      if (!isConfigured) {
        throw new Error('AI provider/model/api key is not configured in Novel Copilot settings.');
      }
    };

    return [
      asWebMCPTool({
        name: 'novel_get_runtime_status',
        description: 'Get current Novel Copilot runtime status including auth and AI config state.',
        inputSchema: EMPTY_SCHEMA,
        execute: async (_input, _agent) => ({
          authenticated: isLoggedIn,
          authLoading: loading,
          aiConfigured: isConfigured,
          provider: config.provider,
          model: config.model,
        }),
      }),
      asWebMCPTool({
        name: 'novel_list_projects',
        description: 'List all accessible novel projects for the current authenticated user.',
        inputSchema: EMPTY_SCHEMA,
        execute: async (_input, _agent) => {
          requireAuth();
          return { projects: await fetchProjects() };
        },
      }),
      asWebMCPTool({
        name: 'novel_get_project',
        description: 'Get full project metadata, outline state, and existing chapter index files by project name.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Exact project name to retrieve.' },
          },
          required: ['name'],
          additionalProperties: false,
        },
        execute: async (rawInput, _agent) => {
          requireAuth();
          const input = asObject(rawInput);
          const name = requireString(input, 'name');
          return { project: await fetchProject(name) };
        },
      }),
      asWebMCPTool({
        name: 'novel_create_project',
        description: 'Create a new project with a story bible and target chapter count.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Unique project name.' },
            bible: { type: 'string', description: 'Story bible / world setting text.' },
            totalChapters: { type: 'integer', description: 'Target chapter count, must be >= 1.', minimum: 1 },
          },
          required: ['name', 'bible', 'totalChapters'],
          additionalProperties: false,
        },
        execute: async (rawInput, _agent) => {
          requireAuth();
          const input = asObject(rawInput);
          const name = requireString(input, 'name');
          const bible = requireString(input, 'bible');
          const totalChapters = requirePositiveInteger(input, 'totalChapters');
          await createProject(name, bible, totalChapters);
          return { success: true, message: `Project "${name}" created.` };
        },
      }),
      asWebMCPTool({
        name: 'novel_get_chapter',
        description: 'Fetch chapter content by project name and chapter index.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name.' },
            index: { type: 'integer', description: 'Chapter index (1-based integer).', minimum: 1 },
          },
          required: ['name', 'index'],
          additionalProperties: false,
        },
        execute: async (rawInput, _agent) => {
          requireAuth();
          const input = asObject(rawInput);
          const name = requireString(input, 'name');
          const index = requirePositiveInteger(input, 'index');
          const content = await fetchChapter(name, index);
          return { name, index, content };
        },
      }),
      asWebMCPTool({
        name: 'novel_update_chapter',
        description: 'Overwrite the full text of an existing chapter.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name.' },
            index: { type: 'integer', description: 'Chapter index to update.', minimum: 1 },
            content: { type: 'string', description: 'New full chapter text.' },
          },
          required: ['name', 'index', 'content'],
          additionalProperties: false,
        },
        execute: async (rawInput, _agent) => {
          requireAuth();
          const input = asObject(rawInput);
          const name = requireString(input, 'name');
          const index = requirePositiveInteger(input, 'index');
          const content = requireString(input, 'content');
          await updateChapter(name, index, content);
          return { success: true, message: `Updated chapter ${index} in "${name}".` };
        },
      }),
      asWebMCPTool({
        name: 'novel_create_chapter',
        description: 'Create a chapter with provided content and optional insertion position.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name.' },
            content: { type: 'string', description: 'Chapter text content.' },
            insertAfter: { type: 'integer', description: 'Optional chapter index to insert after.', minimum: 0 },
          },
          required: ['name', 'content'],
          additionalProperties: false,
        },
        execute: async (rawInput, _agent) => {
          requireAuth();
          const input = asObject(rawInput);
          const name = requireString(input, 'name');
          const content = requireString(input, 'content');
          const insertAfter = optionalInteger(input, 'insertAfter');
          const result = await createChapter(name, content, insertAfter);
          return { success: true, chapterIndex: result.chapterIndex };
        },
      }),
      asWebMCPTool({
        name: 'novel_generate_outline',
        description: 'Generate or regenerate project outline using the currently configured AI provider.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name.' },
            targetChapters: { type: 'integer', description: 'Total planned chapters.', minimum: 1 },
            targetWordCount: { type: 'integer', description: 'Target word count per chapter.', minimum: 1 },
            customPrompt: { type: 'string', description: 'Optional extra instructions for outline generation.' },
          },
          required: ['name', 'targetChapters', 'targetWordCount'],
          additionalProperties: false,
        },
        execute: async (rawInput, _agent) => {
          requireAuth();
          requireAI();
          const input = asObject(rawInput);
          const name = requireString(input, 'name');
          const targetChapters = requirePositiveInteger(input, 'targetChapters');
          const targetWordCount = requirePositiveInteger(input, 'targetWordCount');
          const customPrompt = optionalString(input, 'customPrompt');
          const outline = await generateOutline(
            name,
            targetChapters,
            targetWordCount,
            customPrompt,
            aiHeaders,
          );
          return { outline };
        },
      }),
      asWebMCPTool({
        name: 'novel_generate_chapters',
        description: 'Generate the next N chapters based on current project state and configured AI provider.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name.' },
            chaptersToGenerate: { type: 'integer', description: 'How many new chapters to generate.', minimum: 1 },
          },
          required: ['name', 'chaptersToGenerate'],
          additionalProperties: false,
        },
        execute: async (rawInput, _agent) => {
          requireAuth();
          requireAI();
          const input = asObject(rawInput);
          const name = requireString(input, 'name');
          const chaptersToGenerate = requirePositiveInteger(input, 'chaptersToGenerate');
          const generated = await generateChapters(name, chaptersToGenerate, aiHeaders);
          return { generated };
        },
      }),
    ] as WebMCPTool[];
  }, [aiHeaders, config.model, config.provider, isConfigured, isLoggedIn, loading]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.navigator.modelContext) {
      return;
    }

    const modelContext = window.navigator.modelContext;

    const register = async () => {
      try {
        if (typeof modelContext.provideContext === 'function') {
          await modelContext.provideContext({ tools });
          return;
        }

        if (typeof modelContext.registerTool === 'function') {
          for (const tool of tools) {
            await modelContext.registerTool(tool);
          }
        }
      } catch (error) {
        console.warn('[WebMCP] Failed to register tools:', toErrorMessage(error));
      }
    };

    void register();

    return () => {
      const unregister = async () => {
        try {
          if (typeof modelContext.provideContext === 'function') {
            await modelContext.provideContext({ tools: [] });
            return;
          }

          if (typeof modelContext.unregisterTool === 'function') {
            for (const tool of tools) {
              await modelContext.unregisterTool(tool.name);
            }
          }
        } catch (error) {
          console.warn('[WebMCP] Failed to unregister tools:', toErrorMessage(error));
        }
      };

      void unregister();
    };
  }, [tools]);

  return null;
}
