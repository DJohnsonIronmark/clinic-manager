import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface QueueItem {
  id: string;
  table_name: string;
  record_id: string;
  status: string;
}

interface ProcessRequest {
  batch_size?: number;
  debug?: boolean;
}

// Table configuration for primary key column and ID types
const tableConfig: Record<string, { pkColumn: string; idType: 'integer' | 'uuid' | 'bigint' }> = {
  'clinic_leads': { pkColumn: 'contact_id', idType: 'integer' },
  'aio_visibility_results': { pkColumn: 'id', idType: 'uuid' },
  'client_seo_information': { pkColumn: 'id', idType: 'bigint' },
  'tiktok_daily_ads': { pkColumn: 'id', idType: 'bigint' },
};

// Truncate text to stay within OpenAI's 8192 token limit
// Using ~3.5 chars/token estimate, 28000 chars ≈ 8000 tokens (safe buffer)
const MAX_CHARS = 28000;
function truncateText(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  // Truncate at word boundary if possible
  const truncated = text.slice(0, MAX_CHARS);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > MAX_CHARS - 500 ? truncated.slice(0, lastSpace) : truncated;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify({ 
      error: 'OPENAI_API_KEY not configured',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: ProcessRequest = await req.json().catch(() => ({}));
    // Increased default batch size for batched API calls
    const batchSize = body.batch_size || 100;

    // Debug mode
    if (body.debug) {
      const { data: queueStatus } = await supabase
        .from('embedding_queue')
        .select('status')
        .limit(1000);
      
      const statusCounts = (queueStatus || []).reduce((acc: Record<string, number>, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {});

      return new Response(JSON.stringify({
        debug: true,
        has_openai_key: true,
        key_prefix: OPENAI_API_KEY.substring(0, 7) + '...',
        queue_status: statusCounts,
        batch_size: batchSize,
        mode: 'batched'
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get pending items from queue
    const { data: queueItems, error: fetchError } = await supabase
      .from('embedding_queue')
      .select('*')
      .eq('status', 'pending')
      .limit(batchSize);

    if (fetchError) {
      throw new Error(`Failed to fetch queue: ${fetchError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({ 
        message: 'No pending items in queue',
        processed: 0 
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mark all as processing
    const queueIds = queueItems.map((item: QueueItem) => item.id);
    await supabase
      .from('embedding_queue')
      .update({ status: 'processing' })
      .in('id', queueIds);

    // Get embeddable text for all items in parallel
    const textPromises = queueItems.map(async (item: QueueItem) => {
      const { data: textData, error: textError } = await supabase
        .rpc('get_embeddable_text', {
          p_table_name: item.table_name,
          p_record_id: item.record_id,
        });
      
      return {
        item,
        text: textError ? null : textData,
        error: textError?.message
      };
    });

    const textResults = await Promise.all(textPromises);
    
    // Filter out items with no text
    const validItems = textResults.filter(r => r.text && r.text.trim().length > 0);
    const failedTextItems = textResults.filter(r => !r.text || r.text.trim().length === 0);

    // Mark items with no text as failed
    for (const failed of failedTextItems) {
      await supabase
        .from('embedding_queue')
        .update({ 
          status: 'failed',
          error_message: failed.error || 'No embeddable text',
          processed_at: new Date().toISOString()
        })
        .eq('id', failed.item.id);
    }

    if (validItems.length === 0) {
      return new Response(JSON.stringify({
        message: 'No valid texts to embed',
        processed: 0,
        failed: failedTextItems.length
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Batch call to OpenAI - send all texts at once (truncated to fit token limit)
    const textsToEmbed = validItems.map(r => truncateText(r.text));
    
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: textsToEmbed,
      }),
    });

    if (!embeddingResponse.ok) {
      const errorText = await embeddingResponse.text();
      throw new Error(`OpenAI API error: ${errorText}`);
    }

    const embeddingData = await embeddingResponse.json();
    const embeddings = embeddingData.data;

    // Update all records with their embeddings
    let processed = 0;
    let failed = failedTextItems.length;
    const errors: string[] = [];

    for (let i = 0; i < validItems.length; i++) {
      const { item } = validItems[i];
      const embedding = embeddings[i].embedding;

      try {
        const config = tableConfig[item.table_name];
        const pkColumn = config?.pkColumn || 'id';
        
        let parsedId: string | number = item.record_id;
        if (config?.idType === 'bigint' || config?.idType === 'integer') {
          parsedId = parseInt(item.record_id, 10);
        }

        const { error: updateError } = await supabase
          .from(item.table_name)
          .update({ 
            embedding: JSON.stringify(embedding),
            embedding_updated_at: new Date().toISOString()
          })
          .eq(pkColumn, parsedId);
        
        if (updateError) throw new Error(updateError.message);

        // Remove from queue
        await supabase
          .from('embedding_queue')
          .delete()
          .eq('id', item.id);

        processed++;
      } catch (err) {
        failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`${item.table_name}/${item.record_id}: ${errorMsg}`);
        
        await supabase
          .from('embedding_queue')
          .update({ 
            status: 'failed',
            error_message: errorMsg,
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);
      }
    }

    return new Response(JSON.stringify({
      message: `Processed ${processed} embeddings, ${failed} failed`,
      processed,
      failed,
      batch_mode: true,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error processing queue:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : String(error) 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
