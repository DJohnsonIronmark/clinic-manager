import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, getServiceKey } from '@/lib/supabase/service';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = getServiceKey();

const supabase = getServiceClient();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clinic_ids, state, apply_voronoi = true } = body;

    if (!clinic_ids && !state) {
      return NextResponse.json(
        { error: 'Must provide clinic_ids array or state' },
        { status: 400 }
      );
    }

    // Build the list of clinic IDs to rebuild
    let targetClinicIds: string[] = clinic_ids || [];

    if (state && !clinic_ids) {
      const { data: stateClinics, error: stateError } = await supabase
        .from('clinic_territories')
        .select('clinic_id')
        .eq('state', state);

      if (stateError) {
        return NextResponse.json({ error: stateError.message }, { status: 500 });
      }
      targetClinicIds = (stateClinics || []).map(c => c.clinic_id);
    }

    if (targetClinicIds.length === 0) {
      return NextResponse.json({ error: 'No clinics found to rebuild' }, { status: 400 });
    }

    console.log(`Rebuilding territories for ${targetClinicIds.length} clinics:`, targetClinicIds);

    const resetResults: Array<{
      clinic_id: string;
      clinic_name?: string;
      status: string;
      area_before?: number;
      area_after?: number;
      isochrone_used?: string;
    }> = [];

    // Step 1: Reset each clinic to its appropriate isochrone
    for (const clinicId of targetClinicIds) {
      try {
        const { data: clinic, error: clinicError } = await supabase
          .from('clinic_territories')
          .select('clinic_id, clinic_name, metro_type, raw_geojson, geojson')
          .eq('clinic_id', clinicId)
          .single();

        if (clinicError || !clinic) {
          resetResults.push({ clinic_id: clinicId, status: `Error: ${clinicError?.message || 'Not found'}` });
          continue;
        }

        if (!clinic.raw_geojson) {
          resetResults.push({ clinic_id: clinicId, clinic_name: clinic.clinic_name, status: 'Skipped: No raw_geojson' });
          continue;
        }

        const rawGeojson = typeof clinic.raw_geojson === 'string'
          ? JSON.parse(clinic.raw_geojson)
          : clinic.raw_geojson;

        if (rawGeojson.type !== 'FeatureCollection' || !rawGeojson.features?.length) {
          resetResults.push({ clinic_id: clinicId, clinic_name: clinic.clinic_name, status: 'Error: Invalid raw_geojson' });
          continue;
        }

        // Select isochrone based on metro_type: [30min, 20min, 15min, 10min]
        const metroType = (clinic.metro_type || 'suburban').toLowerCase();
        let isochroneIndex: number;
        let isochroneLabel: string;

        if (metroType === 'urban') {
          isochroneIndex = 2;
          isochroneLabel = '15-min';
        } else if (metroType === 'rural') {
          isochroneIndex = 0;
          isochroneLabel = '30-min';
        } else {
          isochroneIndex = 1;
          isochroneLabel = '20-min';
        }

        const isochroneFeature = rawGeojson.features[isochroneIndex];
        if (!isochroneFeature?.geometry) {
          resetResults.push({
            clinic_id: clinicId,
            clinic_name: clinic.clinic_name,
            status: `Error: Isochrone ${isochroneLabel} not available`
          });
          continue;
        }

        const newGeometry = isochroneFeature.geometry;
        const areaBefore = calculateApproxArea(clinic.geojson);

        // Update using the existing RPC function (update_clinic_geom)
        const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/update_clinic_geom`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_clinic_id: clinicId,
            p_geojson: JSON.stringify(newGeometry)
          })
        });

        if (!rpcResponse.ok) {
          // Fallback: update geojson column only
          const { error: fallbackError } = await supabase
            .from('clinic_territories')
            .update({ geojson: newGeometry })
            .eq('clinic_id', clinicId);

          if (fallbackError) {
            resetResults.push({
              clinic_id: clinicId,
              clinic_name: clinic.clinic_name,
              status: `Error: ${fallbackError.message}`
            });
            continue;
          }
        }

        const areaAfter = calculateApproxArea(newGeometry);
        resetResults.push({
          clinic_id: clinicId,
          clinic_name: clinic.clinic_name,
          status: 'Reset to isochrone',
          isochrone_used: isochroneLabel,
          area_before: Math.round(areaBefore * 10) / 10,
          area_after: Math.round(areaAfter * 10) / 10
        });

      } catch (err) {
        resetResults.push({ clinic_id: clinicId, status: `Error: ${(err as Error).message}` });
      }
    }

    // Step 2: Apply Voronoi resolution if requested
    let voronoiStatus = 'skipped';

    if (apply_voronoi) {
      const affectedState = state || (await getClinicState(targetClinicIds[0]));

      if (affectedState) {
        console.log(`Applying Voronoi resolution for state: ${affectedState}`);

        // Use resolve_overlaps_with_buffer for 2-mile guaranteed containment
        // Falls back to resolve_overlaps_by_distance_batch if buffer version unavailable
        let overlapData;
        let overlapError;

        const bufferResult = await supabase.rpc(
          'resolve_overlaps_with_buffer',
          { p_state: affectedState, p_batch_size: 50, p_buffer_miles: 2.0 }
        );

        if (bufferResult.error?.message?.includes('does not exist')) {
          // Fallback to original function
          const fallback = await supabase.rpc(
            'resolve_overlaps_by_distance_batch',
            { p_state: affectedState, p_batch_size: 50 }
          );
          overlapData = fallback.data;
          overlapError = fallback.error;
        } else {
          overlapData = bufferResult.data;
          overlapError = bufferResult.error;
        }

        if (overlapError) {
          console.warn('Voronoi resolution error:', overlapError.message);
          voronoiStatus = `error: ${overlapError.message}`;
        } else {
          const resolvedCount = Array.isArray(overlapData)
            ? overlapData.filter((r: [string, boolean, string]) => r[1] === true).length
            : 0;
          voronoiStatus = `resolved ${resolvedCount} overlaps`;
        }
      }
    }

    // Step 3: Sync geojson from geom for all affected clinics
    const { error: syncError } = await supabase.rpc('sync_geojson_from_geom', {
      p_clinic_ids: targetClinicIds
    });

    if (syncError) {
      console.warn('Sync geojson error (non-fatal):', syncError.message);
    }

    // Step 4: Get final areas
    const { data: finalAreas } = await supabase
      .from('clinic_territories')
      .select('clinic_id, clinic_name, geojson')
      .in('clinic_id', targetClinicIds);

    const finalResults = (finalAreas || []).map(c => ({
      clinic_id: c.clinic_id,
      clinic_name: c.clinic_name,
      final_area_sq_mi: Math.round(calculateApproxArea(c.geojson) * 10) / 10
    })).sort((a, b) => a.final_area_sq_mi - b.final_area_sq_mi);

    return NextResponse.json({
      success: true,
      message: `Rebuilt ${targetClinicIds.length} territories`,
      voronoi_status: voronoiStatus,
      reset_results: resetResults,
      final_areas: finalResults
    });

  } catch (error) {
    console.error('Territory rebuild error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

function calculateApproxArea(geojson: unknown): number {
  if (!geojson || typeof geojson !== 'object') return 0;

  const geom = geojson as { type?: string; coordinates?: number[][][] | number[][][][] };

  const calculatePolygonArea = (coords: number[][]): number => {
    const n = coords.length;
    if (n < 3) return 0;

    const avgLat = coords.reduce((sum, c) => sum + c[1], 0) / n;
    const lngScale = Math.cos(avgLat * Math.PI / 180) * 69;
    const latScale = 69;

    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += coords[i][0] * lngScale * coords[j][1] * latScale;
      area -= coords[j][0] * lngScale * coords[i][1] * latScale;
    }
    return Math.abs(area) / 2;
  };

  if (geom.type === 'MultiPolygon' && geom.coordinates) {
    return (geom.coordinates as number[][][][]).reduce((total, poly) => {
      return total + (poly[0] ? calculatePolygonArea(poly[0]) : 0);
    }, 0);
  } else if (geom.type === 'Polygon' && geom.coordinates) {
    return calculatePolygonArea((geom.coordinates as number[][][])[0] || []);
  }
  return 0;
}

async function getClinicState(clinicId: string): Promise<string | null> {
  const { data } = await supabase
    .from('clinic_territories')
    .select('state')
    .eq('clinic_id', clinicId)
    .single();
  return data?.state || null;
}
