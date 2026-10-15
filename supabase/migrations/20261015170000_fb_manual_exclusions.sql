-- Durable per-clinic Meta exclusions that the geometry-based FB export can't derive
-- (airports, hotel clusters, data centers). Appended to every "Export FB Targeting"
-- run so re-exporting a clinic no longer drops them.
-- Shape: [{ "name": text, "address": text, "latitude": num, "longitude": num,
--           "radius": int (miles, >= 1), "reason": text }]
ALTER TABLE public.clinic_territories
  ADD COLUMN IF NOT EXISTS fb_manual_exclusions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.clinic_territories.fb_manual_exclusions IS
  'Manual Meta exclusion circles (miles) appended to the FB targeting export; see ClinicTerritoryManager exportFacebookTargeting.';
