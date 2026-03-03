import type { Tool } from '@anthropic-ai/sdk/resources/messages';

// Message types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCallResult[];
  isLoading?: boolean;
}

export interface ToolCallResult {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
}

// Tool types
export interface ChatTool {
  name: string;
  description: string;
  inputSchema: Tool['input_schema'];
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolRegistry {
  tools: ChatTool[];
  register: (tool: ChatTool) => void;
  getTool: (name: string) => ChatTool | undefined;
  toClaudeTools: () => Tool[];
}

// Adapter types
export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable?: boolean;
  description?: string;
}

export interface QueryOptions {
  table: string;
  select?: string[];
  filter?: Record<string, unknown>;
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
  offset?: number;
}

export interface UpdateOptions {
  table: string;
  filter: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface InsertOptions {
  table: string;
  data: Record<string, unknown>;
}

export interface DeleteOptions {
  table: string;
  filter: Record<string, unknown>;
}

export interface DataAdapter {
  listTables: () => Promise<string[]>;
  describeTable: (tableName: string) => Promise<TableSchema | null>;
  queryTable: (options: QueryOptions) => Promise<unknown[]>;
}

export interface WritableDataAdapter extends DataAdapter {
  updateRecord: (options: UpdateOptions) => Promise<unknown[]>;
  insertRecord: (options: InsertOptions) => Promise<unknown[]>;
  deleteRecord: (options: DeleteOptions) => Promise<unknown[]>;
}

export interface SupabaseAdapterConfig {
  supabaseUrl: string;
  supabaseKey: string;
  allowedTables: string[];
  tableDescriptions?: Record<string, string>;
  columnDescriptions?: Record<string, Record<string, string>>;
}

// Claude client types
export interface ClaudeClientConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
}

// Component types
export type ChatVariant = 'default' | 'shadcn';

export interface ChatContainerProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  variant?: ChatVariant;
  className?: string;
  children?: React.ReactNode;
}

export interface ChatMessagesProps {
  messages: ChatMessage[];
  variant?: ChatVariant;
  className?: string;
}

export interface ChatInputProps {
  onSend: (content: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  variant?: ChatVariant;
  className?: string;
}

export interface ChatBubbleProps {
  message: ChatMessage;
  variant?: ChatVariant;
  className?: string;
}

// Hook types
export interface UseChatOptions {
  apiEndpoint: string;
  initialMessages?: ChatMessage[];
  onError?: (error: Error) => void;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  sendMessage: (content: string) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
  clearMessages: () => void;
}

// API types for route handlers
export interface ChatAPIRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface ChatAPIResponse {
  message: {
    role: 'assistant';
    content: string;
    toolCalls?: ToolCallResult[];
  };
}
