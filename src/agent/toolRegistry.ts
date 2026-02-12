import type { OutlineToolDefinition, OutlineToolName } from './types.js';

export class OutlineToolRegistry {
  private readonly tools = new Map<OutlineToolName, OutlineToolDefinition>();

  register(tool: OutlineToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: OutlineToolName): OutlineToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool;
  }

  list(): OutlineToolDefinition[] {
    return [...this.tools.values()];
  }
}
