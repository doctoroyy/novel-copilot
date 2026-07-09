/**
 * Interface definitions for Agent Runtime Adapters
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema object for arguments
}

export interface AgentMessageContent {
  type: 'text' | 'tool_result' | 'tool_use';
  text?: string;
  tool_use_id?: string;
  is_error?: boolean;
  content?: string; // For tool_result
  name?: string; // For tool_use
  input?: any; // For tool_use
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | AgentMessageContent[];
  // For OpenAI compatibility:
  tool_call_id?: string;
  name?: string;
}

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: any; // Parsed JSON arguments
}

export interface AdapterUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens?: number; // Specifically for Anthropic Prompt Caching
}

export interface AdapterResponse {
  message: AgentMessage;
  toolCalls?: ToolCallResult[];
  usage: AdapterUsage;
}

export interface AdapterOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * Standard interface for all Agent Runtimes (Anthropic, OpenAI, etc.)
 */
export interface AgentRuntimeAdapter {
  provider: string;
  model: string;

  /**
   * Execute one turn of the agent loop.
   * @param systemPrompt The complete system prompt
   * @param messages The conversation history so far
   * @param tools The list of tools the agent can use
   */
  chat(
    systemPrompt: string,
    messages: AgentMessage[],
    tools: ToolDefinition[]
  ): Promise<AdapterResponse>;
}
