import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase/service';
import { resolveTerritoryCluster, summarizeCluster, targetingRegenerationIds } from '@/lib/territory/resolve';
import { regenerateFbTargeting } from '@/lib/fb-targeting/regenerate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Resolves every real overlap in a state (or for explicit clinic ids) in one
// atomic call, then regenerates Meta targeting for the clinics whose territory
// changed. Replaces the client-side batch loop over
// resolve_overlaps_with_buffer, which re-processed the same abutting clinics
// every batch and never converged.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const state = typeof body.state === 'string' && body.state.trim() ? body.state.trim().slice(0, 64) : null;
    const clinicIds: string[] = Array.isArray(body.clinic_ids)
      ? body.clinic_ids.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 200)
      : [];
    const regenerateTargeting = body.regenerate_targeting !== false;

    if (!state && clinicIds.length === 0) {
      return NextResponse.json({ error: 'state or clinic_ids required' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const cluster = await resolveTerritoryCluster(supabase, clinicIds.length ? { seedIds: clinicIds } : { state: state! });
    const summary = summarizeCluster(cluster);

    const targeting = regenerateTargeting
      ? await regenerateFbTargeting(supabase, targetingRegenerationIds(cluster))
      : [];

    return NextResponse.json({
      success: true,
      message: summary.message,
      total: summary.total,
      changed: summary.changed.length,
      cluster,
      targeting,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Resolve failed', details: message }, { status: 502 });
  }
}
