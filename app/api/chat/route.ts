import { NextRequest, NextResponse } from 'next/server';
import {
  createClaudeClient,
  createSupabaseAdapter,
  createDatabaseTools,
  createWriteTools,
  createVectorTools,
  type ChatAPIRequest,
  type ChatMessage,
  type ChatTool,
} from '@/lib/chat-kit';

const SYSTEM_PROMPT = `You are a clinic territory data assistant for The Joint Chiropractic. You help users query, understand, and manage clinic location and territory data. You also have AI-powered semantic search and recommendation capabilities.

Available tables you can query and modify:
- clinic_territories: Territory data including clinic_id, clinic_name, state, city, metro_type (Urban/Suburban/Rural), and geographic boundaries
- TJC Locations GeoCoded: Clinic addresses with ClinicID, Name, Address, City, State, Zip, latitude, longitude

Additional tables available for AI-powered search:
- clinic_leads: Lead data with contact info, source, notes (supports semantic search)
- aio_visibility_results: AI visibility tracking results (supports semantic search)
- tiktok_daily_ads: TikTok ad performance data (supports semantic search)

CAPABILITIES:

1. **Query Data**: Use query_table to search and analyze clinic data
   - "How many clinics are in Texas?"
   - "Show me urban clinics"
   - "What's the metro type breakdown?"

2. **AI-Powered Semantic Search**: Use semantic_search for natural language queries
   - "Find leads interested in back pain relief"
   - "Show me high-performing TikTok ads"
   - "Find visibility results about chiropractic care"
   - This searches by meaning, not just keywords!

3. **Find Similar Records**: Use find_similar_records for recommendations
   - "Find leads similar to this one"
   - Great for "more like this" recommendations

4. **Update Data**: Use update_record to modify clinic territories or settings
   - Update metro_type for a clinic
   - Modify territory boundaries
   - Always confirm changes with the user before executing

5. **Add/Remove Clinics**: Use insert_record and delete_record
   - Add new clinic territories
   - Remove clinics (use with caution, always confirm first)

6. **Generate Map Links**: Use generate_map_link to create shareable URLs
   - Show specific clinic territories on an interactive map
   - Useful for sharing with stakeholders

7. **Generate Screenshots**: Use generate_screenshot to create static map images
   - Get PNG images of clinic territories
   - Useful for reports and presentations

8. **Embedding Management**: Use get_embedding_status and trigger_embedding_backfill
   - Check how many records have AI embeddings
   - Queue records for embedding generation

IMPORTANT GUIDELINES:
- For write operations (update, insert, delete), ALWAYS confirm with the user before executing
- When generating map links or screenshots, provide the full URL
- metro_type determines drive-time isochrone: Urban=15min, Suburban=20min, Rural=30min
- For semantic search, if embeddings aren't generated yet, suggest using trigger_embedding_backfill
- The base URL for this app is provided in the tools

TASK PROGRESS & SUMMARIES:
- For multi-step operations, provide brief progress updates (e.g., "Querying clinic data...", "Deleting record...", "Recalculating overlaps...")
- After completing any write operation (update, insert, delete), ALWAYS provide a final summary that includes:
  1. What action was taken (e.g., "Deleted North Murfreesboro clinic")
  2. Which tables were affected
  3. Any follow-up actions completed (e.g., "Recalculated neighboring territory ranges")
  4. Current state (e.g., "The map now shows X clinics in Tennessee")
- Keep summaries concise but complete - users should understand exactly what changed`;

export async function POST(request: NextRequest) {
  try {
    const body: ChatAPIRequest = await request.json();
    const { messages } = body;

    // Get base URL for generating links
    const baseUrl = request.nextUrl.origin;

    // Validate API keys
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Service role for reads and writes (tables are RLS-locked); no public-key fallback
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!anthropicKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured' },
        { status: 500 }
      );
    }

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase credentials not configured' },
        { status: 500 }
      );
    }

    // Create adapter with allowed tables
    const adapter = createSupabaseAdapter({
      supabaseUrl,
      supabaseKey,
      allowedTables: [
        'clinic_territories',
        'TJC Locations GeoCoded',
      ],
      tableDescriptions: {
        clinic_territories: 'Territory polygons with clinic_id, clinic_name, state, city, metro_type, and geographic boundaries',
        'TJC Locations GeoCoded': 'Clinic addresses with ClinicID, Name, Address, City, State, Zip, latitude, longitude',
      },
    });

    // Create Claude client
    const claude = createClaudeClient({
      apiKey: anthropicKey,
      systemPrompt: SYSTEM_PROMPT,
    });

    // Create all tools
    const readTools = createDatabaseTools(adapter);
    const writeTools = createWriteTools(adapter);
    const vectorTools = createVectorTools({
      supabaseUrl,
      supabaseKey,
    });

    // Add map link generator tool
    const mapLinkTool: ChatTool = {
      name: 'generate_map_link',
      description: 'Generate a shareable URL to view specific clinic territories on an interactive map. Returns a URL that can be shared with others.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          clinic_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of clinic IDs to display on the map',
          },
          title: {
            type: 'string',
            description: 'Optional title for the map view',
          },
        },
        required: ['clinic_ids'],
      },
      async execute(input: Record<string, unknown>) {
        const clinicIds = input.clinic_ids as string[];
        const title = input.title as string | undefined;

        let url = `${baseUrl}/map?clinics=${clinicIds.join(',')}`;
        if (title) {
          url += `&title=${encodeURIComponent(title)}`;
        }

        return {
          url,
          clinic_count: clinicIds.length,
          message: `Interactive map link generated for ${clinicIds.length} clinic(s)`,
        };
      },
    };

    // Add screenshot generator tool
    const screenshotTool: ChatTool = {
      name: 'generate_screenshot',
      description: 'Generate a static PNG screenshot of clinic territories. Returns a URL to download the image. Best for 1-5 clinics due to map complexity.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          clinic_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of clinic IDs to include in the screenshot',
          },
          width: {
            type: 'number',
            description: 'Image width in pixels (default: 800)',
          },
          height: {
            type: 'number',
            description: 'Image height in pixels (default: 600)',
          },
        },
        required: ['clinic_ids'],
      },
      async execute(input: Record<string, unknown>) {
        const clinicIds = input.clinic_ids as string[];
        const width = (input.width as number) || 800;
        const height = (input.height as number) || 600;

        const url = `${baseUrl}/api/screenshot?clinics=${clinicIds.join(',')}&width=${width}&height=${height}`;

        // Check if it will work by making a HEAD request
        try {
          const response = await fetch(url, { method: 'GET' });
          if (response.headers.get('content-type')?.includes('image')) {
            return {
              image_url: url,
              clinic_count: clinicIds.length,
              dimensions: `${width}x${height}`,
              message: `Screenshot generated for ${clinicIds.length} clinic(s). Download: ${url}`,
            };
          } else {
            const data = await response.json();
            return {
              error: 'Territory polygons too complex for static image',
              interactive_url: data.interactive_url || `${baseUrl}/map?clinics=${clinicIds.join(',')}`,
              message: 'Use the interactive map link instead for complex territories',
            };
          }
        } catch {
          return {
            image_url: url,
            clinic_count: clinicIds.length,
            note: 'Screenshot URL generated. If territories are complex, use generate_map_link instead.',
          };
        }
      },
    };

    const allTools = [...readTools, ...writeTools, ...vectorTools, mapLinkTool, screenshotTool];

    // Convert API messages to ChatMessage format
    const chatMessages: ChatMessage[] = messages.map((msg, index) => ({
      id: `msg_${index}`,
      role: msg.role,
      content: msg.content,
      timestamp: new Date(),
    }));

    // Get response from Claude
    const response = await claude.chat(chatMessages, allTools);

    return NextResponse.json({
      message: {
        role: 'assistant' as const,
        content: response.content,
        toolCalls: response.toolCalls,
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
