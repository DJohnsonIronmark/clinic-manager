-- resolve_territory_cluster: deterministic, atomic overlap resolution for a
-- cluster of clinics.
--
-- Replaces the per-state batch loop over resolve_overlaps_with_buffer. That
-- function selects candidates by ST_Intersects (edge-touching counts) ordered
-- by clinic_id, so in a state whose territories already abut it re-processes
-- the same few clinics every batch and never reaches a newly added one.
--
-- Cluster = seeds ∪ every clinic with a real (> p_min_overlap_sqkm) overlap
-- against a seed. Seeds are p_seed_ids (e.g. the clinic just added) or, with
-- p_state, every clinic in that state that has a real overlap.
--
-- Steps: rebuild the global Voronoi cells (a derived table that is stale after
-- any add), clip each cluster member to its cell, drop sliver fragments, and
-- verify every clinic still contains its own location. Any failure raises and
-- rolls back the whole cluster — a territory is never left half-resolved.
create or replace function public.resolve_territory_cluster(
  p_seed_ids text[] default null,
  p_state text default null,
  p_min_overlap_sqkm numeric default 0.5
)
returns table (
  clinic_id text,
  clinic_name text,
  changed boolean,
  area_before_sq_mi numeric,
  area_after_sq_mi numeric
)
language plpgsql
set search_path = public, extensions
set statement_timeout = '180s'
as $$
declare
  v_state   text;
  v_seeds   text[];
  v_cluster text[];
  v_missing text[];
  v_cleaned geometry;
  r record;
begin
  if p_seed_ids is null and p_state is null then
    raise exception 'resolve_territory_cluster: p_seed_ids or p_state is required';
  end if;

  -- clinic_territories.state holds full names ("Arizona"); the locations table
  -- holds codes ("AZ"). Accept either.
  if p_state is not null then
    select coalesce(
      (select ct.state from clinic_territories ct
         where upper(ct.state) = upper(p_state) limit 1),
      (select ct.state from clinic_territories ct
         join "TJC Locations GeoCoded" l on l."ClinicID"::text = ct.clinic_id
         where upper(l."State") = upper(p_state) limit 1),
      p_state)
    into v_state;
  end if;

  if p_seed_ids is not null then
    v_seeds := p_seed_ids;
  else
    select array_agg(distinct a.clinic_id) into v_seeds
    from clinic_territories a
    join clinic_territories b
      on b.clinic_id <> a.clinic_id
     and b.geom is not null
     and a.geom::geometry && b.geom::geometry
    where a.state = v_state
      and a.geom is not null
      and ST_Area(ST_Intersection(a.geom::geometry, b.geom::geometry)::geography) / 1e6
          > p_min_overlap_sqkm;
  end if;

  if v_seeds is null or cardinality(v_seeds) = 0 then
    return;
  end if;

  -- Expand one hop: anyone with a real overlap against a seed. Clipping to
  -- global Voronoi cells cannot create new overlaps, so one hop is sufficient
  -- to clear everything the seeds are involved in.
  select array_agg(distinct c.cid) into v_cluster
  from (
    select unnest(v_seeds) as cid
    union
    select o.clinic_id
    from clinic_territories s
    join clinic_territories o
      on o.clinic_id <> s.clinic_id
     and o.geom is not null
     and s.geom::geometry && o.geom::geometry
    where s.clinic_id = any(v_seeds)
      and s.geom is not null
      and ST_Area(ST_Intersection(s.geom::geometry, o.geom::geometry)::geography) / 1e6
          > p_min_overlap_sqkm
  ) c;

  -- Every member needs a location row: the Voronoi cell is computed from it,
  -- and a clinic with no cell is silently skipped by the clip.
  select array_agg(ct.clinic_id) into v_missing
  from clinic_territories ct
  left join "TJC Locations GeoCoded" l
    on l."ClinicID"::text = ct.clinic_id
   and l.latitude is not null and l.longitude is not null
   and not (l.latitude = 0 and l.longitude = 0)
  where ct.clinic_id = any(v_cluster) and l."ClinicID" is null;
  if v_missing is not null then
    raise exception 'resolve_territory_cluster: no geocoded location for clinic(s) %', v_missing;
  end if;

  drop table if exists _rtc_before;
  create temp table _rtc_before on commit drop as
    select ct.clinic_id, ct.geom
    from clinic_territories ct
    where ct.clinic_id = any(v_cluster);

  perform rebuild_voronoi_cells();

  select array_agg(x) into v_missing
  from unnest(v_cluster) x
  where not exists (select 1 from clinic_voronoi_cells v where v.clinic_id = x);
  if v_missing is not null then
    raise exception 'resolve_territory_cluster: no Voronoi cell for clinic(s) % (duplicate coordinates?)', v_missing;
  end if;

  perform apply_global_voronoi_chunk(v_cluster);

  -- Sliver cleanup + containment guard, per member.
  for r in
    select ct.clinic_id,
           ct.geom::geometry as g,
           ST_SetSRID(ST_MakePoint(l.longitude, l.latitude), 4326) as pt
    from clinic_territories ct
    join "TJC Locations GeoCoded" l on l."ClinicID"::text = ct.clinic_id
    where ct.clinic_id = any(v_cluster)
  loop
    if ST_NumGeometries(r.g) > 1 then
      select ST_Multi(ST_Union(p.part)) into v_cleaned
      from (select (ST_Dump(r.g)).geom as part) p
      where ST_Area(p.part::geography) > 100000;  -- 0.1 km²
      if v_cleaned is not null
         and not ST_IsEmpty(v_cleaned)
         and ST_Contains(v_cleaned, r.pt) then
        update clinic_territories ct
           set geom = v_cleaned::geography
         where ct.clinic_id = r.clinic_id;
      end if;
    end if;

    if not exists (
      select 1 from clinic_territories ct
      where ct.clinic_id = r.clinic_id
        and ST_Contains(ct.geom::geometry, r.pt)
    ) then
      raise exception 'resolve_territory_cluster: clinic % would fall outside its own territory; rolled back', r.clinic_id;
    end if;
  end loop;

  return query
    select ct.clinic_id,
           ct.clinic_name,
           not ST_Equals(ct.geom::geometry, b.geom::geometry) as changed,
           round((ST_Area(b.geom) / 2589988.11)::numeric, 2)  as area_before_sq_mi,
           round((ST_Area(ct.geom) / 2589988.11)::numeric, 2) as area_after_sq_mi
    from clinic_territories ct
    join _rtc_before b on b.clinic_id = ct.clinic_id
    order by ct.clinic_name;
end;
$$;

revoke all on function public.resolve_territory_cluster(text[], text, numeric) from public, anon, authenticated;
grant execute on function public.resolve_territory_cluster(text[], text, numeric) to service_role;
