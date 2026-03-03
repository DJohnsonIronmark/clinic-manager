import type { WritableDataAdapter, SupabaseAdapterConfig, TableSchema, ColumnSchema, QueryOptions, UpdateOptions, InsertOptions, DeleteOptions } from '../types';

export function createSupabaseAdapter(config: SupabaseAdapterConfig): WritableDataAdapter {
  const { supabaseUrl, supabaseKey, allowedTables, columnDescriptions } = config;

  // Columns to exclude from schema sampling (large data)
  const excludeFromSample = ['raw_geojson', 'geojson', 'geom', 'geometry', 'polygon', 'boundaries'];

  async function supabaseRest<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${supabaseUrl}/rest/v1/${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase REST error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  return {
    async listTables(): Promise<string[]> {
      return allowedTables;
    },

    async describeTable(tableName: string): Promise<TableSchema | null> {
      if (!allowedTables.includes(tableName)) {
        return null;
      }

      try {
        // First, get column names by fetching just the keys (empty row trick won't work, so we fetch one row)
        // But we request only columns that are safe (small) - we'll need to know column names first
        // Try fetching with a very small limit and then checking the structure
        const headResponse = await fetch(
          `${supabaseUrl}/rest/v1/${tableName}?limit=0`,
          {
            method: 'HEAD',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        );

        // Get sample data but exclude large columns if we know them
        // For known tables, use predefined safe columns
        const knownSafeColumns: Record<string, string[]> = {
          'clinic_territories': ['clinic_id', 'clinic_name', 'state', 'city', 'metro_type', 'created_at', 'updated_at'],
          'TJC Locations GeoCoded': ['ClinicID', 'Name', 'Address', 'City', 'State', 'Zip', 'latitude', 'longitude'],
        };

        const safeColumns = knownSafeColumns[tableName];
        let samplePath = `${tableName}?limit=1`;
        if (safeColumns) {
          samplePath = `${tableName}?select=${safeColumns.join(',')}&limit=1`;
        }

        const sampleData = await supabaseRest<Record<string, unknown>[]>(samplePath);

        let columns: ColumnSchema[] = [];

        if (sampleData.length > 0) {
          columns = Object.entries(sampleData[0]).map(([name, value]) => ({
            name,
            type: inferType(value),
            description: columnDescriptions?.[tableName]?.[name],
          }));

          // Add known large columns as jsonb type without fetching their content
          if (tableName === 'clinic_territories') {
            columns.push(
              { name: 'raw_geojson', type: 'jsonb (large - geospatial data)', description: 'Raw GeoJSON territory boundaries' },
              { name: 'geojson', type: 'jsonb (large - geospatial data)', description: 'Processed GeoJSON geometry' },
              { name: 'geom', type: 'geometry (PostGIS)', description: 'PostGIS geometry column' }
            );
          }
        }

        return {
          name: tableName,
          columns,
        };
      } catch (error) {
        console.error(`Error describing table ${tableName}:`, error);
        return null;
      }
    },

    async queryTable(options: QueryOptions): Promise<unknown[]> {
      const { table, select, filter, orderBy, limit = 100, offset } = options;

      if (!allowedTables.includes(table)) {
        throw new Error(`Table "${table}" is not in the allowed tables list`);
      }

      // Known safe columns for each table (excludes large geospatial data)
      const knownSafeColumns: Record<string, string[]> = {
        'clinic_territories': ['clinic_id', 'clinic_name', 'state', 'city', 'metro_type', 'created_at', 'updated_at'],
        'TJC Locations GeoCoded': ['ClinicID', 'Name', 'Address', 'City', 'State', 'Zip', 'latitude', 'longitude'],
      };

      // Build query string
      const params = new URLSearchParams();

      // Select columns - exclude large columns by default unless explicitly requested
      if (select && select.length > 0) {
        params.set('select', select.join(','));
      } else if (knownSafeColumns[table]) {
        // Use known safe columns to avoid fetching large geospatial data
        params.set('select', knownSafeColumns[table].join(','));
      }

      // Apply filters
      if (filter) {
        for (const [key, value] of Object.entries(filter)) {
          if (typeof value === 'object' && value !== null) {
            // Handle operator objects like { gt: 10 }
            for (const [op, opValue] of Object.entries(value)) {
              const operator = mapOperator(op);
              params.append(key, `${operator}.${opValue}`);
            }
          } else {
            // Simple equality
            params.append(key, `eq.${value}`);
          }
        }
      }

      // Order by
      if (orderBy) {
        params.set('order', `${orderBy.column}.${orderBy.ascending !== false ? 'asc' : 'desc'}`);
      }

      // Pagination
      if (limit) {
        params.set('limit', String(limit));
      }
      if (offset) {
        params.set('offset', String(offset));
      }

      const queryString = params.toString();
      const path = queryString ? `${table}?${queryString}` : table;

      return supabaseRest<unknown[]>(path);
    },

    async updateRecord(options: UpdateOptions): Promise<unknown[]> {
      const { table, filter, data } = options;

      if (!allowedTables.includes(table)) {
        throw new Error(`Table "${table}" is not in the allowed tables list`);
      }

      // Build filter query string
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filter)) {
        params.append(key, `eq.${value}`);
      }

      const path = `${table}?${params.toString()}`;

      return supabaseRest<unknown[]>(path, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },

    async insertRecord(options: InsertOptions): Promise<unknown[]> {
      const { table, data } = options;

      if (!allowedTables.includes(table)) {
        throw new Error(`Table "${table}" is not in the allowed tables list`);
      }

      return supabaseRest<unknown[]>(table, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    async deleteRecord(options: DeleteOptions): Promise<unknown[]> {
      const { table, filter } = options;

      if (!allowedTables.includes(table)) {
        throw new Error(`Table "${table}" is not in the allowed tables list`);
      }

      // Build filter query string
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filter)) {
        params.append(key, `eq.${value}`);
      }

      const path = `${table}?${params.toString()}`;

      return supabaseRest<unknown[]>(path, {
        method: 'DELETE',
      });
    },
  };
}

function inferType(value: unknown): string {
  if (value === null) return 'unknown';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'timestamp';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return 'uuid';
    return 'text';
  }
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'jsonb';
  return 'unknown';
}

function mapOperator(op: string): string {
  const operators: Record<string, string> = {
    eq: 'eq',
    neq: 'neq',
    gt: 'gt',
    gte: 'gte',
    lt: 'lt',
    lte: 'lte',
    like: 'like',
    ilike: 'ilike',
    is: 'is',
    in: 'in',
    contains: 'cs',
    containedBy: 'cd',
  };
  return operators[op] || 'eq';
}
