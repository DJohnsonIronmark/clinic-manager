export interface Clinic {
  clinic_id: string;
  clinic_name: string;
  state?: string;
  city?: string;
  address?: string;
  latitude: number;
  longitude: number;
  raw_geojson?: string | GeoJSONFeature | GeoJSONFeatureCollection | GeoJSONGeometry;
  metro_type: string;
}

export interface GeoJSONGeometry {
  type: 'Point' | 'Polygon' | 'MultiPolygon' | 'LineString';
  coordinates: number[] | number[][] | number[][][] | number[][][][];
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry;
  properties?: Record<string, unknown>;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export interface OverlapAnalysis {
  state: string;
  total_overlaps: number;
  clinics_with_overlaps: number;
}

export interface ExclusionLocation {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radius: number;
  distance_unit: string;
  distance_miles?: number;
  estimated_drive_time_min?: number;
}

export interface FacebookTargeting {
  clinic_id: string;
  clinic_name: string;
  generated_at: string;
  geo_locations: {
    custom_locations: ExclusionLocation[];
  };
  excluded_geo_locations: {
    custom_locations: ExclusionLocation[];
  };
  territory_info: {
    center_latitude: number;
    center_longitude: number;
    territory_width_miles: number;
    territory_height_miles: number;
    territory_size_miles: number;
  };
  summary: {
    total_inclusions: number;
    total_exclusions: number;
    competing_clinics_excluded: number;
    boundary_exclusions: number;
    inclusion_radii_used: number[];
    exclusion_radii_used: number[];
    coverage_strategy: string;
  };
}
