-- Create a function to update clinic boundary from GeoJSON
-- Run this in Supabase SQL Editor or via MCP

CREATE OR REPLACE FUNCTION update_clinic_geom(
  p_clinic_id TEXT,
  p_geojson TEXT
)
RETURNS VOID AS $$
BEGIN
  UPDATE clinic_territories
  SET geom = ST_SetSRID(ST_GeomFromGeoJSON(p_geojson), 4326)
  WHERE clinic_id = p_clinic_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users and anon
GRANT EXECUTE ON FUNCTION update_clinic_geom(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_clinic_geom(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION update_clinic_geom(TEXT, TEXT) TO service_role;
