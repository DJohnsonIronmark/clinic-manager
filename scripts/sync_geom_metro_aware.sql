-- Sync PostGIS geom columns based on metro_type
-- Urban    → 15-min contour
-- Suburban → 20-min contour
-- Rural    → 30-min contour (falls back to 20-min if not present in raw_geojson)
--
-- raw_geojson is stored as an escaped JSON string in jsonb; #>> '{}' unwraps it.
-- Features are selected by their properties.contour value (NOT by array index),
-- so this works for BOTH cohorts in the database:
--   - Legacy clinics (528): feature contours [20, 15, 10, 5]   — no 30-min ring
--   - New clinics    (453): feature contours [30, 20, 15, 10]
--
-- Rural classification on legacy clinics will fall back to 20-min (same as
-- suburban) until those clinics are regenerated via /api/clinics/add.
--
-- NOTE: Run STEPs 2-5 one at a time to avoid statement timeouts.

-- ============================================================
-- STEP 1: Helper — return MultiPolygon geography for a contour minutes value
-- ============================================================
CREATE OR REPLACE FUNCTION get_ring_geometry(raw_geojson JSONB, contour_minutes INT)
RETURNS GEOGRAPHY AS $$
DECLARE
  feat JSONB;
  parsed JSONB;
BEGIN
  IF raw_geojson IS NULL THEN
    RETURN NULL;
  END IF;
  parsed := (raw_geojson #>> '{}')::jsonb;
  SELECT f INTO feat
  FROM jsonb_array_elements(parsed->'features') f
  WHERE (f->'properties'->>'contour')::int = contour_minutes
  LIMIT 1;
  IF feat IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN ST_SetSRID(
    ST_Multi(ST_GeomFromGeoJSON((feat->'geometry')::text)),
    4326
  )::geography;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- STEP 2: Urban → 15-min ring
-- ============================================================
UPDATE clinic_territories
SET geom = get_ring_geometry(raw_geojson, 15)
WHERE metro_type = 'urban'
  AND raw_geojson IS NOT NULL
  AND get_ring_geometry(raw_geojson, 15) IS NOT NULL;

-- ============================================================
-- STEP 3: Suburban → 20-min ring
-- ============================================================
UPDATE clinic_territories
SET geom = get_ring_geometry(raw_geojson, 20)
WHERE metro_type = 'suburban'
  AND raw_geojson IS NOT NULL
  AND get_ring_geometry(raw_geojson, 20) IS NOT NULL;

-- ============================================================
-- STEP 4: Rural → 30-min ring (fall back to 20-min if 30 missing)
-- ============================================================
UPDATE clinic_territories
SET geom = COALESCE(
  get_ring_geometry(raw_geojson, 30),
  get_ring_geometry(raw_geojson, 20)
)
WHERE metro_type = 'rural'
  AND raw_geojson IS NOT NULL
  AND COALESCE(get_ring_geometry(raw_geojson, 30), get_ring_geometry(raw_geojson, 20)) IS NOT NULL;

-- ============================================================
-- STEP 5: Sync geom_3857 (Web Mercator) from geom
-- ============================================================
UPDATE clinic_territories
SET geom_3857 = ST_Transform(geom::geometry, 3857)
WHERE geom IS NOT NULL;

-- ============================================================
-- STEP 6: Verify
-- ============================================================
-- Coverage counts by metro_type
SELECT metro_type,
  COUNT(*) AS total,
  COUNT(geom) AS with_geom,
  COUNT(geom_3857) AS with_geom_3857
FROM clinic_territories
GROUP BY metro_type
ORDER BY metro_type;

-- Rural clinics that fell back to 20-min (no 30-min ring in raw_geojson)
-- → these are candidates for ring regeneration via /api/clinics/add
SELECT clinic_id, clinic_name, state, city
FROM clinic_territories
WHERE metro_type = 'rural'
  AND raw_geojson IS NOT NULL
  AND get_ring_geometry(raw_geojson, 30) IS NULL
ORDER BY state, clinic_name;
