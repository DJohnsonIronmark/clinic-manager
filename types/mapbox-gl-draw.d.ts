declare module '@mapbox/mapbox-gl-draw' {
  import { IControl } from 'mapbox-gl';

  interface DrawOptions {
    displayControlsDefault?: boolean;
    controls?: {
      point?: boolean;
      line_string?: boolean;
      polygon?: boolean;
      trash?: boolean;
      combine_features?: boolean;
      uncombine_features?: boolean;
    };
    defaultMode?: string;
    modes?: Record<string, unknown>;
  }

  interface DrawFeatureCollection {
    type: 'FeatureCollection';
    features: GeoJSON.Feature[];
  }

  class MapboxDraw implements IControl {
    constructor(options?: DrawOptions);
    onAdd(map: mapboxgl.Map): HTMLElement;
    onRemove(map: mapboxgl.Map): void;
    add(geojson: GeoJSON.Feature | GeoJSON.FeatureCollection): string[];
    get(featureId: string): GeoJSON.Feature | undefined;
    getAll(): DrawFeatureCollection;
    delete(ids: string | string[]): this;
    deleteAll(): this;
    set(featureCollection: GeoJSON.FeatureCollection): string[];
    trash(): this;
    combineFeatures(): this;
    uncombineFeatures(): this;
    getMode(): string;
    changeMode(mode: string, options?: Record<string, unknown>): this;
    setFeatureProperty(featureId: string, property: string, value: unknown): this;
  }

  export default MapboxDraw;
}
