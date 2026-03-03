import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clinic_id, geometry } = body;

    if (!clinic_id || !geometry) {
      return NextResponse.json(
        { error: 'clinic_id and geometry are required' },
        { status: 400 }
      );
    }

    const geometryJson = JSON.stringify(geometry);

    // Use PostgREST RPC to call a function that updates the geom column
    // First try to update using ST_GeomFromGeoJSON via raw SQL
    const sqlQuery = `
      UPDATE clinic_territories
      SET geom = ST_SetSRID(ST_GeomFromGeoJSON('${geometryJson.replace(/'/g, "''")}'), 4326)
      WHERE clinic_id = '${clinic_id}'
      RETURNING clinic_id
    `;

    // Execute via Supabase's SQL endpoint (requires service role key)
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sqlQuery })
    });

    if (!response.ok) {
      // exec_sql RPC might not exist, try alternative approach
      // Update the geom column directly - PostgREST should accept GeoJSON for geometry columns
      const directResponse = await fetch(
        `${supabaseUrl}/rest/v1/clinic_territories?clinic_id=eq.${clinic_id}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            // PostgREST accepts geometry as GeoJSON string for geometry columns
            geom: geometryJson
          })
        }
      );

      if (!directResponse.ok) {
        const errorText = await directResponse.text();

        // If geom update fails, this is likely because geom is also generated or has constraints
        // Return specific error for debugging
        console.error('Direct geom update failed:', errorText);
        return NextResponse.json(
          { error: `Cannot update boundary. The geom column may be read-only. Error: ${errorText}` },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, method: 'direct' });
    }

    return NextResponse.json({ success: true, method: 'sql' });
  } catch (error) {
    console.error('Save boundary error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save boundary' },
      { status: 500 }
    );
  }
}
