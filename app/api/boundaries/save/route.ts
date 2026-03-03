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

    // Try calling the update_clinic_geom RPC function
    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/update_clinic_geom`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_clinic_id: clinic_id,
        p_geojson: geometryJson
      })
    });

    if (rpcResponse.ok) {
      return NextResponse.json({ success: true, method: 'rpc' });
    }

    const rpcError = await rpcResponse.text();

    // If RPC doesn't exist, provide instructions
    if (rpcError.includes('function') || rpcError.includes('does not exist')) {
      return NextResponse.json({
        error: 'Database function not found. Please run the SQL script in scripts/create_update_boundary_function.sql via Supabase SQL Editor.',
        details: rpcError
      }, { status: 500 });
    }

    console.error('RPC error:', rpcError);
    return NextResponse.json({
      error: `Failed to save boundary: ${rpcError}`
    }, { status: 500 });

  } catch (error) {
    console.error('Save boundary error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save boundary' },
      { status: 500 }
    );
  }
}
