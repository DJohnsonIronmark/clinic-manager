import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { ChatTool, ToolRegistry, DataAdapter, WritableDataAdapter } from '../types';

// Re-export vector tools
export { createVectorTools, type VectorToolsConfig } from './vector-tools';

export function createToolRegistry(): ToolRegistry {
  const tools: ChatTool[] = [];

  return {
    tools,
    register(tool: ChatTool) {
      const existingIndex = tools.findIndex((t) => t.name === tool.name);
      if (existingIndex >= 0) {
        tools[existingIndex] = tool;
      } else {
        tools.push(tool);
      }
    },
    getTool(name: string) {
      return tools.find((t) => t.name === name);
    },
    toClaudeTools(): Tool[] {
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
    },
  };
}

// Creates standard database query tools from an adapter
export function createDatabaseTools(adapter: DataAdapter): ChatTool[] {
  return [
    {
      name: 'list_tables',
      description: 'List all available tables/data sources that can be queried',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
      async execute() {
        return adapter.listTables();
      },
    },
    {
      name: 'describe_table',
      description: 'Get the schema/structure of a specific table, including column names and types',
      inputSchema: {
        type: 'object' as const,
        properties: {
          table_name: {
            type: 'string',
            description: 'The name of the table to describe',
          },
        },
        required: ['table_name'],
      },
      async execute(input: Record<string, unknown>) {
        const tableName = input.table_name as string;
        return adapter.describeTable(tableName);
      },
    },
    {
      name: 'query_table',
      description: 'Query data from a table with optional filtering, sorting, and pagination',
      inputSchema: {
        type: 'object' as const,
        properties: {
          table: {
            type: 'string',
            description: 'The name of the table to query',
          },
          select: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of columns to select. If not provided, all columns are returned',
          },
          filter: {
            type: 'object',
            description: 'Filter conditions as key-value pairs (column: value). Supports eq, gt, lt, gte, lte, like, ilike operators as nested objects',
            additionalProperties: true,
          },
          order_by: {
            type: 'object',
            properties: {
              column: { type: 'string' },
              ascending: { type: 'boolean', default: true },
            },
            description: 'Sort the results by a column',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of rows to return (default: 100)',
          },
          offset: {
            type: 'number',
            description: 'Number of rows to skip (for pagination)',
          },
        },
        required: ['table'],
      },
      async execute(input: Record<string, unknown>) {
        return adapter.queryTable({
          table: input.table as string,
          select: input.select as string[] | undefined,
          filter: input.filter as Record<string, unknown> | undefined,
          orderBy: input.order_by as { column: string; ascending?: boolean } | undefined,
          limit: (input.limit as number) || 100,
          offset: input.offset as number | undefined,
        });
      },
    },
  ];
}

// Creates write tools for a writable adapter
export function createWriteTools(adapter: WritableDataAdapter): ChatTool[] {
  return [
    {
      name: 'update_record',
      description: 'Update one or more records in a table. Use this to modify existing data like clinic territories or settings.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          table: {
            type: 'string',
            description: 'The name of the table to update',
          },
          filter: {
            type: 'object',
            description: 'Filter to identify which records to update (e.g., { clinic_id: "123" })',
            additionalProperties: true,
          },
          data: {
            type: 'object',
            description: 'The data to update (column: new_value pairs)',
            additionalProperties: true,
          },
        },
        required: ['table', 'filter', 'data'],
      },
      async execute(input: Record<string, unknown>) {
        return adapter.updateRecord({
          table: input.table as string,
          filter: input.filter as Record<string, unknown>,
          data: input.data as Record<string, unknown>,
        });
      },
    },
    {
      name: 'insert_record',
      description: 'Insert a new record into a table. Use this to add new clinics or data.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          table: {
            type: 'string',
            description: 'The name of the table to insert into',
          },
          data: {
            type: 'object',
            description: 'The data to insert (column: value pairs)',
            additionalProperties: true,
          },
        },
        required: ['table', 'data'],
      },
      async execute(input: Record<string, unknown>) {
        return adapter.insertRecord({
          table: input.table as string,
          data: input.data as Record<string, unknown>,
        });
      },
    },
    {
      name: 'delete_record',
      description: 'Delete one or more records from a table. Use with caution - this permanently removes data.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          table: {
            type: 'string',
            description: 'The name of the table to delete from',
          },
          filter: {
            type: 'object',
            description: 'Filter to identify which records to delete (e.g., { clinic_id: "123" })',
            additionalProperties: true,
          },
        },
        required: ['table', 'filter'],
      },
      async execute(input: Record<string, unknown>) {
        return adapter.deleteRecord({
          table: input.table as string,
          filter: input.filter as Record<string, unknown>,
        });
      },
    },
  ];
}
