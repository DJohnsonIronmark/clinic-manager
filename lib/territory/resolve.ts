import type { SupabaseClient } from '@supabase/supabase-js';

// One row per cluster member from resolve_territory_cluster().
export interface ClusterRow {
  clinic_id: string;
  clinic_name: string | null;
  changed: boolean;
  area_before_sq_mi: number;
  area_after_sq_mi: number;
}

export interface ResolveOptions {
  seedIds?: string[];
  state?: string;
  minOverlapSqKm?: number;
}

// Runs the atomic cluster resolver. Throws on any error — callers must not
// treat a failed resolution as "created successfully".
export async function resolveTerritoryCluster(
  supabase: SupabaseClient,
  opts: ResolveOptions,
): Promise<ClusterRow[]> {
  if (!opts.seedIds?.length && !opts.state) {
    throw new Error('resolveTerritoryCluster: seedIds or state is required');
  }
  const { data, error } = await supabase.rpc('resolve_territory_cluster', {
    p_seed_ids: opts.seedIds?.length ? opts.seedIds : null,
    p_state: opts.state ?? null,
    p_min_overlap_sqkm: opts.minOverlapSqKm ?? 0.5,
  });
  if (error) throw new Error(`resolve_territory_cluster failed: ${error.message}`);
  return (data ?? []) as ClusterRow[];
}

export interface ClusterSummary {
  total: number;
  changed: ClusterRow[];
  unchanged: number;
  message: string;
}

export function summarizeCluster(rows: ClusterRow[]): ClusterSummary {
  const changed = rows.filter((r) => r.changed);
  const parts = changed.map(
    (r) => `${r.clinic_name ?? r.clinic_id} ${r.area_before_sq_mi}→${r.area_after_sq_mi} sq mi`,
  );
  const message =
    rows.length === 0
      ? 'No overlapping territories found.'
      : changed.length === 0
        ? `Checked ${rows.length} territories; no changes needed.`
        : `Resolved overlaps across ${rows.length} territories; ${changed.length} reshaped: ${parts.join('; ')}.`;
  return { total: rows.length, changed, unchanged: rows.length - changed.length, message };
}

// Which clinics need their Meta targeting regenerated after a resolution:
// every member whose geometry changed, plus the seed(s) themselves — a new
// clinic has no targeting yet even if its territory came through unchanged.
export function targetingRegenerationIds(rows: ClusterRow[], seedIds: string[] = []): string[] {
  const ids = new Set<string>(seedIds);
  for (const r of rows) if (r.changed) ids.add(r.clinic_id);
  return Array.from(ids);
}
