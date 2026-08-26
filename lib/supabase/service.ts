import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role client for server routes that mutate clinic_territories.
//
// Resolves the standard env name first, then the legacy one. It deliberately
// does NOT fall through to the anon key: clinic_territories is RLS-locked with
// no anon policies, so an anon fallback "succeeds" while silently reading and
// writing nothing. Failing here is the loud, correct outcome.
export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase service credentials missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE (or SUPABASE_SERVICE_ROLE_KEY)',
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
