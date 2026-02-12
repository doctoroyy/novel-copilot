declare global {
  type WebMCPJsonSchema = {
    type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
    description?: string;
    properties?: Record<string, WebMCPJsonSchema>;
    items?: WebMCPJsonSchema;
    required?: string[];
    enum?: Array<string | number | boolean>;
    minimum?: number;
    maximum?: number;
    additionalProperties?: boolean;
  };

  interface WebMCPAgent {
    requestUserInteraction?<T>(callback: () => T | Promise<T>): Promise<T>;
  }

  interface WebMCPTool {
    name: string;
    description: string;
    inputSchema: WebMCPJsonSchema;
    execute: (input: Record<string, unknown>, agent: WebMCPAgent) => unknown | Promise<unknown>;
  }

  interface WebMCPModelContext {
    provideContext?: (context: { tools: WebMCPTool[] }) => void | Promise<void>;
    registerTool?: (tool: WebMCPTool) => void | Promise<void>;
    unregisterTool?: (toolName: string) => void | Promise<void>;
  }

  interface Navigator {
    modelContext?: WebMCPModelContext;
  }
}

export {};
