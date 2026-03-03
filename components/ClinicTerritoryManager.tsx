'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

import Link from 'next/link';
import { generateColor, calculateDistance, isPointInPolygon, estimateDriveTime, selectRadii, parseJSON } from '@/lib/geo-utils';
import type { Clinic, OverlapAnalysis, GeoJSONFeature, GeoJSONFeatureCollection, GeoJSONGeometry, AgeTargetingData } from '@/lib/types';
import ageTargetingData from '@/data/age-targeting.json';

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
  const [loadingStatus, setLoadingStatus] = useState('');
  const [showZipCodes, setShowZipCodes] = useState(false);
  const [editChatInput, setEditChatInput] = useState('');
  const [editChatMessages, setEditChatMessages] = useState<Array<{role: 'user' | 'assistant', content: string}>>([]);
  const [editChatLoading, setEditChatLoading] = useState(false);

  const mapContainer = useRef<HTMLDivElement>(null);
  const editChatRef = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const draw = useRef<MapboxDraw | null>(null);

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY!;
  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

  const getGeometry = useCallback((clinic: Clinic): GeoJSONGeometry | null => {
    // Prefer corrected geojson (from geom column) over raw_geojson
    if (clinic.geojson && 'type' in clinic.geojson && 'coordinates' in clinic.geojson) {
      return clinic.geojson;
    }

    // Fallback to raw_geojson for backwards compatibility
    const raw = parseJSON<GeoJSONFeature | GeoJSONFeatureCollection | GeoJSONGeometry>(clinic.raw_geojson as string);
    if (!raw) return null;

    if ('type' in raw) {
      if (raw.type === 'FeatureCollection' && 'features' in raw && raw.features?.length) {
        // Select isochrone index based on metro type
        // Features are ordered: [30min, 20min, 15min, 10min]
        const metroType = (clinic.metro_type || 'suburban').toLowerCase();
        let featureIndex: number;

        if (metroType === 'urban') {
          featureIndex = 2;  // 15-min isochrone
        } else if (metroType === 'rural') {
          featureIndex = 0;  // 30-min isochrone
        } else {
          featureIndex = 1;  // 20-min isochrone (suburban/default)
        }

        // Fallback to first feature if index doesn't exist
        return raw.features[featureIndex]?.geometry || raw.features[0]?.geometry || null;
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

  // Display clinic points on the map (fast, no boundaries)
  const displayClinicPoints = useCallback((clinicsData: Clinic[]) => {
    if (!map.current) return;

    if (!map.current.isStyleLoaded()) {
      setTimeout(() => displayClinicPoints(clinicsData), 100);
      return;
    }

    try {
      // Remove existing layers
      ['clinic-points', 'clinic-labels'].forEach(id => {
        if (map.current!.getLayer(id)) map.current!.removeLayer(id);
      });
      if (map.current.getSource('clinic-points')) {
        map.current.removeSource('clinic-points');
      }

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
      console.error('Display points error:', error);
    }
  }, []);

  // Load and display boundaries in batches
  const loadBoundaries = useCallback(async (clinicsData: Clinic[]) => {
    if (!map.current) return;

    const batchSize = 25;
    let offset = 0;
    let allBoundaryFeatures: GeoJSON.Feature[] = [];

    // Initialize boundary source and layers
    if (!map.current.getSource('clinic-boundaries')) {
      map.current.addSource('clinic-boundaries', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addLayer({
        id: 'clinic-boundaries-fill',
        type: 'fill',
        source: 'clinic-boundaries',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.4
        }
      }, 'clinic-points'); // Insert below points

      map.current.addLayer({
        id: 'clinic-boundaries-line',
        type: 'line',
        source: 'clinic-boundaries',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.8
        }
      }, 'clinic-points');

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

    try {
      let hasMore = true;
      let totalLoaded = 0;

      while (hasMore) {
        setLoadingStatus(`Loading boundaries... ${totalLoaded} loaded`);

        const response = await fetch(`/api/boundaries?offset=${offset}&limit=${batchSize}`);
        if (!response.ok) {
          console.error('Error loading boundaries batch');
          break;
        }

        const data = await response.json();

        // Process boundaries - use corrected geojson from geom column
        for (const boundary of data.boundaries) {
          // geojson contains the corrected boundary geometry directly
          const geom = boundary.geojson as GeoJSONGeometry | null;

          if (geom && 'type' in geom && 'coordinates' in geom) {
            allBoundaryFeatures.push({
              type: 'Feature',
              properties: {
                clinic_id: boundary.clinic_id,
                clinic_name: boundary.clinic_name,
                color: generateColor(boundary.clinic_id)
              },
              geometry: geom as GeoJSON.Geometry
            });
          }
        }

        // Update the map source with all boundaries so far
        const source = map.current.getSource('clinic-boundaries') as mapboxgl.GeoJSONSource;
        if (source) {
          source.setData({
            type: 'FeatureCollection',
            features: allBoundaryFeatures
          });
        }

        totalLoaded += data.boundaries.length;
        hasMore = data.hasMore;
        offset += batchSize;

        // Small delay to not overwhelm the server
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      setLoadingStatus('');
    } catch (error) {
      console.error('Error loading boundaries:', error);
      setLoadingStatus('Error loading boundaries');
    }
  }, []);

  const loadClinics = useCallback(async () => {
    try {
      setLoadingStatus('Loading clinics...');
      const response = await fetch('/api/clinics');

      if (!response.ok) {
        const errorData = await response.json();
        console.error('API Error:', errorData);
        alert('Error loading clinics. Check console for details.');
        setLoadingStatus('');
        return;
      }

      const data = await response.json();
      const merged: Clinic[] = data.clinics;

      setClinics(merged);

      const uniqueStates = Array.from(new Set(merged.map(c => c.state).filter((s): s is string => Boolean(s))));
      setStates(uniqueStates.sort());

      // First display points (fast)
      displayClinicPoints(merged);

      // Then load boundaries in batches (slower, but progressive)
      loadBoundaries(merged);
    } catch (error) {
      console.error('Error loading clinics:', error);
      alert('Error loading clinics: ' + (error as Error).message);
      setLoadingStatus('');
    }
  }, [displayClinicPoints, loadBoundaries]);

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

      // Add zip code boundaries via proxy to avoid CORS issues
      map.current!.addSource('zip-wms', {
        type: 'raster',
        tiles: [
          `${window.location.origin}/api/tiles/zip?bbox={bbox-epsg-3857}`
        ],
        tileSize: 512,
        attribution: 'U.S. Census Bureau',
      });

      map.current!.addLayer({
        id: 'zip-borders',
        type: 'raster',
        source: 'zip-wms',
        minzoom: 6,
        layout: {
          visibility: 'none', // Hidden by default
        },
        paint: {
          'raster-opacity': 0.7,
        },
      });

      setTimeout(() => loadClinics(), 500);
    });

    return () => {
      if (map.current) map.current.remove();
    };
  }, [MAPBOX_TOKEN, loadClinics]);

  // Toggle zip code layer visibility
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    try {
      if (map.current.getLayer('zip-borders')) {
        map.current.setLayoutProperty(
          'zip-borders',
          'visibility',
          showZipCodes ? 'visible' : 'none'
        );
      }
    } catch (e) {
      console.error('Error toggling zip layer:', e);
    }
  }, [showZipCodes, mapLoaded]);

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

    // @ts-expect-error - MapboxDraw types don't include all valid options
    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true
      },
      defaultMode: 'simple_select'
    });

    map.current.addControl(draw.current);

    const geometry = getGeometry(selectedClinic);

    if (geometry) {
      const feature = {
        type: 'Feature' as const,
        geometry: geometry,
        properties: {}
      };
      const featureIds = draw.current.add(feature as GeoJSON.Feature);

      // Select the feature to enable vertex editing (click and drag)
      if (featureIds && featureIds.length > 0) {
        draw.current.changeMode('direct_select', { featureId: featureIds[0] });
      }
    }

    // Clear previous chat messages when starting new edit session
    setEditChatMessages([]);
    setEditChatInput('');
    setIsEditing(true);
  };

  // Handle chat commands for boundary editing
  const handleEditChat = async () => {
    if (!editChatInput.trim() || editChatLoading || !selectedClinic || !draw.current) return;

    const userMessage = editChatInput.trim();
    setEditChatInput('');
    setEditChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setEditChatLoading(true);

    try {
      // Get current boundary from draw control
      const drawData = draw.current.getAll();
      const currentGeometry = drawData.features.length > 0 ? drawData.features[0].geometry : null;

      // Build context for the chat
      const contextMessage = `[BOUNDARY EDIT MODE]
Clinic: "${selectedClinic.clinic_name}" (ID: ${selectedClinic.clinic_id})
Location: ${selectedClinic.city}, ${selectedClinic.state}
Metro Type: ${selectedClinic.metro_type}
Coordinates: ${selectedClinic.latitude}, ${selectedClinic.longitude}
Current Boundary: ${currentGeometry ? JSON.stringify(currentGeometry).substring(0, 500) + '...' : 'None'}

The user wants to modify the clinic's territory boundary. Interpret their request and respond with either:
1. A JSON boundary modification command in this format: {"action": "modify_boundary", "geometry": <GeoJSON geometry>}
2. Or a helpful response explaining what you understood and asking for clarification.

For expansion/contraction requests, calculate new coordinates based on the direction and distance specified.
For "include zip code X" requests, you would need to expand the boundary to include that area.
For "set drive time to X minutes", suggest using the appropriate isochrone from raw_geojson.

User request: ${userMessage}`;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...editChatMessages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: contextMessage }
          ],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      const assistantMessage = data.message?.content || 'No response received';

      // Check if the response contains a boundary modification command
      const jsonMatch = assistantMessage.match(/\{"action":\s*"modify_boundary".*?"geometry":\s*(\{.*\})\}/s);
      if (jsonMatch) {
        try {
          const newGeometry = JSON.parse(jsonMatch[1]);
          // Clear existing features and add the new one
          draw.current.deleteAll();
          const featureIds = draw.current.add({
            type: 'Feature',
            geometry: newGeometry,
            properties: {}
          } as GeoJSON.Feature);

          if (featureIds && featureIds.length > 0) {
            draw.current.changeMode('direct_select', { featureId: featureIds[0] });
          }

          setEditChatMessages(prev => [...prev, {
            role: 'assistant',
            content: 'Boundary updated! You can continue to drag vertices to adjust, or click "Save Boundary" when done.'
          }]);
        } catch {
          setEditChatMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }]);
        }
      } else {
        setEditChatMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }]);
      }

      // Scroll to bottom of chat
      setTimeout(() => {
        editChatRef.current?.scrollTo({ top: editChatRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);

    } catch (err) {
      setEditChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to process request'}`
      }]);
    } finally {
      setEditChatLoading(false);
    }
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
      // First try to get a street address
      const addressResponse = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${MAPBOX_TOKEN}&types=address`
      );
      const addressData = await addressResponse.json();
      if (addressData.features && addressData.features.length > 0) {
        return addressData.features[0].place_name;
      }

      // Fall back to any location type (place, locality, poi, etc.)
      const fallbackResponse = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${MAPBOX_TOKEN}`
      );
      const fallbackData = await fallbackResponse.json();
      if (fallbackData.features && fallbackData.features.length > 0) {
        return fallbackData.features[0].place_name;
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

      // Try to get geometry from clinic object first
      let geometry = getGeometry(selectedClinic);

      // If not available, fetch boundary on-demand
      if (!geometry) {
        setSaveStatus('loading boundary...');
        try {
          const boundaryResponse = await fetch(`/api/boundaries?clinic_id=${selectedClinic.clinic_id}`);
          if (boundaryResponse.ok) {
            const boundaryData = await boundaryResponse.json();
            if (boundaryData.boundaries && boundaryData.boundaries.length > 0) {
              // Use corrected geojson (from geom column) directly
              const geojson = boundaryData.boundaries[0].geojson as GeoJSONGeometry;
              if (geojson && 'type' in geojson && 'coordinates' in geojson) {
                geometry = geojson;
              }
            }
          }
        } catch (e) {
          console.error('Error fetching boundary:', e);
        }
      }

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

      // Determine neutral zone buffer based on metro type
      const metroType = (selectedClinic.metro_type || 'suburban').toLowerCase();
      let neutralBuffer: number;
      if (metroType === 'urban') {
        neutralBuffer = 3;
      } else if (metroType === 'rural') {
        neutralBuffer = 10;
      } else {
        neutralBuffer = 5; // suburban or unknown
      }

      setSaveStatus('generating inclusion points...');

      // CONSTRAINT: Facebook visual preview requires 25 points max (inclusions + exclusions)
      // Using 4 exclusion points (corners), leaving 21 for inclusions
      const MAX_TOTAL_POINTS = 25;
      const NUM_EXCLUSIONS = 4;
      const MAX_INCLUSIONS = MAX_TOTAL_POINTS - NUM_EXCLUSIONS;

      // Use 1-mile radius with tight grid to better approximate the polygon shape
      const CIRCLE_RADIUS = 1;
      const GRID_SPACING = 1.5; // Slight overlap with 1-mile circles

      // Convert miles to degrees
      const milesToDegreesLat = (miles: number) => miles / 69;
      const milesToDegreesLng = (miles: number, atLat: number) => miles / (69 * Math.cos(atLat * Math.PI / 180));

      const latStep = milesToDegreesLat(GRID_SPACING);
      const lngStep = milesToDegreesLng(GRID_SPACING, lat);

      // Hexagonal offset for alternating rows
      const hexOffset = lngStep / 2;

      const inclusionPoints: Array<{ lat: number; lng: number; distFromCenter: number; distFromBoundary: number }> = [];

      // Always add clinic location first
      const clinicDistFromBoundary = Math.min(
        ...coords.map(c => calculateDistance(lat, lng, c[1], c[0]))
      );
      inclusionPoints.push({
        lat: lat,
        lng: lng,
        distFromCenter: 0,
        distFromBoundary: clinicDistFromBoundary
      });

      // Generate hexagonal grid covering the bounding box
      let rowIndex = 0;
      for (let testLat = minLat; testLat <= maxLat; testLat += latStep) {
        const rowOffset = (rowIndex % 2 === 1) ? hexOffset : 0;

        for (let testLng = minLng + rowOffset; testLng <= maxLng; testLng += lngStep) {
          // Skip if too close to clinic location (already added)
          const distFromClinic = calculateDistance(lat, lng, testLat, testLng);
          if (distFromClinic < GRID_SPACING * 0.5) continue;

          // Check if point is inside the polygon
          if (isPointInPolygon([testLng, testLat], coords as [number, number][])) {
            const distFromBoundary = Math.min(
              ...coords.map(c => calculateDistance(testLat, testLng, c[1], c[0]))
            );
            inclusionPoints.push({
              lat: testLat,
              lng: testLng,
              distFromCenter: distFromClinic,
              distFromBoundary
            });
          }
        }
        rowIndex++;
      }

      // Sort by distance from boundary (closest to edge first for better polygon approximation)
      // This prioritizes points that help define the polygon's outer shape
      const clinicPoint = inclusionPoints[0];
      const gridPoints = inclusionPoints.slice(1).sort((a, b) => a.distFromBoundary - b.distFromBoundary);
      const limitedGridPoints = gridPoints.slice(0, MAX_INCLUSIONS - 1);

      const distributedInclusions = [clinicPoint, ...limitedGridPoints];

      // For exclusion calculation
      const actualMaxInclusionRadius = CIRCLE_RADIUS;
      const minExclusionDistance = actualMaxInclusionRadius + neutralBuffer + 10;

      setSaveStatus('generating boundary exclusion points...');

      // OUTER LAYER: Build exclusion zone with 8 points:
      // - 4 corner points (SW, SE, NW, NE) at 45mi radius
      // - 4 intermediate points (S, W, N, E) at 30mi radius

      // Distance from clinic to corner exclusions (diagonal)
      const cornerDistance = neutralBuffer + 50 + (territorySize / 2);
      // Distance from clinic to intermediate exclusions (cardinal directions)
      const cardinalDistance = neutralBuffer + 40 + (territorySize / 2);

      // Build 8 exclusion points
      const exclusionPoints: Array<{ lat: number; lng: number; radius: number; name: string }> = [];

      // 4 CORNER points with 45mi radius (SW, SE, NW, NE)
      // Southwest
      exclusionPoints.push({
        lat: lat - milesToDegreesLat(cornerDistance * 0.7),
        lng: lng - milesToDegreesLng(cornerDistance * 0.7, lat),
        radius: 45,
        name: 'Southwest'
      });
      // Southeast
      exclusionPoints.push({
        lat: lat - milesToDegreesLat(cornerDistance * 0.7),
        lng: lng + milesToDegreesLng(cornerDistance * 0.7, lat),
        radius: 45,
        name: 'Southeast'
      });
      // Northwest
      exclusionPoints.push({
        lat: lat + milesToDegreesLat(cornerDistance * 0.7),
        lng: lng - milesToDegreesLng(cornerDistance * 0.7, lat),
        radius: 45,
        name: 'Northwest'
      });
      // Northeast
      exclusionPoints.push({
        lat: lat + milesToDegreesLat(cornerDistance * 0.7),
        lng: lng + milesToDegreesLng(cornerDistance * 0.7, lat),
        radius: 45,
        name: 'Northeast'
      });

      // 4 INTERMEDIATE points with 30mi radius (S, W, N, E)
      // South
      exclusionPoints.push({
        lat: lat - milesToDegreesLat(cardinalDistance),
        lng: lng,
        radius: 30,
        name: 'South'
      });
      // West
      exclusionPoints.push({
        lat: lat,
        lng: lng - milesToDegreesLng(cardinalDistance, lat),
        radius: 30,
        name: 'West'
      });
      // North
      exclusionPoints.push({
        lat: lat + milesToDegreesLat(cardinalDistance),
        lng: lng,
        radius: 30,
        name: 'North'
      });
      // East
      exclusionPoints.push({
        lat: lat,
        lng: lng + milesToDegreesLng(cardinalDistance, lat),
        radius: 30,
        name: 'East'
      });

      const distributedExclusions = exclusionPoints;

      setSaveStatus('geocoding addresses...');

      // Layer type definitions
      interface LayerCircle {
        name: string;
        address: string;
        latitude: number;
        longitude: number;
        radius: number;
        distance_unit: string;
        layer_type: 'include' | 'neutral' | 'exclude';
      }

      const innerLayer: LayerCircle[] = [];      // Include zone - INSIDE territory
      const middleLayer: LayerCircle[] = [];     // Neutral zone - documentation only
      const outerLayer: LayerCircle[] = [];      // Exclusion donut - OUTSIDE territory

      // Process inclusion points - geocode all addresses for manual copy/paste
      const clinicAddress = selectedClinic.address
        ? `${selectedClinic.address}, ${selectedClinic.city || ''}, ${selectedClinic.state || ''}`.trim()
        : await getAddress(lat, lng) || 'Clinic Address';

      for (let i = 0; i < distributedInclusions.length; i++) {
        const point = distributedInclusions[i];

        setSaveStatus(`geocoding inclusions... ${i + 1}/${distributedInclusions.length}`);

        let address: string;
        let pointName: string;

        if (i === 0) {
          // Clinic location - use actual address
          address = clinicAddress;
          pointName = `Clinic: ${selectedClinic.clinic_name}`;
        } else {
          // Grid points - geocode to get real address
          address = await getAddress(point.lat, point.lng) || `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
          pointName = `Include ${i}`;
        }

        innerLayer.push({
          name: pointName,
          address: address,
          latitude: point.lat,
          longitude: point.lng,
          radius: CIRCLE_RADIUS,
          distance_unit: 'mile',
          layer_type: 'include'
        });

        // Small delay to avoid rate limiting
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Process exclusion points (outer layer)
      for (let i = 0; i < distributedExclusions.length; i++) {
        const point = distributedExclusions[i];
        if (!point) continue;

        const address = await getAddress(point.lat, point.lng);

        // Outer layer - Exclusion
        outerLayer.push({
          name: `${point.name} Exclusion`,
          address: address || 'Address not found',
          latitude: point.lat,
          longitude: point.lng,
          radius: point.radius,
          distance_unit: 'mile',
          layer_type: 'exclude'
        });

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Sort inclusions and exclusions by radius
      const sortedInclusions = [...innerLayer].sort((a, b) => a.radius - b.radius);
      const sortedExclusions = [...outerLayer].sort((a, b) => a.radius - b.radius);

      // Build simple text file
      const lines: string[] = [];

      lines.push(`Facebook Audience Targeting - Polygon Coverage`);
      lines.push(`Clinic: ${selectedClinic.clinic_name} (${selectedClinic.clinic_id})`);
      lines.push(`Metro Type: ${selectedClinic.metro_type}`);
      lines.push(`Generated: ${new Date().toLocaleString()}`);
      lines.push('');
      lines.push(`COVERAGE SUMMARY`);
      lines.push(`  Include Radius: ${CIRCLE_RADIUS} mi`);
      lines.push(`  Exclude Radii: 45 mi (corners) / 30 mi (cardinals)`);
      lines.push(`  Include Points: ${sortedInclusions.length}`);
      lines.push(`  Exclude Points: ${sortedExclusions.length}`);
      lines.push(`  Total Points: ${sortedInclusions.length + sortedExclusions.length} / 25 max`);
      lines.push(`  Territory Size: ${territoryWidth.toFixed(1)} x ${territoryHeight.toFixed(1)} miles`);
      lines.push('');

      // Age targeting section
      const clinicName = selectedClinic.clinic_name.replace(/^The Joint Chiropractic\s+/i, '');
      const ageData = (ageTargetingData as AgeTargetingData)[clinicName];
      if (ageData) {
        lines.push('='.repeat(60));
        lines.push(`AGE TARGETING (Based on ${ageData.sample_size} first-party conversions)`);
        lines.push('='.repeat(60));
        lines.push('');
        lines.push(`Tier 1 (Core):    ${ageData.t1_min}-${ageData.t1_max} years`);
        lines.push(`Tier 2 (Broad):   ${ageData.t2_min}-${ageData.t2_max} years`);
        lines.push(`Tier 3 (Maximum): ${ageData.t3_min}-${ageData.t3_max} years`);
        lines.push(`Blended Range:    ${ageData.blend_min}-${ageData.blend_max} years (75% T1 / 25% T2)`);
        lines.push('');
        lines.push('Budget Allocation: 60-70% T1 | 25-30% T2 | 0-10% T3');
        lines.push('');
      }

      lines.push('='.repeat(60));
      lines.push(`INCLUDE LOCATIONS (${sortedInclusions.length} points)`);
      lines.push('='.repeat(60));
      lines.push('');

      // Group inclusions by radius
      const inclusionsByRadius = sortedInclusions.reduce((acc, loc) => {
        const key = loc.radius;
        if (!acc[key]) acc[key] = [];
        acc[key].push(loc);
        return acc;
      }, {} as Record<number, typeof sortedInclusions>);

      // Sort radii and output each group
      const inclusionRadii = Object.keys(inclusionsByRadius).map(Number).sort((a, b) => a - b);
      for (const radius of inclusionRadii) {
        lines.push(`${radius} mi radius:`);
        for (const loc of inclusionsByRadius[radius]) {
          lines.push(`${loc.address}`);
        }
        lines.push('');
      }

      lines.push('='.repeat(60));
      lines.push(`EXCLUDE LOCATIONS (${sortedExclusions.length} points)`);
      lines.push('='.repeat(60));
      lines.push('');

      // Group exclusions by radius
      const exclusionsByRadius = sortedExclusions.reduce((acc, loc) => {
        const key = loc.radius;
        if (!acc[key]) acc[key] = [];
        acc[key].push(loc);
        return acc;
      }, {} as Record<number, typeof sortedExclusions>);

      // Sort radii and output each group
      const exclusionRadii = Object.keys(exclusionsByRadius).map(Number).sort((a, b) => a - b);
      for (const radius of exclusionRadii) {
        lines.push(`${radius} mi radius:`);
        for (const loc of exclusionsByRadius[radius]) {
          lines.push(`${loc.address}`);
        }
        lines.push('');
      }

      lines.push('='.repeat(60));
      lines.push(`TOTAL POINTS: ${sortedInclusions.length + sortedExclusions.length} / 25`);
      lines.push('='.repeat(60));

      const textContent = lines.join('\n');
      const blob = new Blob([textContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facebook_audience_${selectedClinic.clinic_id}_${selectedClinic.clinic_name.replace(/\s+/g, '_')}.txt`;
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

          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setShowOverlapPanel(true)}
              className="flex-1 bg-orange-500 text-white px-3 py-2 rounded-lg hover:bg-orange-600 text-sm"
            >
              Manage Overlaps
            </button>
            <button
              onClick={() => setShowZipCodes(!showZipCodes)}
              className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                showZipCodes
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {showZipCodes ? 'Hide' : 'Show'} Zip Codes
            </button>
          </div>

          <Link
            href="/chat"
            className="mt-2 w-full bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 block text-center"
          >
            Data Assistant
          </Link>
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
                  {/* Editing instructions */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                    <p className="text-xs text-blue-800 font-medium mb-1">Editing Mode</p>
                    <p className="text-xs text-blue-700">
                      • Drag vertices (white circles) to reshape<br/>
                      • Drag midpoints (blue dots) to add vertices<br/>
                      • Or use chat below for AI-assisted edits
                    </p>
                  </div>

                  {/* Chat interface for boundary editing */}
                  <div className="border border-gray-200 rounded-lg mb-3">
                    <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                      <p className="text-xs font-medium text-gray-700">AI Boundary Assistant</p>
                    </div>

                    {/* Chat messages */}
                    <div
                      ref={editChatRef}
                      className="max-h-32 overflow-y-auto p-2 space-y-2"
                    >
                      {editChatMessages.length === 0 && (
                        <p className="text-xs text-gray-400 italic">
                          Try: &quot;Expand 2 miles north&quot; or &quot;Use 30-minute drive time&quot;
                        </p>
                      )}
                      {editChatMessages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`text-xs p-2 rounded ${
                            msg.role === 'user'
                              ? 'bg-blue-100 text-blue-800 ml-4'
                              : 'bg-gray-100 text-gray-700 mr-4'
                          }`}
                        >
                          {msg.content}
                        </div>
                      ))}
                      {editChatLoading && (
                        <div className="text-xs p-2 rounded bg-gray-100 text-gray-500 mr-4 italic">
                          Thinking...
                        </div>
                      )}
                    </div>

                    {/* Chat input */}
                    <div className="p-2 border-t border-gray-200">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editChatInput}
                          onChange={(e) => setEditChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleEditChat();
                            }
                          }}
                          placeholder="Describe boundary change..."
                          disabled={editChatLoading}
                          className="flex-1 text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                        />
                        <button
                          onClick={handleEditChat}
                          disabled={editChatLoading || !editChatInput.trim()}
                          className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  </div>

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
                {loadingStatus && (
                  <p className="text-sm text-blue-600 mt-2 font-medium">{loadingStatus}</p>
                )}
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
