'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

import { generateColor, calculateDistance, isPointInPolygon, estimateDriveTime, selectRadii, parseJSON } from '@/lib/geo-utils';
import type { Clinic, OverlapAnalysis, GeoJSONFeature, GeoJSONFeatureCollection, GeoJSONGeometry } from '@/lib/types';

// Icons
const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8"></circle>
    <path d="m21 21-4.35-4.35"></path>
  </svg>
);

const MapPinIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
    <circle cx="12" cy="10" r="3"></circle>
  </svg>
);

const AlertIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="8" x2="12" y2="12"></line>
    <line x1="12" y1="16" x2="12.01" y2="16"></line>
  </svg>
);

const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
  </svg>
);

const SaveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
    <polyline points="17 21 17 13 7 13 7 21"></polyline>
    <polyline points="7 3 7 8 15 8"></polyline>
  </svg>
);

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
  </svg>
);

const XIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

export default function ClinicTerritoryManager() {
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinic, setSelectedClinic] = useState<Clinic | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [showOverlapPanel, setShowOverlapPanel] = useState(false);
  const [overlapAnalysis, setOverlapAnalysis] = useState<OverlapAnalysis | null>(null);
  const [selectedState, setSelectedState] = useState('');
  const [states, setStates] = useState<string[]>([]);

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const draw = useRef<MapboxDraw | null>(null);

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

  const getGeometry = useCallback((clinic: Clinic): GeoJSONGeometry | null => {
    const raw = parseJSON<GeoJSONFeature | GeoJSONFeatureCollection | GeoJSONGeometry>(clinic.raw_geojson as string);
    if (!raw) return null;

    if ('type' in raw) {
      if (raw.type === 'FeatureCollection' && 'features' in raw && raw.features?.length) {
        return raw.features[raw.features.length - 1]?.geometry || null;
      }
      if (raw.type === 'Feature' && 'geometry' in raw) {
        return raw.geometry;
      }
      if ('coordinates' in raw) {
        return raw as GeoJSONGeometry;
      }
    }
    return null;
  }, []);

  const displayAllClinics = useCallback((clinicsData: Clinic[]) => {
    if (!map.current) return;

    if (!map.current.isStyleLoaded()) {
      setTimeout(() => displayAllClinics(clinicsData), 100);
      return;
    }

    try {
      ['clinic-boundaries-fill', 'clinic-boundaries-line', 'clinic-points', 'clinic-labels'].forEach(id => {
        if (map.current!.getLayer(id)) map.current!.removeLayer(id);
      });
      ['clinic-boundaries', 'clinic-points'].forEach(id => {
        if (map.current!.getSource(id)) map.current!.removeSource(id);
      });

      const boundaryFeatures = clinicsData
        .map(clinic => {
          const geom = getGeometry(clinic);
          if (!geom) return null;
          return {
            type: 'Feature' as const,
            properties: {
              clinic_id: clinic.clinic_id,
              clinic_name: clinic.clinic_name,
              color: generateColor(clinic.clinic_id)
            },
            geometry: geom
          };
        })
        .filter(Boolean);

      const pointFeatures = clinicsData
        .map(clinic => {
          const lng = Number(clinic.longitude);
          const lat = Number(clinic.latitude);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
          return {
            type: 'Feature' as const,
            properties: {
              clinic_id: clinic.clinic_id,
              clinic_name: clinic.clinic_name,
              color: generateColor(clinic.clinic_id)
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [lng, lat]
            }
          };
        })
        .filter(Boolean);

      if (boundaryFeatures.length) {
        map.current.addSource('clinic-boundaries', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: boundaryFeatures as GeoJSON.Feature[] }
        });

        map.current.addLayer({
          id: 'clinic-boundaries-fill',
          type: 'fill',
          source: 'clinic-boundaries',
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.4
          }
        });

        map.current.addLayer({
          id: 'clinic-boundaries-line',
          type: 'line',
          source: 'clinic-boundaries',
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-opacity': 0.8
          }
        });

        map.current.on('mouseenter', 'clinic-boundaries-fill', () => {
          map.current!.getCanvas().style.cursor = 'pointer';
        });
        map.current.on('mouseleave', 'clinic-boundaries-fill', () => {
          map.current!.getCanvas().style.cursor = '';
        });

        map.current.on('click', 'clinic-boundaries-fill', (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const clinic = clinicsData.find(c => c.clinic_id === feature.properties?.clinic_id);
          if (clinic) setSelectedClinic(clinic);
        });
      }

      if (pointFeatures.length) {
        map.current.addSource('clinic-points', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: pointFeatures as GeoJSON.Feature[] }
        });

        map.current.addLayer({
          id: 'clinic-points',
          type: 'circle',
          source: 'clinic-points',
          paint: {
            'circle-radius': 8,
            'circle-color': ['get', 'color'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2
          }
        });

        map.current.addLayer({
          id: 'clinic-labels',
          type: 'symbol',
          source: 'clinic-points',
          layout: {
            'text-field': ['get', 'clinic_name'],
            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
            'text-size': 12,
            'text-anchor': 'left',
            'text-offset': [1, 0],
            'text-optional': true
          },
          paint: {
            'text-color': '#1e293b',
            'text-halo-color': '#ffffff',
            'text-halo-width': 2
          }
        });

        map.current.on('click', 'clinic-points', (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const clinic = clinicsData.find(c => c.clinic_id === feature.properties?.clinic_id);
          if (clinic) setSelectedClinic(clinic);
        });

        map.current.on('mouseenter', 'clinic-points', () => {
          map.current!.getCanvas().style.cursor = 'pointer';
        });
        map.current.on('mouseleave', 'clinic-points', () => {
          map.current!.getCanvas().style.cursor = '';
        });

        const coords = pointFeatures.map(f => f!.geometry.coordinates as [number, number]);
        if (coords.length) {
          const bounds = coords.reduce(
            (bounds, coord) => bounds.extend(coord),
            new mapboxgl.LngLatBounds(coords[0], coords[0])
          );
          map.current.fitBounds(bounds, { padding: 50, maxZoom: 10 });
        }
      }
    } catch (error) {
      console.error('Display error:', error);
    }
  }, [getGeometry]);

  const loadClinics = useCallback(async () => {
    try {
      const [terrRes, locRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/clinic_territories?select=clinic_id,clinic_name,state,city,metro_type,raw_geojson&limit=1000`, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'count=exact'
          }
        }),
        fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent('TJC Locations GeoCoded')}?select=*`, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          }
        })
      ]);

      if (!terrRes.ok || !locRes.ok) {
        console.error('API Error');
        alert('Error loading clinics. Check console for details.');
        return;
      }

      const territories = await terrRes.json();
      const locations = await locRes.json();

      const locById: Record<string, Record<string, unknown>> = {};
      locations.forEach((loc: Record<string, unknown>) => {
        const id = (loc.ClinicID || loc.clinic_id) as string;
        if (id) locById[id] = loc;
      });

      const merged: Clinic[] = territories.map((t: Record<string, unknown>) => {
        const id = (t.clinic_id || t.ClinicID) as string;
        const loc = id ? locById[id] : null;
        return {
          clinic_id: id,
          clinic_name: (t.clinic_name || loc?.Name || `Clinic ${id}`) as string,
          state: (t.state || loc?.State) as string,
          city: (t.city || loc?.City || loc?.city) as string,
          address: (loc?.Address || loc?.address || t.address) as string,
          latitude: parseFloat(String(t.latitude ?? loc?.Latitude ?? loc?.latitude)),
          longitude: parseFloat(String(t.longitude ?? loc?.Longitude ?? loc?.longitude)),
          raw_geojson: t.raw_geojson as string,
          metro_type: (t.metro_type || 'unknown') as string
        };
      });

      setClinics(merged);

      const uniqueStates = [...new Set(merged.map(c => c.state).filter(Boolean))] as string[];
      setStates(uniqueStates.sort());

      displayAllClinics(merged);
    } catch (error) {
      console.error('Error loading clinics:', error);
      alert('Error loading clinics: ' + (error as Error).message);
    }
  }, [SUPABASE_URL, SUPABASE_KEY, displayAllClinics]);

  // Initialize map
  useEffect(() => {
    if (map.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    map.current = new mapboxgl.Map({
      container: mapContainer.current!,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-95, 37],
      zoom: 4
    });

    map.current.on('load', () => {
      setMapLoaded(true);
      setTimeout(() => loadClinics(), 500);
    });

    return () => {
      if (map.current) map.current.remove();
    };
  }, [MAPBOX_TOKEN, loadClinics]);

  const flyToClinic = (clinic: Clinic) => {
    if (!map.current || !clinic) return;
    const lng = Number(clinic.longitude);
    const lat = Number(clinic.latitude);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      map.current.flyTo({
        center: [lng, lat],
        zoom: 12,
        duration: 1500,
        essential: true
      });
    }
  };

  const startEditing = () => {
    if (!selectedClinic || !map.current) return;

    if (draw.current) {
      map.current.removeControl(draw.current);
    }

    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true
      },
      defaultMode: 'draw_polygon'
    });

    map.current.addControl(draw.current);

    const geometry = getGeometry(selectedClinic);

    if (geometry) {
      const feature = {
        type: 'Feature' as const,
        geometry: geometry
      };
      draw.current.add(feature as GeoJSON.Feature);
    }

    setIsEditing(true);
  };

  const saveBoundary = async () => {
    if (!draw.current || !selectedClinic) return;

    setSaveStatus('saving');
    const data = draw.current.getAll();

    if (data.features.length === 0) {
      setSaveStatus('error');
      alert('Please draw a boundary first');
      return;
    }

    const newGeometry = data.features[0].geometry;
    const updatedGeoJSON = {
      type: 'Feature',
      geometry: newGeometry,
      properties: {
        clinic_id: selectedClinic.clinic_id,
        clinic_name: selectedClinic.clinic_name,
        last_edited: new Date().toISOString()
      }
    };

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/clinic_territories?clinic_id=eq.${selectedClinic.clinic_id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          geojson: updatedGeoJSON
        })
      });

      if (response.ok) {
        setSaveStatus('success');
        setIsEditing(false);
        if (draw.current) {
          map.current!.removeControl(draw.current);
          draw.current = null;
        }
        setTimeout(() => {
          loadClinics();
          setSaveStatus('');
        }, 2000);
      } else {
        setSaveStatus('error');
        const errorText = await response.text();
        alert('Failed to save boundary: ' + errorText);
      }
    } catch (error) {
      console.error('Error saving boundary:', error);
      setSaveStatus('error');
      alert('Error saving boundary: ' + (error as Error).message);
    }
  };

  const cancelEditing = () => {
    setIsEditing(false);
    if (draw.current && map.current) {
      map.current.removeControl(draw.current);
      draw.current = null;
    }
  };

  const getAddress = async (latitude: number, longitude: number): Promise<string | null> => {
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${MAPBOX_TOKEN}&types=address`
      );
      const data = await response.json();
      if (data.features && data.features.length > 0) {
        return data.features[0].place_name;
      }
      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  };

  const exportFacebookTargeting = async () => {
    if (!selectedClinic) return;

    setSaveStatus('exporting');

    try {
      const lat = Number(selectedClinic.latitude);
      const lng = Number(selectedClinic.longitude);

      const geometry = getGeometry(selectedClinic);

      if (!geometry) {
        alert('No boundary geometry found for this clinic');
        setSaveStatus('');
        return;
      }

      const coords = geometry.type === 'Polygon'
        ? (geometry.coordinates as number[][][])[0]
        : (geometry.coordinates as number[][][][])[0][0];

      const lats = coords.map(c => c[1]);
      const lngs = coords.map(c => c[0]);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

      const territoryWidth = calculateDistance(lat, minLng, lat, maxLng);
      const territoryHeight = calculateDistance(minLat, lng, maxLat, lng);
      const territorySize = Math.max(territoryWidth, territoryHeight);

      setSaveStatus('finding nearby clinics...');

      const nearbyClinicExclusions: Array<{
        name: string;
        address: string;
        latitude: number;
        longitude: number;
        radius: number;
        distance_unit: string;
        distance_miles: number;
        estimated_drive_time_min: number;
      }> = [];

      for (const clinic of clinics) {
        if (clinic.clinic_id === selectedClinic.clinic_id) continue;

        const clinicLat = Number(clinic.latitude);
        const clinicLng = Number(clinic.longitude);

        if (!Number.isFinite(clinicLat) || !Number.isFinite(clinicLng)) continue;

        const distanceMiles = calculateDistance(lat, lng, clinicLat, clinicLng);
        const driveTimeMinutes = estimateDriveTime(distanceMiles, selectedClinic.metro_type);

        if (driveTimeMinutes <= 40) {
          const address = await getAddress(clinicLat, clinicLng);

          let exclusionRadius: number;
          if (distanceMiles < 10) exclusionRadius = 5;
          else if (distanceMiles < 20) exclusionRadius = 10;
          else if (distanceMiles < 30) exclusionRadius = 15;
          else exclusionRadius = 25;

          nearbyClinicExclusions.push({
            name: `Competing Clinic: ${clinic.clinic_name}`,
            address: address || `${clinic.clinic_name}, ${clinic.state}`,
            latitude: clinicLat,
            longitude: clinicLng,
            radius: exclusionRadius,
            distance_unit: 'mile',
            distance_miles: Math.round(distanceMiles * 10) / 10,
            estimated_drive_time_min: Math.round(driveTimeMinutes)
          });

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      setSaveStatus('generating inclusion points...');

      const inclusionPoints: Array<{ lat: number; lng: number; distFromCenter: number }> = [];

      for (let i = 0; i < 1000 && inclusionPoints.length < 10; i++) {
        const testLat = minLat + (maxLat - minLat) * Math.random();
        const testLng = minLng + (maxLng - minLng) * Math.random();

        if (isPointInPolygon([testLng, testLat], coords as [number, number][])) {
          const distFromCenter = calculateDistance(lat, lng, testLat, testLng);
          inclusionPoints.push({ lat: testLat, lng: testLng, distFromCenter });
        }
      }

      inclusionPoints.sort((a, b) => a.distFromCenter - b.distFromCenter);

      const distributedInclusions: typeof inclusionPoints = [];
      for (const point of inclusionPoints) {
        if (distributedInclusions.length === 0) {
          distributedInclusions.push(point);
        } else {
          const tooClose = distributedInclusions.some(existing =>
            calculateDistance(existing.lat, existing.lng, point.lat, point.lng) < territorySize * 0.15
          );
          if (!tooClose) {
            distributedInclusions.push(point);
          }
        }
        if (distributedInclusions.length >= 10) break;
      }

      setSaveStatus('generating boundary exclusions...');

      const exclusionPoints: Array<{ lat: number; lng: number; distFromBoundary: number }> = [];

      for (let i = 0; i < 1000 && exclusionPoints.length < 10; i++) {
        let testLat: number, testLng: number;
        const side = Math.random();

        if (side < 0.25) {
          testLat = maxLat + (maxLat - minLat) * Math.random() * 0.3;
          testLng = minLng + (maxLng - minLng) * Math.random();
        } else if (side < 0.5) {
          testLat = minLat - (maxLat - minLat) * Math.random() * 0.3;
          testLng = minLng + (maxLng - minLng) * Math.random();
        } else if (side < 0.75) {
          testLat = minLat + (maxLat - minLat) * Math.random();
          testLng = maxLng + (maxLng - minLng) * Math.random() * 0.3;
        } else {
          testLat = minLat + (maxLat - minLat) * Math.random();
          testLng = minLng - (maxLng - minLng) * Math.random() * 0.3;
        }

        if (!isPointInPolygon([testLng, testLat], coords as [number, number][])) {
          const distFromBoundary = Math.min(
            ...coords.map(c => calculateDistance(testLat, testLng, c[1], c[0]))
          );
          exclusionPoints.push({ lat: testLat, lng: testLng, distFromBoundary });
        }
      }

      exclusionPoints.sort((a, b) => a.distFromBoundary - b.distFromBoundary);
      const topExclusions = exclusionPoints.slice(0, 10);

      const inclusionRadii = selectRadii(territorySize, distributedInclusions.length);
      const exclusionRadii = selectRadii(territorySize, topExclusions.length);

      setSaveStatus('geocoding addresses...');

      const inclusions: Array<{
        name: string;
        address: string;
        latitude: number;
        longitude: number;
        radius: number;
        distance_unit: string;
      }> = [];

      for (let i = 0; i < distributedInclusions.length; i++) {
        const point = distributedInclusions[i];
        const address = await getAddress(point.lat, point.lng);

        inclusions.push({
          name: `Inclusion ${i + 1}`,
          address: address || 'Address not found',
          latitude: point.lat,
          longitude: point.lng,
          radius: inclusionRadii[i] || 5,
          distance_unit: 'mile'
        });

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const boundaryExclusions: Array<{
        name: string;
        address: string;
        latitude: number;
        longitude: number;
        radius: number;
        distance_unit: string;
      }> = [];

      for (let i = 0; i < topExclusions.length; i++) {
        const point = topExclusions[i];
        const address = await getAddress(point.lat, point.lng);

        boundaryExclusions.push({
          name: `Boundary Exclusion ${i + 1}`,
          address: address || 'Address not found',
          latitude: point.lat,
          longitude: point.lng,
          radius: exclusionRadii[i] || 10,
          distance_unit: 'mile'
        });

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const allExclusions = [...nearbyClinicExclusions, ...boundaryExclusions];

      const targeting = {
        clinic_id: selectedClinic.clinic_id,
        clinic_name: selectedClinic.clinic_name,
        generated_at: new Date().toISOString(),
        geo_locations: {
          custom_locations: inclusions
        },
        excluded_geo_locations: {
          custom_locations: allExclusions
        },
        territory_info: {
          center_latitude: lat,
          center_longitude: lng,
          territory_width_miles: Math.round(territoryWidth * 10) / 10,
          territory_height_miles: Math.round(territoryHeight * 10) / 10,
          territory_size_miles: Math.round(territorySize * 10) / 10
        },
        summary: {
          total_inclusions: inclusions.length,
          total_exclusions: allExclusions.length,
          competing_clinics_excluded: nearbyClinicExclusions.length,
          boundary_exclusions: boundaryExclusions.length,
          inclusion_radii_used: [...new Set(inclusions.map(i => i.radius))].sort((a, b) => a - b),
          exclusion_radii_used: [...new Set(allExclusions.map(e => e.radius))].sort((a, b) => a - b),
          coverage_strategy: territorySize < 20 ? 'Dense (small territory)' :
                            territorySize < 40 ? 'Medium coverage' :
                            territorySize < 60 ? 'Wide coverage' : 'Very wide coverage'
        }
      };

      const blob = new Blob([JSON.stringify(targeting, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facebook_targeting_${selectedClinic.clinic_id}_${selectedClinic.clinic_name.replace(/\s+/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSaveStatus('success');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (error) {
      console.error('Error exporting targeting:', error);
      setSaveStatus('error');
      alert('Error exporting targeting: ' + (error as Error).message);
      setTimeout(() => setSaveStatus(''), 3000);
    }
  };

  const analyzeOverlaps = async (state: string) => {
    setSaveStatus('analyzing');
    setOverlapAnalysis(null);

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/analyze_overlaps`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ target_state: state || null })
      });

      if (response.ok) {
        const data = await response.json();
        const result = Array.isArray(data) ? data[0] : data;

        if (result) {
          setOverlapAnalysis(result);
          setSaveStatus('');
        } else {
          alert('No overlap data returned.');
          setSaveStatus('');
        }
      } else {
        const error = await response.text();
        alert('Failed to analyze overlaps: ' + error);
        setSaveStatus('');
      }
    } catch (error) {
      alert('Error analyzing overlaps: ' + (error as Error).message);
      setSaveStatus('');
    }
  };

  const resolveOverlaps = async (state: string) => {
    if (!overlapAnalysis || overlapAnalysis.total_overlaps === 0) {
      alert('No overlaps to resolve.');
      return;
    }

    const totalOverlaps = overlapAnalysis.total_overlaps;
    const batchSize = 5;

    if (!confirm(`Resolve ~${totalOverlaps} overlaps for ${state || 'ALL STATES'}?`)) {
      return;
    }

    setSaveStatus('resolving');
    let totalResolved = 0;
    let batchCount = 0;

    try {
      while (batchCount < 50) {
        batchCount++;

        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolve_territory_overlaps_batch`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            target_state: state || null,
            batch_size: batchSize
          })
        });

        if (response.ok) {
          const results = await response.json();
          const resolved = Array.isArray(results) ? results.length : 0;
          totalResolved += resolved;

          setSaveStatus(`resolving (${totalResolved} done)`);

          if (resolved === 0 || resolved < batchSize) {
            break;
          }

          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          throw new Error(`Batch ${batchCount} failed`);
        }
      }

      alert(`Resolved ${totalResolved} overlaps!`);
      setSaveStatus('');
      setShowOverlapPanel(false);
      setTimeout(() => loadClinics(), 1000);
    } catch (error) {
      alert(`Error: ${(error as Error).message}`);
      setSaveStatus('');
    }
  };

  const filteredClinics = clinics.filter(clinic =>
    clinic.clinic_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    clinic.clinic_id?.toString().includes(searchTerm)
  );

  return (
    <div className="flex h-screen bg-gray-100">
      <div className="w-96 bg-white shadow-lg overflow-y-auto">
        <div className="p-4 border-b">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Clinic Territory Manager</h1>

          <div className="relative">
            <div className="absolute left-3 top-3 text-gray-400">
              <SearchIcon />
            </div>
            <input
              type="text"
              placeholder="Search by name or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={() => setShowOverlapPanel(true)}
            className="mt-2 w-full bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600"
          >
            Manage Overlaps
          </button>
        </div>

        <div className="p-4">
          <h2 className="text-lg font-semibold mb-3 text-gray-700">
            {searchTerm ? `Found ${filteredClinics.length}` : `All Clinics (${clinics.length})`}
          </h2>
          <div className="space-y-2">
            {filteredClinics.map(clinic => (
              <div
                key={clinic.clinic_id}
                onClick={() => {
                  setSelectedClinic(clinic);
                  flyToClinic(clinic);
                }}
                className={`p-3 rounded-lg cursor-pointer transition border-l-4 ${
                  selectedClinic?.clinic_id === clinic.clinic_id
                    ? 'bg-blue-100 border-blue-500'
                    : 'bg-gray-50 hover:bg-gray-100 border-transparent'
                }`}
                style={{
                  borderLeftColor: selectedClinic?.clinic_id === clinic.clinic_id
                    ? undefined
                    : generateColor(clinic.clinic_id)
                }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-800">{clinic.clinic_name}</h3>
                    <p className="text-sm text-gray-600">ID: {clinic.clinic_id}</p>
                    <p className="text-xs text-gray-500">{clinic.state} - {clinic.metro_type}</p>
                  </div>
                  <div style={{ color: generateColor(clinic.clinic_id) }}>
                    <MapPinIcon />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 relative">
        <div ref={mapContainer} className="w-full h-full" />

        {selectedClinic && (
          <div className="absolute top-4 left-4 bg-white rounded-lg shadow-xl p-4 w-80 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-xl font-bold text-gray-800">{selectedClinic.clinic_name}</h2>
                <p className="text-sm text-gray-600">ID: {selectedClinic.clinic_id}</p>
              </div>
              <button
                onClick={() => {
                  setSelectedClinic(null);
                  cancelEditing();
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XIcon />
              </button>
            </div>

            <div className="space-y-2 mb-4">
              {selectedClinic.address && (
                <p className="text-sm"><span className="font-semibold">Address:</span> {selectedClinic.address}</p>
              )}
              {selectedClinic.city && (
                <p className="text-sm"><span className="font-semibold">City:</span> {selectedClinic.city}</p>
              )}
              <p className="text-sm"><span className="font-semibold">State:</span> {selectedClinic.state}</p>
              <p className="text-sm"><span className="font-semibold">Type:</span> {selectedClinic.metro_type}</p>
              <p className="text-sm"><span className="font-semibold">Coordinates:</span> {selectedClinic.latitude?.toFixed(4)}, {selectedClinic.longitude?.toFixed(4)}</p>
            </div>

            <div className="space-y-2">
              {!isEditing ? (
                <>
                  <button
                    onClick={startEditing}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                  >
                    <EditIcon />
                    Edit Boundary
                  </button>
                  <button
                    onClick={exportFacebookTargeting}
                    disabled={saveStatus === 'exporting' || saveStatus.includes('finding') || saveStatus.includes('generating') || saveStatus.includes('geocoding')}
                    className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 disabled:bg-gray-400"
                  >
                    <DownloadIcon />
                    {saveStatus && saveStatus !== 'success' && saveStatus !== 'error' ? saveStatus : 'Export FB Targeting'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={saveBoundary}
                    disabled={saveStatus === 'saving'}
                    className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                  >
                    <SaveIcon />
                    {saveStatus === 'saving' ? 'Saving...' : 'Save Boundary'}
                  </button>
                  <button
                    onClick={cancelEditing}
                    className="w-full bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>

            {saveStatus && (
              <div className={`mt-3 p-2 rounded-lg text-sm ${
                saveStatus === 'success' ? 'bg-green-100 text-green-800' :
                saveStatus === 'error' ? 'bg-red-100 text-red-800' :
                'bg-blue-100 text-blue-800'
              }`}>
                {saveStatus === 'success' && 'Operation completed!'}
                {saveStatus === 'error' && 'Operation failed'}
                {saveStatus === 'saving' && 'Saving...'}
              </div>
            )}
          </div>
        )}

        {!selectedClinic && !showOverlapPanel && (
          <div className="absolute top-4 left-4 bg-white rounded-lg shadow-xl p-4 max-w-md">
            <div className="flex items-start gap-3">
              <div className="text-blue-500">
                <AlertIcon />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 mb-1">Color-Coded Territories</h3>
                <p className="text-sm text-gray-600">
                  Each clinic has a unique color. Click any territory or marker to view details.
                </p>
              </div>
            </div>
          </div>
        )}

        {showOverlapPanel && (
          <div className="absolute top-4 left-4 bg-white rounded-lg shadow-xl p-6 w-96 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Manage Territory Overlaps</h2>
                <p className="text-sm text-gray-600 mt-1">Resolve overlaps by drive time</p>
              </div>
              <button
                onClick={() => {
                  setShowOverlapPanel(false);
                  setOverlapAnalysis(null);
                  setSelectedState('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XIcon />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Select State
              </label>
              <select
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All States</option>
                {states.map(state => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => analyzeOverlaps(selectedState)}
                disabled={saveStatus === 'analyzing'}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
              >
                {saveStatus === 'analyzing' ? 'Analyzing...' : 'Analyze Overlaps'}
              </button>

              {overlapAnalysis && (
                <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                  <h3 className="font-semibold text-gray-800 mb-2">Analysis Results</h3>
                  <div className="text-sm space-y-1">
                    <p><span className="font-semibold">State:</span> {overlapAnalysis.state}</p>
                    <p><span className="font-semibold">Total Overlaps:</span> {overlapAnalysis.total_overlaps}</p>
                    <p><span className="font-semibold">Clinics Affected:</span> {overlapAnalysis.clinics_with_overlaps}</p>
                  </div>

                  {overlapAnalysis.total_overlaps > 0 && (
                    <button
                      onClick={() => resolveOverlaps(selectedState)}
                      disabled={saveStatus === 'resolving' || saveStatus.includes('done')}
                      className="w-full mt-3 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                    >
                      {saveStatus === 'resolving' || saveStatus.includes('done') ? saveStatus : 'Resolve All Overlaps'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
