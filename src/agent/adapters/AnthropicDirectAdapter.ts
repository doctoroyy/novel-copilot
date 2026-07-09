import Anthropic from '@anthropic-ai/sdk';
import type { 
  AgentRuntimeAdapter, 
  AdapterResponse, 
  AgentMessage, 
  ToolDefinition, 
  AdapterOptions,
  ToolCallResult,
  AgentMessageContent
} from './types.js';

export class AnthropicDirectAdapter implements AgentRuntimeAdapter {
  public provider = 'anthropic_direct';
  public model: string;
  private client: Anthropic;

  constructor(options: AdapterOptions) {
    this.model = options.model;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
    });
  }

  public async chat(
    systemPrompt: string,
    messages: AgentMessage[],
    tools: ToolDefinition[]
  ): Promise<AdapterResponse> {
    
    // Map our ToolDefinition to Anthropic Tool
    const anthropicTools: Anthropic.Tool[] = tools.map((tool, index) => {
      const isLastTool = index === tools.length - 1;
      return {
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: 'object',
          properties: tool.parameters?.properties || {},
          required: tool.parameters?.required || [],
        },
        // Apply cache_control to the last tool to cache the system prompt + all tools
        ...(isLastTool ? { cache_control: { type: 'ephemeral' } } : {})
      };
    }) as any[]; // Using any to bypass strict type checking if sdk version mismatches

    // Map our AgentMessage to Anthropic MessageParam
    const anthropicMessages: Anthropic.MessageParam[] = messages.map(msg => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role === 'assistant' ? 'assistant' : 'user', // System role is passed at top level
          content: msg.content
        };
      } else {
        // Complex content (tool uses or tool results)
        const content = msg.content.map(part => {
          if (part.type === 'tool_use') {
            return {
              type: 'tool_use',
              id: part.tool_use_id!,
              name: part.name!,
              input: part.input || {},
            } as Anthropic.ToolUseBlockParam;
          } else if (part.type === 'tool_result') {
            return {
              type: 'tool_result',
              tool_use_id: part.tool_use_id!,
              content: part.content,
              is_error: part.is_error,
            } as Anthropic.ToolResultBlockParam;
          } else {
            return {
              type: 'text',
              text: part.text || '',
            } as Anthropic.TextBlockParam;
          }
        });

        return {
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: content as Anthropic.ContentBlockParam[]
        };
      }
    });

    // Create system prompt block. We don't cache this if we cache the tools, 
    // or we could cache this if tools are empty.
    const system = anthropicTools.length > 0 
      ? systemPrompt 
      : [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } } as any];

    const response = await this.client.messages.create({
      model: this.model,
      system: system as any,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      max_tokens: 4096,
      temperature: 0.7,
    });

    const resultMessage: AgentMessage = {
      role: 'assistant',
      content: response.content.map(block => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text } as AgentMessageContent;
        } else if (block.type === 'tool_use') {
          return { 
            type: 'tool_use', 
            tool_use_id: block.id, 
            name: block.name, 
            input: block.input 
          } as AgentMessageContent;
        }
        return { type: 'text', text: '' } as AgentMessageContent; // fallback
      })
    };

    const toolCalls: ToolCallResult[] = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    return {
      message: resultMessage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheHitTokens: (response.usage as any).cache_read_input_tokens || 0,
      }
    };
  }
}
