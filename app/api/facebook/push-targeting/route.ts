import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

const N8N_WEBHOOK_URL = process.env.N8N_PUSH_TARGETING_WEBHOOK_URL;

interface PushTargetingRequest {
  mode: 'single' | 'batch' | 'all';
  clinic_ids?: string[];
  dry_run?: boolean;
  account_ids?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: PushTargetingRequest = await request.json();

    // Validate input
    if (!body.mode || !['single', 'batch', 'all'].includes(body.mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "single", "batch", or "all".' },
        { status: 400 }
      );
    }

    if ((body.mode === 'single' || body.mode === 'batch') && (!body.clinic_ids || body.clinic_ids.length === 0)) {
      return NextResponse.json(
        { error: 'clinic_ids required for single/batch mode.' },
        { status: 400 }
      );
    }

    if (body.mode === 'single' && body.clinic_ids && body.clinic_ids.length !== 1) {
      return NextResponse.json(
        { error: 'Exactly one clinic_id required for single mode.' },
        { status: 400 }
      );
    }

    // Resolve clinic list
    let clinicIds: string[];

    if (body.mode === 'all') {
      const { data, error } = await supabase
        .from('clinic_territories')
        .select('clinic_id')
        .not('fb_geo_locations', 'is', null);

      if (error) {
        return NextResponse.json({ error: `Failed to fetch clinics: ${error.message}` }, { status: 500 });
      }
      clinicIds = (data || []).map(row => row.clinic_id);
    } else {
      clinicIds = body.clinic_ids!;
    }

    if (clinicIds.length === 0) {
      return NextResponse.json(
        { error: 'No clinics with targeting data found.' },
        { status: 400 }
      );
    }

    // Verify all clinics have targeting data (also pull state for SA naming)
    const { data: clinicsWithTargeting, error: verifyError } = await supabase
      .from('clinic_territories')
      .select('clinic_id, clinic_name, state, fb_geo_locations, fb_saved_audience_ids')
      .in('clinic_id', clinicIds)
      .not('fb_geo_locations', 'is', null);

    if (verifyError) {
      return NextResponse.json({ error: `Verification failed: ${verifyError.message}` }, { status: 500 });
    }

    const clinicsWithData = clinicsWithTargeting || [];
    const clinicIdsWithData = clinicsWithData.map(c => c.clinic_id);
    const skippedNoTargeting = clinicIds.filter(id => !clinicIdsWithData.includes(id));

    if (clinicsWithData.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'None of the selected clinics have targeting data. Generate targeting first using "Export FB Targeting".',
        skipped: skippedNoTargeting
      }, { status: 400 });
    }

    // Forward to n8n webhook
    if (!N8N_WEBHOOK_URL) {
      return NextResponse.json(
        { error: 'N8N_PUSH_TARGETING_WEBHOOK_URL not configured.' },
        { status: 500 }
      );
    }

    const NAME_TO_CODE: Record<string, string> = {
      Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',
      Connecticut:'CT',Delaware:'DE','District of Columbia':'DC',Florida:'FL',Georgia:'GA',
      Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',Kentucky:'KY',
      Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',
      Mississippi:'MS',Missouri:'MO',Montana:'MT',Nebraska:'NE',Nevada:'NV',
      'New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY',
      'North Carolina':'NC','North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',
      Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',
      Tennessee:'TN',Texas:'TX',Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA',
      'West Virginia':'WV',Wisconsin:'WI',Wyoming:'WY',
    };
    const toStateCode = (s: string | null | undefined): string => {
      if (!s) return '';
      if (s.length === 2) return s.toUpperCase();
      return NAME_TO_CODE[s] || s;
    };

    const n8nPayload = {
      mode: body.mode,
      clinic_ids: clinicIdsWithData,
      dry_run: body.dry_run || false,
      account_ids: body.account_ids,
      clinics: clinicsWithData.map(c => ({
        clinic_id: c.clinic_id,
        clinic_name: c.clinic_name,
        state_code: toStateCode((c as { state?: string }).state),
        fb_geo_locations: c.fb_geo_locations,
        fb_saved_audience_ids: c.fb_saved_audience_ids || {}
      }))
    };

    const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(n8nPayload),
    });

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text();
      console.error('n8n webhook error:', errorText);
      return NextResponse.json(
        { error: 'Failed to trigger targeting update workflow.', details: errorText },
        { status: 502 }
      );
    }

    const n8nResult = await n8nResponse.json();

    // Update push status in Supabase for successfully updated clinics
    const updatedClinicIds = (n8nResult.results || [])
      .filter((r: { status: string }) => r.status === 'updated')
      .map((r: { clinic_id: string }) => r.clinic_id);

    if (updatedClinicIds.length > 0) {
      await supabase
        .from('clinic_territories')
        .update({
          meta_last_targeting_push: new Date().toISOString(),
          meta_targeting_push_status: 'success'
        })
        .in('clinic_id', updatedClinicIds);
    }

    // Update error/skipped statuses
    const errorClinicIds = (n8nResult.results || [])
      .filter((r: { status: string }) => r.status === 'error')
      .map((r: { clinic_id: string }) => r.clinic_id);

    if (errorClinicIds.length > 0) {
      await supabase
        .from('clinic_territories')
        .update({ meta_targeting_push_status: 'error' })
        .in('clinic_id', errorClinicIds);
    }

    // Saved-audience dual-write outcomes (parallel branch in n8n).
    // Shape from n8n: saved_audience_results: [{ clinic_id, account_id, saved_audience_id, status, error? }]
    const savedAudienceResults: Array<{
      clinic_id: string;
      account_id: string;
      saved_audience_id?: string;
      status: 'updated' | 'error' | 'skipped';
      error?: string;
    }> = n8nResult.saved_audience_results || [];

    if (savedAudienceResults.length > 0) {
      const byClinic: Record<string, Record<string, { status: string; at: string; saved_audience_id?: string; error?: string }>> = {};
      const succeededClinics = new Set<string>();
      const now = new Date().toISOString();

      for (const r of savedAudienceResults) {
        if (!byClinic[r.clinic_id]) byClinic[r.clinic_id] = {};
        byClinic[r.clinic_id][r.account_id] = {
          status: r.status,
          at: now,
          saved_audience_id: r.saved_audience_id,
          ...(r.error ? { error: r.error } : {})
        };
        if (r.status === 'updated') succeededClinics.add(r.clinic_id);
      }

      await Promise.all(Object.entries(byClinic).map(([clinicId, perAccount]) =>
        supabase
          .from('clinic_territories')
          .update({
            meta_saved_audience_push_status: perAccount,
            ...(succeededClinics.has(clinicId) ? { meta_saved_audience_last_push: now } : {})
          })
          .eq('clinic_id', clinicId)
      ));
    }

    return NextResponse.json({
      success: true,
      mode: body.mode,
      dry_run: body.dry_run || false,
      ...n8nResult,
      skipped_no_targeting: skippedNoTargeting
    });

  } catch (error) {
    console.error('Push targeting error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
