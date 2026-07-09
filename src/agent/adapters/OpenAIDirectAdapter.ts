import OpenAI from 'openai';
import type { 
  AgentRuntimeAdapter, 
  AdapterResponse, 
  AgentMessage, 
  ToolDefinition, 
  AdapterOptions,
  ToolCallResult,
  AgentMessageContent
} from './types.js';

export class OpenAIDirectAdapter implements AgentRuntimeAdapter {
  public provider = 'openai_direct';
  public model: string;
  private client: OpenAI;

  constructor(options: AdapterOptions) {
    this.model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
    });
  }

  public async chat(
    systemPrompt: string,
    messages: AgentMessage[],
    tools: ToolDefinition[]
  ): Promise<AdapterResponse> {
    
    // Map our ToolDefinition to OpenAI Tool
    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((tool) => {
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: tool.parameters?.properties || {},
            required: tool.parameters?.required || [],
            additionalProperties: false,
          },
        }
      };
    });

    // Construct the message array
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    
    // System prompt comes first
    openaiMessages.push({
      role: 'system',
      content: systemPrompt
    });

    // Map conversation history
    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'system') {
        let content = '';
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else {
          // Flatten text contents for user messages (OpenAI doesn't have complex user contents exactly like Anthropic except for vision, we'll keep it simple)
          content = msg.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
        }
        
        if (msg.role === 'user') {
          openaiMessages.push({ role: 'user', content });
        }
        // ignoring intermediate system messages for now, or could map to system
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          openaiMessages.push({ role: 'assistant', content: msg.content });
        } else {
          // Check for tool calls in assistant response
          const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];
          const textBlocks: string[] = [];
          
          for (const part of msg.content) {
            if (part.type === 'tool_use') {
              toolCalls.push({
                id: part.tool_use_id!,
                type: 'function',
                function: {
                  name: part.name!,
                  arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input || {}),
                }
              });
            } else if (part.type === 'text' && part.text) {
              textBlocks.push(part.text);
            }
          }

          if (toolCalls.length > 0) {
            openaiMessages.push({
              role: 'assistant',
              content: textBlocks.join('\n') || null,
              tool_calls: toolCalls,
            });
          } else {
            openaiMessages.push({
              role: 'assistant',
              content: textBlocks.join('\n'),
            });
          }
        }
      } else if (msg.role === 'tool') {
        // Our 'tool' role is used to return tool results
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'tool_result') {
              openaiMessages.push({
                role: 'tool',
                tool_call_id: part.tool_use_id!,
                content: part.content || '',
              });
            }
          }
        }
      }
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      temperature: 0.7,
      max_tokens: 4096,
    });

    const choice = response.choices[0];
    const message = choice.message;

    const resultMessageContent: AgentMessageContent[] = [];
    const toolCallsResult: ToolCallResult[] = [];

    if (message.content) {
      resultMessageContent.push({
        type: 'text',
        text: message.content,
      });
    }

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const tcRaw of message.tool_calls) {
        const tc = tcRaw as any;
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments);
        } catch (e) {
          // If parsing fails, pass the raw string
          parsedArgs = tc.function.arguments;
        }

        resultMessageContent.push({
          type: 'tool_use',
          tool_use_id: tc.id,
          name: tc.function.name,
          input: parsedArgs,
        });

        toolCallsResult.push({
          id: tc.id,
          name: tc.function.name,
          arguments: parsedArgs,
        });
      }
    }

    const resultMessage: AgentMessage = {
      role: 'assistant',
      content: resultMessageContent,
    };

    return {
      message: resultMessage,
      toolCalls: toolCallsResult.length > 0 ? toolCallsResult : undefined,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        // OpenAI doesn't support cache hit tokens in the same way yet in the generic payload
        cacheHitTokens: (response.usage as any)?.prompt_tokens_details?.cached_tokens || 0, 
      }
    };
  }
}
