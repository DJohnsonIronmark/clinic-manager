# Clinic Territory Manager

Next.js application for managing TJC clinic territories, drive-time isochrones, and Meta targeting exports.

## Quick Start

```bash
cd /Users/drewjohnson/clinic-manager
npm run dev
```

**Deployed**: https://clinic-manager-three.vercel.app

## Supabase MCP Connection

Direct database access via MCP for running SQL queries without timeouts.

**Setup** (one-time):
```bash
claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?project_ref=xhyttombqrhqvnycyzlj"
npx supabase login
# Restart Claude Code
```

## Database

- **Project**: https://xhyttombqrhqvnycyzlj.supabase.co
- **Tables**:
  - `clinic_territories` - Territory polygons, metro_type, geom columns
  - `TJC Locations GeoCoded` - Clinic addresses and coordinates

## Key Files

| File | Purpose |
|------|---------|
| `components/ClinicTerritoryManager.tsx` | Main map component, territory editing, FB export |
| `app/api/clinics/route.ts` | Clinic data API with pagination |
| `app/api/boundaries/route.ts` | Territory boundary API |
| `lib/geo-utils.ts` | Geometry helpers, distance calculations |
| `scripts/sync_geom_metro_aware.sql` | SQL to sync PostGIS geom by metro_type |

## Territory Isochrone Logic

Each clinic's `raw_geojson` contains 4 drive-time isochrones:
- Index 0: 30-min (largest)
- Index 1: 20-min
- Index 2: 15-min
- Index 3: 10-min (smallest)

**Selection by metro_type**:
- Urban → 15-min (index 2)
- Suburban → 20-min (index 1)
- Rural → 30-min (index 0)

## Common Tasks

### Export FB Targeting
1. Select clinic on map
2. Click "Export FB Targeting"
3. Downloads text file with include/exclude locations

### Resolve Overlaps
1. Click "Manage Overlaps"
2. Select state (or all)
3. Analyze → Resolve

### Sync PostGIS geom columns
Run via MCP or Supabase SQL Editor:
```sql
-- See scripts/sync_geom_metro_aware.sql for full script
```

## Adding a New Clinic with Proper Territory

When a clinic is missing or showing incorrect territory (e.g., off the coast of Africa at 0,0), follow this procedure:

### Step 1: Generate Mapbox Isochrones via API
```bash
# Call the add clinic API (generates proper drive-time isochrones)
curl -X POST "https://clinic-manager-three.vercel.app/api/clinics/add" \
  -H "Content-Type: application/json" \
  -d '{
    "clinic_name": "Clinic Name",
    "clinic_id": "12345",
    "address": "123 Main St, City, ST 12345",
    "resolve_overlaps": true
  }'
```

If clinic already exists, delete from `clinic_territories` first (keep `TJC Locations GeoCoded` entry), then re-add.

### Step 2: Apply Voronoi Overlap Resolution
The API's `resolve_overlaps` only subtracts existing territories. For proper Voronoi partitioning (each clinic gets area closest to it), run:

```sql
-- Get list of neighboring clinic IDs that overlap with the new clinic
SELECT b.clinic_id, b.clinic_name
FROM clinic_territories a
JOIN clinic_territories b ON ST_Intersects(a.geom::geometry, b.geom::geometry)
WHERE a.clinic_id = 'NEW_CLINIC_ID' AND b.clinic_id != 'NEW_CLINIC_ID';

-- Apply Voronoi to ALL overlapping clinics (replace IDs with actual neighbors)
WITH clinic_points AS (
  SELECT
    t.clinic_id,
    ST_SetSRID(ST_MakePoint(l.longitude, l.latitude), 4326) as point
  FROM clinic_territories t
  JOIN "TJC Locations GeoCoded" l ON t.clinic_id = l."ClinicID"::text
  WHERE t.clinic_id IN ('NEW_CLINIC_ID', 'NEIGHBOR1', 'NEIGHBOR2', 'NEIGHBOR3')
),
collected AS (
  SELECT ST_Collect(point) as points FROM clinic_points
),
voronoi_cells AS (
  SELECT (ST_Dump(
    ST_VoronoiPolygons(points, 0.0, ST_Expand(ST_Envelope(points), 0.5))
  )).geom as cell
  FROM collected
),
clinic_voronoi AS (
  SELECT cp.clinic_id, vc.cell as voronoi_cell
  FROM clinic_points cp, voronoi_cells vc
  WHERE ST_Contains(vc.cell, cp.point)
)
UPDATE clinic_territories ct
SET geom = ST_Multi(ST_Intersection(ct.geom::geometry, cv.voronoi_cell))::geography
FROM clinic_voronoi cv
WHERE ct.clinic_id = cv.clinic_id
  AND ct.clinic_id IN ('NEW_CLINIC_ID', 'NEIGHBOR1', 'NEIGHBOR2', 'NEIGHBOR3');
```

### Step 3: Restore FB Geo Locations (if needed)
If the clinic had existing `fb_geo_locations` targeting data, restore it:
```sql
UPDATE clinic_territories
SET fb_geo_locations = '{ ... saved JSON ... }'::jsonb
WHERE clinic_id = 'NEW_CLINIC_ID';
```

### Step 4: Redeploy
```bash
cd /Users/drewjohnson/clinic-manager
vercel --prod --force
```

### Key Tables
| Table | Purpose |
|-------|---------|
| `clinic_territories` | Territory polygons (`geom`), isochrones (`raw_geojson`), FB targeting (`fb_geo_locations`) |
| `TJC Locations GeoCoded` | Clinic addresses, lat/lng for search and Voronoi points |

### Common Issues
- **Clinic at 0,0 (Africa)**: Missing or NULL geometry - regenerate via API
- **Territory wraps around neighbors**: Used subtraction instead of Voronoi - apply Voronoi SQL
- **Circular buffer instead of isochrone**: Missing Mapbox isochrones - regenerate via API
- **Search not finding clinic**: Missing from `TJC Locations GeoCoded` - API adds it automatically
