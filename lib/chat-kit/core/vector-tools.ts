import type { ChatTool } from '../types';

export interface VectorToolsConfig {
  supabaseUrl: string;
  supabaseKey: string;
  edgeFunctionUrl?: string;
}

/**
 * Creates vector search tools for semantic similarity queries.
 * These tools enable AI-powered recommendations and semantic search.
 */
export function createVectorTools(config: VectorToolsConfig): ChatTool[] {
  const { supabaseUrl, supabaseKey } = config;

  async function supabaseRpc<T>(
    functionName: string,
    params: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase RPC error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  async function generateEmbedding(text: string): Promise<number[]> {
    // Call the generate-embedding Edge Function
    const response = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding generation failed: ${errorText}`);
    }

    const data = await response.json();
    return data.embeddings;
  }

  return [
    {
      name: 'semantic_search',
      description: 'Search for records using natural language. Finds semantically similar content across leads, visibility results, SEO information, and ads. Use this when the user wants to find records "like" something or wants recommendations.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Natural language search query (e.g., "leads interested in back pain relief", "high-performing urban clinic ads")',
          },
          table: {
            type: 'string',
            enum: ['clinic_leads', 'aio_visibility_results', 'client_seo_information', 'tiktok_daily_ads'],
            description: 'Which table to search in',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 10)',
          },
        },
        required: ['query', 'table'],
      },
      async execute(input: Record<string, unknown>) {
        const query = input.query as string;
        const table = input.table as string;
        const limit = (input.limit as number) || 10;

        try {
          // Generate embedding for the search query
          const embedding = await generateEmbedding(query);

          // Call appropriate search function based on table
          let results: unknown[];

          switch (table) {
            case 'clinic_leads':
              results = await supabaseRpc('find_similar_leads', {
                query_embedding: JSON.stringify(embedding),
                match_count: limit,
                similarity_threshold: 0.5,
              });
              break;
            case 'aio_visibility_results':
              results = await supabaseRpc('search_visibility_results', {
                query_embedding: JSON.stringify(embedding),
                match_count: limit,
              });
              break;
            case 'tiktok_daily_ads':
              results = await supabaseRpc('find_similar_ads', {
                query_embedding: JSON.stringify(embedding),
                match_count: limit,
              });
              break;
            default:
              throw new Error(`Semantic search not supported for table: ${table}`);
          }

          return {
            query,
            table,
            result_count: Array.isArray(results) ? results.length : 0,
            results,
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : 'Search failed',
            hint: 'Make sure embeddings have been generated for this table. Run the backfill process if needed.',
          };
        }
      },
    },
    {
      name: 'find_similar_records',
      description: 'Find records similar to a specific existing record. Use this for "more like this" recommendations.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          table: {
            type: 'string',
            enum: ['clinic_leads'],
            description: 'The table containing the source record',
          },
          record_id: {
            type: 'string',
            description: 'UUID of the record to find similar items for',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of similar records to return (default: 10)',
          },
        },
        required: ['table', 'record_id'],
      },
      async execute(input: Record<string, unknown>) {
        const table = input.table as string;
        const recordId = input.record_id as string;
        const limit = (input.limit as number) || 10;

        try {
          let results: unknown[];

          switch (table) {
            case 'clinic_leads':
              results = await supabaseRpc('find_leads_similar_to', {
                source_lead_id: recordId,
                match_count: limit,
                similarity_threshold: 0.6,
              });
              break;
            default:
              throw new Error(`Similar record search not supported for table: ${table}`);
          }

          return {
            source_record_id: recordId,
            table,
            similar_count: Array.isArray(results) ? results.length : 0,
            similar_records: results,
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : 'Search failed',
            hint: 'Make sure the source record has an embedding generated.',
          };
        }
      },
    },
    {
      name: 'get_embedding_status',
      description: 'Check the status of vector embeddings for a table. Shows how many records have embeddings and how many are pending.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          table: {
            type: 'string',
            enum: ['clinic_leads', 'aio_visibility_results', 'client_seo_information', 'tiktok_daily_ads'],
            description: 'The table to check embedding status for',
          },
        },
        required: ['table'],
      },
      async execute(input: Record<string, unknown>) {
        const table = input.table as string;

        try {
          // Query to get counts
          const response = await fetch(
            `${supabaseUrl}/rest/v1/${table}?select=id,embedding&limit=1`,
            {
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Prefer': 'count=exact',
              },
            }
          );

          const totalCount = parseInt(response.headers.get('content-range')?.split('/')[1] || '0');

          // Count with embeddings
          const withEmbeddingResponse = await fetch(
            `${supabaseUrl}/rest/v1/${table}?select=id&embedding=not.is.null&limit=1`,
            {
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Prefer': 'count=exact',
              },
            }
          );

          const withEmbeddingCount = parseInt(
            withEmbeddingResponse.headers.get('content-range')?.split('/')[1] || '0'
          );

          // Check queue
          const queueResponse = await fetch(
            `${supabaseUrl}/rest/v1/embedding_queue?select=id&table_name=eq.${table}&status=eq.pending&limit=1`,
            {
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Prefer': 'count=exact',
              },
            }
          );

          const pendingCount = parseInt(
            queueResponse.headers.get('content-range')?.split('/')[1] || '0'
          );

          return {
            table,
            total_records: totalCount,
            with_embeddings: withEmbeddingCount,
            without_embeddings: totalCount - withEmbeddingCount,
            pending_in_queue: pendingCount,
            coverage_percentage: totalCount > 0
              ? Math.round((withEmbeddingCount / totalCount) * 100)
              : 0,
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : 'Failed to get status',
          };
        }
      },
    },
    {
      name: 'trigger_embedding_backfill',
      description: 'Queue records for embedding generation. Use this to backfill embeddings for a table.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          table: {
            type: 'string',
            enum: ['clinic_leads', 'aio_visibility_results', 'client_seo_information', 'tiktok_daily_ads'],
            description: 'The table to backfill embeddings for',
          },
          batch_size: {
            type: 'number',
            description: 'Number of records to queue (default: 100, max: 1000)',
          },
        },
        required: ['table'],
      },
      async execute(input: Record<string, unknown>) {
        const table = input.table as string;
        const batchSize = Math.min((input.batch_size as number) || 100, 1000);

        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/backfill-embeddings`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              table_name: table,
              batch_size: batchSize,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Backfill failed: ${errorText}`);
          }

          const result = await response.json();
          return {
            table,
            ...result,
            next_step: result.queued > 0
              ? 'Records queued. Run process_embedding_queue to generate embeddings.'
              : 'No records need embeddings.',
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : 'Backfill failed',
          };
        }
      },
    },
  ];
}
