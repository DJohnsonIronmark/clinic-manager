import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role credentials for server routes.
//
// clinic_territories and "TJC Locations GeoCoded" are RLS-locked with no anon
// or authenticated policies, so every server-side read or write of them must
// run under the service role. Resolves the standard env name first, then the
// legacy one, and deliberately does NOT fall through to a public key: that
// fallback "succeeds" while silently reading and writing nothing — which is
// how the clinic list came back empty in production on 2026-08-27.
export function getServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'Supabase service credentials missing: set SUPABASE_SERVICE_ROLE (or SUPABASE_SERVICE_ROLE_KEY)',
    );
  }
  return key;
}

export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  return createClient(url, getServiceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}
