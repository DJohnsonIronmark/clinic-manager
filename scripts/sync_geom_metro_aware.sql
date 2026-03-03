-- Sync PostGIS geom columns based on metro_type
-- Urban: 15-min isochrone (index 2)
-- Suburban: 20-min isochrone (index 1)
-- Rural: 30-min isochrone (index 0)
--
-- NOTE: Run these queries one at a time to avoid timeouts

-- ============================================================
-- STEP 1: Create helper function
-- ============================================================
CREATE OR REPLACE FUNCTION get_metro_feature_index(metro_type TEXT)
RETURNS INT AS $$
BEGIN
  CASE LOWER(COALESCE(metro_type, 'suburban'))
    WHEN 'urban' THEN RETURN 2;    -- 15-min isochrone
    WHEN 'rural' THEN RETURN 0;    -- 30-min isochrone
    ELSE RETURN 1;                  -- 20-min isochrone (suburban/default)
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- STEP 2: Update urban clinics (geom is geography type)
-- ============================================================
UPDATE clinic_territories ct
SET geom = ST_SetSRID(
  ST_GeomFromGeoJSON(
    (raw_geojson::json->'features'->2->'geometry')::text
  ), 4326)::geography
WHERE metro_type = 'urban'
  AND raw_geojson IS NOT NULL;

-- ============================================================
-- STEP 3: Update suburban clinics (first batch - clinic_id < '50000')
-- ============================================================
UPDATE clinic_territories ct
SET geom = ST_SetSRID(
  ST_GeomFromGeoJSON(
    (raw_geojson::json->'features'->1->'geometry')::text
  ), 4326)::geography
WHERE metro_type = 'suburban'
  AND raw_geojson IS NOT NULL
  AND clinic_id < '50000';

-- ============================================================
-- STEP 4: Update suburban clinics (second batch - clinic_id >= '50000')
-- ============================================================
UPDATE clinic_territories ct
SET geom = ST_SetSRID(
  ST_GeomFromGeoJSON(
    (raw_geojson::json->'features'->1->'geometry')::text
  ), 4326)::geography
WHERE metro_type = 'suburban'
  AND raw_geojson IS NOT NULL
  AND clinic_id >= '50000';

-- ============================================================
-- STEP 5: Update rural clinics
-- ============================================================
UPDATE clinic_territories ct
SET geom = ST_SetSRID(
  ST_GeomFromGeoJSON(
    (raw_geojson::json->'features'->0->'geometry')::text
  ), 4326)::geography
WHERE metro_type = 'rural'
  AND raw_geojson IS NOT NULL;

-- ============================================================
-- STEP 6: Update geom_3857 (Web Mercator) - cast geography to geometry first
-- ============================================================
UPDATE clinic_territories
SET geom_3857 = ST_Transform(geom::geometry, 3857)
WHERE geom IS NOT NULL;

-- ============================================================
-- STEP 7: Verify counts
-- ============================================================
SELECT
  metro_type,
  COUNT(*) as total,
  COUNT(geom) as with_geom,
  COUNT(geom_3857) as with_geom_3857
FROM clinic_territories
GROUP BY metro_type
ORDER BY metro_type;
