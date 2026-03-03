// Client-side exports
export { ChatBubble, ChatMessages, ChatInput, ChatContainer } from './components';
export { useChat } from './hooks/useChat';

// Server-side exports
export { ClaudeClient, createClaudeClient } from './core/claude-client';
export { createToolRegistry, createDatabaseTools, createWriteTools } from './core/tool-registry';
export { createSupabaseAdapter } from './adapters/supabase-adapter';

// Types
export type {
  ChatMessage,
  ChatVariant,
  ChatContainerProps,
  ChatMessagesProps,
  ChatInputProps,
  ChatBubbleProps,
  UseChatOptions,
  UseChatReturn,
  ToolCallResult,
  ChatAPIRequest,
  ChatAPIResponse,
  ChatTool,
  ToolRegistry,
  DataAdapter,
  WritableDataAdapter,
  UpdateOptions,
  InsertOptions,
  DeleteOptions,
  TableSchema,
  ColumnSchema,
  QueryOptions,
  SupabaseAdapterConfig,
  ClaudeClientConfig,
} from './types';
