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
