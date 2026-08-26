-- territory_buffer_geojson: a clinic's territory polygon expanded by a
-- geodesic buffer, as GeoJSON. Used by the TikTok ZIP export to ask the Census
-- TIGERweb ZCTA service for every ZIP whose boundary touches the territory or
-- the ring around it. Buffering is done here (geography, metres) so the ring
-- is a true distance, not a degrees approximation.
create or replace function public.territory_buffer_geojson(
  p_clinic_id text,
  p_buffer_miles numeric default 5
)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'clinic_id',       ct.clinic_id,
    'clinic_name',     ct.clinic_name,
    'state',           ct.state,
    'buffer_miles',    p_buffer_miles,
    'territory_sq_mi', round((ST_Area(ct.geom) / 2589988.11)::numeric, 1),
    'buffered_sq_mi',  round((ST_Area(ST_Buffer(ct.geom, p_buffer_miles * 1609.344)) / 2589988.11)::numeric, 1),
    'geometry',        ST_AsGeoJSON(
                         ST_SimplifyPreserveTopology(
                           ST_Buffer(ct.geom, p_buffer_miles * 1609.344)::geometry, 0.0002),
                         6)::jsonb
  )
  from clinic_territories ct
  where ct.clinic_id = p_clinic_id and ct.geom is not null;
$$;

revoke all on function public.territory_buffer_geojson(text, numeric) from public, anon, authenticated;
grant execute on function public.territory_buffer_geojson(text, numeric) to service_role;
