import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { ChatTool, ChatMessage, ToolCallResult, ClaudeClientConfig } from '../types';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant that can query databases and answer questions about data.
When users ask questions about their data, use the available tools to fetch and analyze the information.
Always explain what you found in a clear, conversational way.
If a query returns no results, let the user know and suggest alternative queries they might try.`;

export class ClaudeClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private systemPrompt: string;

  constructor(config: ClaudeClientConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 4096;
    this.systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }

  async chat(
    messages: ChatMessage[],
    tools: ChatTool[]
  ): Promise<{ content: string; toolCalls: ToolCallResult[] }> {
    const anthropicMessages = this.toAnthropicMessages(messages);
    const anthropicTools = this.toAnthropicTools(tools);

    let response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: this.systemPrompt,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    const toolCalls: ToolCallResult[] = [];
    let currentMessages = [...anthropicMessages];

    // Handle tool use loop
    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      // Add assistant message with tool use
      currentMessages.push({
        role: 'assistant',
        content: response.content,
      });

      // Execute tools and collect results
      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        const tool = tools.find((t) => t.name === toolUse.name);
        let result: unknown;

        if (tool) {
          try {
            result = await tool.execute(toolUse.input as Record<string, unknown>);
            toolCalls.push({
              toolName: toolUse.name,
              input: toolUse.input as Record<string, unknown>,
              output: result,
            });
          } catch (error) {
            result = { error: error instanceof Error ? error.message : 'Unknown error' };
            toolCalls.push({
              toolName: toolUse.name,
              input: toolUse.input as Record<string, unknown>,
              output: result,
            });
          }
        } else {
          result = { error: `Tool ${toolUse.name} not found` };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      // Add tool results
      currentMessages.push({
        role: 'user',
        content: toolResults,
      });

      // Continue conversation
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.systemPrompt,
        messages: currentMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      });
    }

    // Extract final text content
    const textContent = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return {
      content: textContent,
      toolCalls,
    };
  }

  private toAnthropicMessages(messages: ChatMessage[]): MessageParam[] {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  private toAnthropicTools(tools: ChatTool[]): Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }
}

export function createClaudeClient(config: ClaudeClientConfig): ClaudeClient {
  return new ClaudeClient(config);
}
