/**
 * Novel Copilot MCP Server — Server definition
 *
 * Registers tools, resources, and prompts that expose
 * the novel-copilot engine to Claude Code or any MCP client.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from './bridge/db.js';
import { registerProjectTools } from './tools/project.js';
import { registerOutlineTools } from './tools/outline.js';
import { registerCharacterTools } from './tools/characters.js';
import { registerChapterTools } from './tools/chapter.js';
import { registerContextTools } from './tools/context.js';
import { registerQcTools } from './tools/qc.js';
import { registerBatchTools } from './tools/batch.js';
import { registerGenerateTools } from './tools/generate.js';
import { registerMemoryTools } from './tools/memory.js';
import { registerExportTools } from './tools/export.js';
import { registerResources } from './resources/novel.js';
import { registerPrompts } from './prompts/templates.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'novel-copilot',
    version: '0.1.0',
  });

  const db = getDb();

  // Register all tool groups
  registerProjectTools(server, db);
  registerOutlineTools(server, db);
  registerCharacterTools(server, db);
  registerChapterTools(server, db);
  registerContextTools(server, db);
  registerQcTools(server, db);
  registerBatchTools(server, db);
  registerGenerateTools(server, db);
  registerMemoryTools(server, db);
  registerExportTools(server, db);

  // Register resources and prompts
  registerResources(server, db);
  registerPrompts(server);

  return server;
}
