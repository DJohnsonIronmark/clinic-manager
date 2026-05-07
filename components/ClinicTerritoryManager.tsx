'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

import Link from 'next/link';
import {
  generateColor,
  calculateDistance,
  isPointInPolygon,
  estimateDriveTime,
  selectRadii,
  parseJSON,
  getDistanceToPolygonEdge,
  getMaxSafeRadius,
  samplePolygonPerimeter,
  estimateCircleCoverage,
  calculateCoverageMetrics,
  generateHexGrid,
  calculateOptimalRadius,
  calculatePolygonArea,
  scoreCoveragePoint
} from '@/lib/geo-utils';
import type { Clinic, OverlapAnalysis, GeoJSONFeature, GeoJSONFeatureCollection, GeoJSONGeometry, AgeTargetingData } from '@/lib/types';
import ageTargetingData from '@/data/age-targeting.json';
import AIInsightsPanel from './AIInsightsPanel';
import ChurnRiskPanel from './ChurnRiskPanel';

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
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [showChurnRisk, setShowChurnRisk] = useState(false);
  const [newLocationForm, setNewLocationForm] = useState({ clinic_name: '', clinic_id: '', address: '' });
  const [addingLocation, setAddingLocation] = useState(false);
  const [pushTargetingStatus, setPushTargetingStatus] = useState<'idle' | 'confirming' | 'pushing' | 'done'>('idle');
  const [pushTargetingResult, setPushTargetingResult] = useState<{
    success: boolean;
    summary?: { updated: number; skipped: number; errors: number };
    results?: Array<{ clinic_id: string; clinic_name: string; status: string; reason?: string; adsets_updated?: number }>;
    skipped_no_targeting?: string[];
    error?: string;
  } | null>(null);
  const [pushTargetingMode, setPushTargetingMode] = useState<'single' | 'batch' | 'all'>('single');
  const [selectedClinicIds, setSelectedClinicIds] = useState<Set<string>>(new Set());

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

    // Wait for clinic-points layer to exist before adding boundaries
    // This fixes the race condition where boundaries could render on top of points
    const waitForPointsLayer = async (): Promise<void> => {
      for (let i = 0; i < 50; i++) { // Max 5 seconds wait
        if (map.current?.getLayer('clinic-points')) {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      console.warn('clinic-points layer not found after timeout, proceeding anyway');
    };

    await waitForPointsLayer();

    const batchSize = 25;
    let offset = 0;
    let allBoundaryFeatures: GeoJSON.Feature[] = [];

    // Initialize boundary source and layers
    if (!map.current.getSource('clinic-boundaries')) {
      map.current.addSource('clinic-boundaries', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Determine beforeId - use clinic-points if it exists, otherwise undefined
      const beforeId = map.current.getLayer('clinic-points') ? 'clinic-points' : undefined;

      map.current.addLayer({
        id: 'clinic-boundaries-fill',
        type: 'fill',
        source: 'clinic-boundaries',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.4
        }
      }, beforeId); // Insert below points

      map.current.addLayer({
        id: 'clinic-boundaries-line',
        type: 'line',
        source: 'clinic-boundaries',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.8
        }
      }, beforeId);

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

      // Ensure points and labels are on top of boundaries
      if (map.current.getLayer('clinic-points')) {
        map.current.moveLayer('clinic-points');
      }
      if (map.current.getLayer('clinic-labels')) {
        map.current.moveLayer('clinic-labels');
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

  const startEditing = async () => {
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
      defaultMode: 'simple_select'
    });

    map.current.addControl(draw.current);

    // Try to get geometry from clinic object first
    let geometry = getGeometry(selectedClinic);

    // If not available, fetch boundary on-demand
    if (!geometry) {
      setSaveStatus('Loading boundary...');
      try {
        const boundaryResponse = await fetch(`/api/boundaries?clinic_id=${selectedClinic.clinic_id}`);
        if (boundaryResponse.ok) {
          const boundaryData = await boundaryResponse.json();
          if (boundaryData.boundaries && boundaryData.boundaries.length > 0) {
            const geojson = boundaryData.boundaries[0].geojson;
            if (geojson && 'type' in geojson && 'coordinates' in geojson) {
              geometry = geojson as GeoJSONGeometry;
            }
          }
        }
      } catch (e) {
        console.error('Error fetching boundary:', e);
      }
      setSaveStatus('');
    }

    if (geometry) {
      // Ensure geometry is a Polygon (not MultiPolygon)
      let polygonGeometry = geometry;
      if (geometry.type === 'MultiPolygon') {
        // Use the first polygon from MultiPolygon
        polygonGeometry = {
          type: 'Polygon' as const,
          coordinates: (geometry.coordinates as number[][][][])[0]
        };
      }

      const feature = {
        type: 'Feature' as const,
        geometry: polygonGeometry,
        properties: {}
      };
      const featureIds = draw.current.add(feature as GeoJSON.Feature);

      // Select the feature in simple_select mode first (shows filled polygon)
      // User can double-click to enter direct_select mode for vertex editing
      if (featureIds && featureIds.length > 0) {
        setTimeout(() => {
          if (draw.current) {
            // Select the feature to highlight it
            draw.current.changeMode('simple_select', { featureIds: [featureIds[0]] });
          }
        }, 100);
      }
    } else {
      // No boundary exists - start in draw mode
      draw.current.changeMode('draw_polygon');
      alert('No existing boundary found. Draw a new boundary on the map.');
    }

    // Hide the boundary layers while editing so draw vertices are visible
    if (map.current.getLayer('clinic-boundaries-fill')) {
      map.current.setLayoutProperty('clinic-boundaries-fill', 'visibility', 'none');
    }
    if (map.current.getLayer('clinic-boundaries-line')) {
      map.current.setLayoutProperty('clinic-boundaries-line', 'visibility', 'none');
    }

    // Clear previous chat messages when starting new edit session
    setEditChatMessages([]);
    setEditChatInput('');
    setIsEditing(true);
  };

  // Select a specific isochrone preset from raw_geojson
  const selectIsochronePreset = async (isochroneIndex: number) => {
    if (!selectedClinic || !draw.current) return;

    setSaveStatus('Loading isochrone...');

    try {
      // Fetch the clinic's raw_geojson which contains all isochrones
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/clinic_territories?clinic_id=eq.${selectedClinic.clinic_id}&select=raw_geojson`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch isochrones');
      }

      const data = await response.json();
      if (!data[0]?.raw_geojson) {
        alert('No isochrone data available for this clinic');
        setSaveStatus('');
        return;
      }

      const rawGeojson = typeof data[0].raw_geojson === 'string'
        ? JSON.parse(data[0].raw_geojson)
        : data[0].raw_geojson;

      if (rawGeojson.type !== 'FeatureCollection' || !rawGeojson.features?.length) {
        alert('Invalid isochrone data format');
        setSaveStatus('');
        return;
      }

      // Get the requested isochrone (0=30min, 1=20min, 2=15min, 3=10min)
      const feature = rawGeojson.features[isochroneIndex];
      if (!feature?.geometry) {
        alert(`Isochrone ${isochroneIndex} not available`);
        setSaveStatus('');
        return;
      }

      let geometry = feature.geometry;

      // Convert MultiPolygon to Polygon if needed
      if (geometry.type === 'MultiPolygon') {
        geometry = {
          type: 'Polygon',
          coordinates: geometry.coordinates[0]
        };
      }

      // Clear existing and add new
      draw.current.deleteAll();
      const featureIds = draw.current.add({
        type: 'Feature',
        geometry: geometry,
        properties: {}
      } as GeoJSON.Feature);

      if (featureIds?.length > 0) {
        draw.current.changeMode('simple_select', { featureIds: [featureIds[0]] });
      }

      const labels = ['30-minute', '20-minute', '15-minute', '10-minute'];
      setSaveStatus(`Loaded ${labels[isochroneIndex]} drive time`);
      setTimeout(() => setSaveStatus(''), 2000);

    } catch (error) {
      console.error('Error loading isochrone:', error);
      alert('Failed to load isochrone: ' + (error as Error).message);
      setSaveStatus('');
    }
  };

  // Handle adding a new location
  const handleAddLocation = async () => {
    const { clinic_name, clinic_id, address } = newLocationForm;

    if (!clinic_name.trim() || !clinic_id.trim() || !address.trim()) {
      alert('Please fill in all fields');
      return;
    }

    setAddingLocation(true);

    try {
      const response = await fetch('/api/clinics/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinic_name: clinic_name.trim(),
          clinic_id: clinic_id.trim(),
          address: address.trim(),
          resolve_overlaps: true
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to add location');
      }

      alert(result.message);

      // Reset form and close panel
      setNewLocationForm({ clinic_name: '', clinic_id: '', address: '' });
      setShowAddLocation(false);

      // Reload clinics to show the new one
      loadClinics();

      // Fly to the new location
      if (result.clinic?.longitude && result.clinic?.latitude && map.current) {
        map.current.flyTo({
          center: [result.clinic.longitude, result.clinic.latitude],
          zoom: 10,
          duration: 2000
        });
      }

    } catch (error) {
      alert('Error adding location: ' + (error as Error).message);
    } finally {
      setAddingLocation(false);
    }
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
      const jsonMatch = assistantMessage.match(/\{"action":\s*"modify_boundary"[\s\S]*?"geometry":\s*(\{[\s\S]*\})\}/);
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

    try {
      // Use our custom save endpoint that handles PostGIS geometry
      const response = await fetch('/api/boundaries/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clinic_id: selectedClinic.clinic_id,
          geometry: newGeometry
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setSaveStatus('success');
        setIsEditing(false);
        if (draw.current && map.current) {
          map.current.removeControl(draw.current);
          draw.current = null;

          // Restore boundary layers visibility
          if (map.current.getLayer('clinic-boundaries-fill')) {
            map.current.setLayoutProperty('clinic-boundaries-fill', 'visibility', 'visible');
          }
          if (map.current.getLayer('clinic-boundaries-line')) {
            map.current.setLayoutProperty('clinic-boundaries-line', 'visibility', 'visible');
          }
        }
        setTimeout(() => {
          loadClinics();
          setSaveStatus('');
        }, 2000);
      } else {
        setSaveStatus('error');
        alert('Failed to save boundary: ' + (result.error || 'Unknown error'));
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

      // Restore boundary layers visibility
      if (map.current.getLayer('clinic-boundaries-fill')) {
        map.current.setLayoutProperty('clinic-boundaries-fill', 'visibility', 'visible');
      }
      if (map.current.getLayer('clinic-boundaries-line')) {
        map.current.setLayoutProperty('clinic-boundaries-line', 'visibility', 'visible');
      }
    }
  };

  const getFacebookAddress = async (latitude: number, longitude: number): Promise<string> => {
    const formatForFacebook = (placeName: string): string => {
      return placeName.replace(/, United States$/, '');
    };

    const fetchAddress = async (lng: number, lat: number): Promise<string | null> => {
      const resp = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address&limit=1`
      );
      const data = await resp.json();
      if (data.features?.length > 0) {
        return formatForFacebook(data.features[0].place_name);
      }
      return null;
    };

    try {
      // Search for a street address in expanding rings up to 50 miles
      // Cardinal directions first, then diagonals at each distance
      const distances = [0, 0.5, 1, 2, 3, 5, 8, 12, 18, 25, 35, 50];

      for (const dist of distances) {
        if (dist === 0) {
          // Exact point
          const exact = await fetchAddress(longitude, latitude);
          if (exact) return exact;
          continue;
        }

        const offsetDeg = dist / 69;
        const offsetLng = dist / (69 * Math.cos(latitude * Math.PI / 180));

        // Cardinal directions (N, S, E, W)
        const cardinals = [
          { lat: latitude + offsetDeg, lng: longitude },
          { lat: latitude - offsetDeg, lng: longitude },
          { lat: latitude, lng: longitude + offsetLng },
          { lat: latitude, lng: longitude - offsetLng },
        ];

        for (const offset of cardinals) {
          const addr = await fetchAddress(offset.lng, offset.lat);
          if (addr) return addr;
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Diagonal directions (NE, NW, SE, SW)
        const diagFactor = dist * 0.707;
        const diagLatOff = diagFactor / 69;
        const diagLngOff = diagFactor / (69 * Math.cos(latitude * Math.PI / 180));

        const diagonals = [
          { lat: latitude + diagLatOff, lng: longitude + diagLngOff },
          { lat: latitude + diagLatOff, lng: longitude - diagLngOff },
          { lat: latitude - diagLatOff, lng: longitude + diagLngOff },
          { lat: latitude - diagLatOff, lng: longitude - diagLngOff },
        ];

        for (const offset of diagonals) {
          const addr = await fetchAddress(offset.lng, offset.lat);
          if (addr) return addr;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // Exhausted 50-mile search — should not happen in populated US areas
      console.error(`No street address found within 50mi of ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
      return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    } catch (error) {
      console.error('Geocoding error:', error);
      return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
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

      // Debug: log the geometry structure
      console.log('Geometry Debug:', {
        type: geometry.type,
        coordinatesLength: geometry.coordinates?.length,
        firstCoordSample: JSON.stringify(Array.isArray(geometry.coordinates?.[0]) ? (geometry.coordinates[0] as unknown[]).slice(0, 2) : geometry.coordinates?.[0])
      });

      // Handle different geometry types - collect ALL polygon rings for MultiPolygon
      let allPolygonRings: number[][][] = [];
      const allPolygonHoles: number[][][] = [];
      if (geometry.type === 'Polygon') {
        const polyCoords = geometry.coordinates as number[][][];
        allPolygonRings = [polyCoords[0]];
        if (polyCoords.length > 1) {
          for (const hole of polyCoords.slice(1)) {
            if (hole && hole.length > 3) allPolygonHoles.push(hole);
          }
        }
      } else if (geometry.type === 'MultiPolygon') {
        // Collect ALL polygon outer rings - don't just use the largest!
        const multiPolygons = geometry.coordinates as number[][][][];
        for (const polygon of multiPolygons) {
          if (polygon[0] && polygon[0].length > 3) {
            allPolygonRings.push(polygon[0]);
            if (polygon.length > 1) {
              for (const hole of polygon.slice(1)) {
                if (hole && hole.length > 3) allPolygonHoles.push(hole);
              }
            }
          }
        }
        console.log(`MultiPolygon: Processing ${allPolygonRings.length} outer rings, ${allPolygonHoles.length} holes`);
      } else {
        console.error('Unexpected geometry type:', geometry.type);
        allPolygonRings = [(geometry.coordinates as number[][][])[0] || []];
      }

      // For compatibility, use the first/largest ring as primary coords
      // But we'll check against ALL rings for point-in-polygon tests
      const coords = allPolygonRings.reduce((largest, ring) =>
        ring.length > largest.length ? ring : largest, allPolygonRings[0]);

      // Helper to check if point is in ANY of the polygon rings (and not in a hole)
      const isPointInAnyPolygon = (testLng: number, testLat: number): boolean => {
        for (const hole of allPolygonHoles) {
          if (isPointInPolygon([testLng, testLat], hole as [number, number][])) {
            return false;
          }
        }
        for (const ring of allPolygonRings) {
          if (isPointInPolygon([testLng, testLat], ring as [number, number][])) {
            return true;
          }
        }
        return false;
      };

      // Distance to nearest territory edge (outer rings + holes treated as edges to avoid)
      const distanceToTerritoryEdge = (testLat: number, testLng: number): number => {
        let dist = Infinity;
        for (const ring of allPolygonRings) {
          const r = getDistanceToPolygonEdge(testLat, testLng, ring);
          if (r < dist) dist = r;
        }
        for (const hole of allPolygonHoles) {
          const r = getDistanceToPolygonEdge(testLat, testLng, hole);
          if (r < dist) dist = r;
        }
        return dist;
      };

      // Adaptive include radius: keep ~85% of circle inside the polygon.
      // distToEdge * 1.15 allows a small overspill, capped at the metro-tuned optimalRadius.
      const adaptiveIncludeRadius = (distToEdge: number, maxRadius: number): number => {
        const target = Math.max(1, Math.min(maxRadius, Math.round(distToEdge * 1.15)));
        return target;
      };

      console.log('Coords Debug:', {
        coordsLength: coords?.length,
        firstCoord: coords?.[0],
        lastCoord: coords?.[coords?.length - 1]
      });

      // Calculate bounding box across ALL polygon rings
      const allLats: number[] = [];
      const allLngs: number[] = [];
      for (const ring of allPolygonRings) {
        for (const coord of ring) {
          allLngs.push(coord[0]);
          allLats.push(coord[1]);
        }
      }
      const minLat = Math.min(...allLats);
      const maxLat = Math.max(...allLats);
      const minLng = Math.min(...allLngs);
      const maxLng = Math.max(...allLngs);

      console.log('Bounds Debug:', { minLat, maxLat, minLng, maxLng, polygonCount: allPolygonRings.length });

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
      // Reserve slots for neighbor exclusions + cardinal exclusions
      const MAX_TOTAL_POINTS = 25;
      const MAX_NEIGHBOR_EXCLUSIONS = 6; // Reserve up to 6 slots for nearby clinic exclusions
      const MAX_CARDINAL_EXCLUSIONS = 4; // 4 cardinal direction exclusions (reduced from 8)
      const MAX_EXCLUSIONS = MAX_NEIGHBOR_EXCLUSIONS + MAX_CARDINAL_EXCLUSIONS;
      const MAX_INCLUSIONS = MAX_TOTAL_POINTS - MAX_EXCLUSIONS; // 15 inclusions

      const metroLower = metroType.toLowerCase();

      // Convert miles to degrees
      const milesToDegreesLat = (miles: number) => miles / 69;
      const milesToDegreesLng = (miles: number, atLat: number) => miles / (69 * Math.cos(atLat * Math.PI / 180));

      // =================================================================
      // COVERAGE-FIRST ALGORITHM: Hexagonal grid with overlapping circles
      // Target: >85% coverage, accept up to 25% overspill
      // =================================================================

      // Step 1: Calculate polygon area for optimal radius calculation
      let totalPolygonArea = 0;
      for (const ring of allPolygonRings) {
        totalPolygonArea += calculatePolygonArea(ring);
      }
      console.log(`Polygon area: ${totalPolygonArea.toFixed(1)} sq mi`);

      // Step 2: Calculate optimal radius for coverage
      // This gives us a fixed radius that ensures overlapping circles for continuous coverage
      const optimalRadius = calculateOptimalRadius(totalPolygonArea, MAX_INCLUSIONS, 1.5, metroType);
      console.log(`Optimal radius for coverage: ${optimalRadius} mi`);

      // Step 3: Calculate hex grid spacing for ~50% overlap between adjacent circles
      // Spacing = radius * 1.5 gives good overlap
      const hexSpacing = optimalRadius * 1.5;

      // Step 4: Generate hexagonal grid covering the bounding box
      const gridPoints = generateHexGrid(
        { minLat, maxLat, minLng, maxLng },
        hexSpacing,
        lat
      );
      console.log(`Generated ${gridPoints.length} hex grid points`);

      // Step 5: Filter and score grid points
      interface ScoredPoint {
        lat: number;
        lng: number;
        radius: number;
        score: number;
        distToEdge: number;
        distToClinic: number;
        isPerimeter: boolean;
      }

      const scoredPoints: ScoredPoint[] = [];

      for (const point of gridPoints) {
        // Only consider candidates strictly inside the territory polygon (and not in a hole).
        // Boundary coverage is handled separately by perimeter gap-fillers below.
        if (!isPointInAnyPolygon(point.lng, point.lat)) continue;

        const distToEdge = distanceToTerritoryEdge(point.lat, point.lng);
        const distToClinic = calculateDistance(lat, lng, point.lat, point.lng);

        // Adaptive radius sized to the local polygon thickness so the circle hugs the shape.
        const adaptiveRadius = adaptiveIncludeRadius(distToEdge, optimalRadius);

        // Score: deep-interior points highest, near-edge slightly lower (smaller circles still useful).
        let score: number;
        if (distToEdge >= optimalRadius * 0.5) {
          score = 100 + distToEdge;
        } else {
          score = 60 + distToEdge * 5;
        }

        // Penalty for being too close to clinic pin (already covered by clinic include circle).
        if (distToClinic < optimalRadius * 0.5) {
          score *= 0.3;
        }

        scoredPoints.push({
          lat: point.lat,
          lng: point.lng,
          radius: adaptiveRadius,
          score,
          distToEdge,
          distToClinic,
          isPerimeter: distToEdge < optimalRadius * 0.3
        });
      }

      console.log(`Scored ${scoredPoints.length} candidate points`);

      // Step 6: Select top N points with spatial distribution
      // Sort by score (highest first)
      scoredPoints.sort((a, b) => b.score - a.score);

      interface InclusionPoint {
        lat: number;
        lng: number;
        radius: number;
        distFromCenter: number;
        distFromBoundary: number;
      }

      const selectedPoints: InclusionPoint[] = [];

      // Always add the clinic pin first; size by local polygon thickness so it hugs the shape.
      const clinicDistToEdge = distanceToTerritoryEdge(lat, lng);
      selectedPoints.push({
        lat: lat,
        lng: lng,
        radius: adaptiveIncludeRadius(clinicDistToEdge, optimalRadius),
        distFromCenter: 0,
        distFromBoundary: clinicDistToEdge
      });

      // Spacing scales with the larger of the two circles, so small boundary circles can pack
      // tightly without redundant overlap among large interior circles.
      const isTooClose = (testLat: number, testLng: number, testRadius: number): boolean => {
        for (const selected of selectedPoints) {
          const dist = calculateDistance(testLat, testLng, selected.lat, selected.lng);
          const minSep = Math.max(selected.radius, testRadius) * 0.7;
          if (dist < minSep) return true;
        }
        return false;
      };

      // Select points, prioritizing by score
      for (const candidate of scoredPoints) {
        if (selectedPoints.length >= MAX_INCLUSIONS) break;

        if (!isTooClose(candidate.lat, candidate.lng, candidate.radius)) {
          selectedPoints.push({
            lat: candidate.lat,
            lng: candidate.lng,
            radius: candidate.radius,
            distFromCenter: candidate.distToClinic,
            distFromBoundary: candidate.distToEdge
          });
        }
      }

      // Step 7: Add perimeter gap-fillers with adaptive radii if we have slots left.
      // These hug the boundary so thin extensions of the polygon get small (1-2mi) circles
      // instead of larger circles that bulge outside the shape.
      if (selectedPoints.length < MAX_INCLUSIONS) {
        const perimeterGapFillers: Array<{ lat: number; lng: number }> = [];
        const pointsPerRing = Math.max(4, Math.floor(20 / allPolygonRings.length));

        // Offset inward by ~1 mi so the sample points are inside the polygon.
        const perimeterInset = Math.max(0.5, Math.min(1.5, optimalRadius * 0.4));
        for (const ring of allPolygonRings) {
          const ringPoints = samplePolygonPerimeter(ring, pointsPerRing, perimeterInset);
          perimeterGapFillers.push(...ringPoints);
        }

        // Cap perimeter circles smaller than interior hex circles to limit overspill.
        const perimeterMaxRadius = Math.max(1, Math.min(3, Math.round(optimalRadius * 0.6)));

        for (const perimPt of perimeterGapFillers) {
          if (selectedPoints.length >= MAX_INCLUSIONS) break;

          if (!isPointInAnyPolygon(perimPt.lng, perimPt.lat)) continue;

          const distToEdge = distanceToTerritoryEdge(perimPt.lat, perimPt.lng);
          const perimRadius = adaptiveIncludeRadius(distToEdge, perimeterMaxRadius);

          if (isTooClose(perimPt.lat, perimPt.lng, perimRadius)) continue;

          selectedPoints.push({
            lat: perimPt.lat,
            lng: perimPt.lng,
            radius: perimRadius,
            distFromCenter: calculateDistance(lat, lng, perimPt.lat, perimPt.lng),
            distFromBoundary: distToEdge
          });
        }
      }

      // Combine all selected points
      const distributedInclusions = selectedPoints;

      // Debug logging
      console.log('FB Targeting Debug (Coverage-First Algorithm):', {
        territorySize: `${territoryWidth.toFixed(1)} x ${territoryHeight.toFixed(1)} miles`,
        polygonArea: `${totalPolygonArea.toFixed(1)} sq mi`,
        optimalRadius: `${optimalRadius} mi`,
        hexSpacing: `${hexSpacing.toFixed(1)} mi`,
        gridPointsGenerated: gridPoints.length,
        scoredCandidates: scoredPoints.length,
        finalInclusions: distributedInclusions.length,
        algorithm: 'Coverage-first hex grid with overlapping circles',
        targetCoverage: '>85%',
        acceptableOverspill: '<25%',
        radiusBreakdown: distributedInclusions.reduce((acc, p) => {
          acc[p.radius] = (acc[p.radius] || 0) + 1;
          return acc;
        }, {} as Record<number, number>)
      });

      // For exclusion calculation - use optimal inclusion radius
      const actualMaxInclusionRadius = optimalRadius;
      const minExclusionDistance = actualMaxInclusionRadius + neutralBuffer + 10;

      setSaveStatus('generating boundary exclusion points...');

      // OUTER LAYER: Build exclusion zone with 8 points:
      // - 4 corner points (SW, SE, NW, NE) at 45mi radius
      // - 4 intermediate points (S, W, N, E) at 30mi radius

      // Distance from clinic to corner exclusions (diagonal)
      const cornerDistance = neutralBuffer + 50 + (territorySize / 2);
      // Distance from clinic to intermediate exclusions (cardinal directions)
      const cardinalDistance = neutralBuffer + 40 + (territorySize / 2);

      // Build exclusion ring FIRST - these are essential for proper targeting
      // 8 overlapping circles create a donut-shaped exclusion zone around the territory
      const exclusionPoints: Array<{ lat: number; lng: number; radius: number; name: string }> = [];

      // 4 CORNER points (SW, SE, NW, NE) at 45mi radius - diagonal positions
      const cornerExclusions = [
        { lat: lat - milesToDegreesLat(cornerDistance * 0.707), lng: lng - milesToDegreesLng(cornerDistance * 0.707, lat), radius: 45, name: 'Southwest' },
        { lat: lat - milesToDegreesLat(cornerDistance * 0.707), lng: lng + milesToDegreesLng(cornerDistance * 0.707, lat), radius: 45, name: 'Southeast' },
        { lat: lat + milesToDegreesLat(cornerDistance * 0.707), lng: lng - milesToDegreesLng(cornerDistance * 0.707, lat), radius: 45, name: 'Northwest' },
        { lat: lat + milesToDegreesLat(cornerDistance * 0.707), lng: lng + milesToDegreesLng(cornerDistance * 0.707, lat), radius: 45, name: 'Northeast' }
      ];

      // 4 CARDINAL points (S, W, N, E) at 30mi radius
      const cardinalExclusions = [
        { lat: lat - milesToDegreesLat(cardinalDistance), lng: lng, radius: 30, name: 'South' },
        { lat: lat, lng: lng - milesToDegreesLng(cardinalDistance, lat), radius: 30, name: 'West' },
        { lat: lat + milesToDegreesLat(cardinalDistance), lng: lng, radius: 30, name: 'North' },
        { lat: lat, lng: lng + milesToDegreesLng(cardinalDistance, lat), radius: 30, name: 'East' }
      ];

      // Add all 8 exclusion ring points first (these are mandatory)
      for (const corner of cornerExclusions) {
        exclusionPoints.push(corner);
      }
      for (const cardinal of cardinalExclusions) {
        exclusionPoints.push(cardinal);
      }

      console.log(`Added 8-point exclusion ring (4 corners at 45mi, 4 cardinals at 30mi)`);

      // Add neighbor clinic exclusions only if we have remaining slots (max 10 total)
      const MAX_NEIGHBOR_DISTANCE = 15; // miles
      const NEIGHBOR_EXCLUSION_RADIUS = 1; // miles
      const remainingSlots = MAX_EXCLUSIONS - exclusionPoints.length;

      if (remainingSlots > 0) {
        const neighborExclusions: Array<{ lat: number; lng: number; radius: number; name: string }> = [];

        for (const clinic of clinics) {
          if (clinic.clinic_id === selectedClinic.clinic_id) continue;
          if (!clinic.latitude || !clinic.longitude) continue;

          const neighborLat = Number(clinic.latitude);
          const neighborLng = Number(clinic.longitude);
          const distanceToNeighbor = calculateDistance(lat, lng, neighborLat, neighborLng);

          if (distanceToNeighbor <= MAX_NEIGHBOR_DISTANCE) {
            neighborExclusions.push({
              lat: neighborLat,
              lng: neighborLng,
              radius: NEIGHBOR_EXCLUSION_RADIUS,
              name: `${clinic.clinic_name} clinic`
            });
          }
        }

        // Add up to remaining slots
        for (let i = 0; i < Math.min(remainingSlots, neighborExclusions.length); i++) {
          exclusionPoints.push(neighborExclusions[i]);
        }

        console.log(`Added ${Math.min(remainingSlots, neighborExclusions.length)} neighbor exclusions (${neighborExclusions.length} found, ${remainingSlots} slots available)`);
      }

      const distributedExclusions = exclusionPoints.slice(0, MAX_EXCLUSIONS);
      console.log(`Total exclusions: ${distributedExclusions.length}`);

      setSaveStatus('geocoding addresses...');

      // Layer type definitions
      interface LayerCircle {
        name: string;
        address: string;
        coordinates: string;
        latitude: number;
        longitude: number;
        radius: number;
        distance_unit: string;
        layer_type: 'include' | 'neutral' | 'exclude';
      }

      const innerLayer: LayerCircle[] = [];      // Include zone - INSIDE territory
      const middleLayer: LayerCircle[] = [];     // Neutral zone - documentation only
      const outerLayer: LayerCircle[] = [];      // Exclusion donut - OUTSIDE territory

      // Process inclusion points - resolve to real street addresses for Facebook
      const clinicAddress = selectedClinic.address
        ? `${selectedClinic.address}, ${selectedClinic.city || ''}, ${selectedClinic.state || ''}`.trim().replace(/, United States$/, '')
        : await getFacebookAddress(lat, lng);

      for (let i = 0; i < distributedInclusions.length; i++) {
        const point = distributedInclusions[i];

        setSaveStatus(`resolving addresses... ${i + 1}/${distributedInclusions.length}`);

        const address = i === 0
          ? clinicAddress
          : await getFacebookAddress(point.lat, point.lng);

        innerLayer.push({
          name: i === 0 ? `Clinic: ${selectedClinic.clinic_name}` : `Include ${i} (${point.radius}mi)`,
          address: address,
          coordinates: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`,
          latitude: point.lat,
          longitude: point.lng,
          radius: point.radius,
          distance_unit: 'mile',
          layer_type: 'include'
        });

        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Process exclusion points (outer layer)
      for (let i = 0; i < distributedExclusions.length; i++) {
        const point = distributedExclusions[i];
        if (!point) continue;

        setSaveStatus(`resolving exclusions... ${i + 1}/${distributedExclusions.length}`);
        const address = await getFacebookAddress(point.lat, point.lng);

        outerLayer.push({
          name: `${point.name} Exclusion`,
          address: address,
          coordinates: `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`,
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

      // Build output file — grouped by radius with section headers
      const lines: string[] = [];

      // Calculate coverage stats
      let circleCoverageInside = 0;
      let circleCoverageOutside = 0;
      for (const pt of distributedInclusions) {
        const circleArea = Math.PI * pt.radius * pt.radius;
        // Estimate inside vs outside based on distance from center relative to territory
        const coverageRatio = Math.min(1, totalPolygonArea / (circleArea * distributedInclusions.length));
        circleCoverageInside += circleArea * coverageRatio;
        circleCoverageOutside += circleArea * (1 - coverageRatio);
      }
      const coveragePct = Math.min(100, Math.round(circleCoverageInside / totalPolygonArea * 100));
      const overspillPct = Math.round(circleCoverageOutside / (circleCoverageInside + circleCoverageOutside) * 100);

      // Build radius breakdown string
      const radiusCounts: Record<number, number> = {};
      for (const loc of sortedInclusions) {
        radiusCounts[loc.radius] = (radiusCounts[loc.radius] || 0) + 1;
      }
      const includeBreakdown = Object.entries(radiusCounts)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([r, c]) => `${c}x${r}mi`)
        .join(', ');

      // Exclusion radii summary
      const excludeRadii = Array.from(new Set(sortedExclusions.map(e => e.radius))).sort((a, b) => a - b);
      const excludeBreakdownStr = excludeRadii.map(r => `${r} mi`).join(', ');

      lines.push(`Facebook Audience Targeting - Polygon Coverage`);
      lines.push(`Clinic: ${selectedClinic.clinic_name} (${selectedClinic.clinic_id})`);
      lines.push(`Metro Type: ${metroType}`);
      lines.push(`Generated: ${new Date().toLocaleString()}`);
      lines.push('');
      lines.push('COVERAGE ANALYSIS');
      lines.push(`  Territory Size: ${territoryWidth.toFixed(1)} x ${territoryHeight.toFixed(1)} miles`);
      lines.push(`  Polygon Area: ~${totalPolygonArea.toFixed(1)} sq mi`);
      lines.push(`  Circle Coverage Inside Polygon: ~${circleCoverageInside.toFixed(1)} sq mi`);
      lines.push(`  Circle Overspill Outside Polygon: ~${circleCoverageOutside.toFixed(1)} sq mi`);
      lines.push(`  Coverage of Territory: ${coveragePct}%`);
      lines.push(`  Overspill Rate: ${overspillPct}% (lower is better)`);
      lines.push('');
      lines.push('POINT SUMMARY');
      lines.push(`  Algorithm: Coverage-first hex grid (overlapping circles)`);
      lines.push(`  Optimal Radius: ${optimalRadius} mi (based on ${Math.round(totalPolygonArea)} sq mi territory)`);
      lines.push(`  Include Breakdown: ${includeBreakdown}`);
      lines.push(`  Exclude Radii: ${excludeBreakdownStr}`);
      lines.push(`  Include Points: ${sortedInclusions.length}`);
      lines.push(`  Exclude Points: ${sortedExclusions.length}`);
      lines.push(`  Total Points: ${sortedInclusions.length + sortedExclusions.length} / 25 max`);
      lines.push(`  Target Coverage: >85% | Acceptable Overspill: <25%`);
      lines.push('');
      lines.push('============================================================');
      lines.push(`INCLUDE LOCATIONS (${sortedInclusions.length} points)`);
      lines.push('============================================================');
      lines.push('');

      // Group inclusions by radius
      const inclusionsByRadius: Record<number, typeof sortedInclusions> = {};
      for (const loc of sortedInclusions) {
        if (!inclusionsByRadius[loc.radius]) inclusionsByRadius[loc.radius] = [];
        inclusionsByRadius[loc.radius].push(loc);
      }

      for (const radius of Object.keys(inclusionsByRadius).map(Number).sort((a, b) => a - b)) {
        lines.push(`${radius} mi radius:`);
        const addresses = inclusionsByRadius[radius]
          .map(loc => loc.address)
          .sort();
        for (const addr of addresses) {
          lines.push(addr);
        }
        lines.push('');
      }

      lines.push('============================================================');
      lines.push(`EXCLUDE LOCATIONS (${sortedExclusions.length} points)`);
      lines.push('============================================================');
      lines.push('');

      // Group exclusions by radius
      const exclusionsByRadius: Record<number, typeof sortedExclusions> = {};
      for (const loc of sortedExclusions) {
        if (!exclusionsByRadius[loc.radius]) exclusionsByRadius[loc.radius] = [];
        exclusionsByRadius[loc.radius].push(loc);
      }

      for (const radius of Object.keys(exclusionsByRadius).map(Number).sort((a, b) => a - b)) {
        lines.push(`${radius} mi radius:`);
        const addresses = exclusionsByRadius[radius]
          .map(loc => loc.address)
          .sort();
        for (const addr of addresses) {
          lines.push(addr);
        }
        lines.push('');
      }

      lines.push('============================================================');
      lines.push(`TOTAL POINTS: ${sortedInclusions.length + sortedExclusions.length} / 25`);
      lines.push('============================================================');

      // Persist FB Graph targeting payload to clinic_territories.fb_geo_locations
      // so the Push to Facebook button uses the latest algorithm output, not stale data.
      setSaveStatus('saving targeting to database...');
      const fbPayload = {
        geo_locations: {
          custom_locations: sortedInclusions.map(loc => ({
            latitude: loc.latitude,
            longitude: loc.longitude,
            radius: loc.radius,
            distance_unit: 'mile',
            name: loc.address,
          })),
          location_types: ['home', 'recent'],
        },
        excluded_geo_locations: {
          custom_locations: sortedExclusions.map(loc => ({
            latitude: loc.latitude,
            longitude: loc.longitude,
            radius: loc.radius,
            distance_unit: 'mile',
            name: loc.address,
          })),
        },
      };
      try {
        const saveRes = await fetch('/api/clinics/save-fb-targeting', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clinic_id: selectedClinic.clinic_id,
            fb_geo_locations: fbPayload,
          }),
        });
        if (!saveRes.ok) {
          const err = await saveRes.json().catch(() => ({}));
          console.error('Save targeting failed:', err);
          alert(`Targeting generated but not saved to database: ${err.error || saveRes.statusText}. The TXT export will still download, but Push to Facebook will use stale data.`);
        }
      } catch (saveErr) {
        console.error('Save targeting network error:', saveErr);
        alert('Targeting generated but failed to save to database. TXT export will still download.');
      }

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

  const pushTargetingToFacebook = async (mode: 'single' | 'batch' | 'all') => {
    let clinicIds: string[] = [];

    if (mode === 'single') {
      if (!selectedClinic) return;
      clinicIds = [selectedClinic.clinic_id];
    } else if (mode === 'batch') {
      clinicIds = Array.from(selectedClinicIds);
      if (clinicIds.length === 0) {
        alert('No clinics selected. Use checkboxes to select clinics first.');
        return;
      }
    }
    // mode === 'all' sends no clinic_ids, API resolves them

    setPushTargetingStatus('pushing');
    setPushTargetingResult(null);

    try {
      const response = await fetch('/api/facebook/push-targeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          clinic_ids: mode !== 'all' ? clinicIds : undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setPushTargetingResult({ success: false, error: result.error || 'Unknown error' });
      } else {
        setPushTargetingResult(result);
      }
    } catch (error) {
      setPushTargetingResult({ success: false, error: (error as Error).message });
    } finally {
      setPushTargetingStatus('done');
    }
  };

  const toggleClinicSelection = (clinicId: string) => {
    setSelectedClinicIds(prev => {
      const next = new Set(prev);
      if (next.has(clinicId)) {
        next.delete(clinicId);
      } else {
        next.add(clinicId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedClinicIds.size === filteredClinics.length) {
      setSelectedClinicIds(new Set());
    } else {
      setSelectedClinicIds(new Set(filteredClinics.map(c => c.clinic_id)));
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

        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolve_overlaps_with_buffer`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            p_state: state || null,
            p_batch_size: batchSize,
            p_buffer_miles: 2.0
          })
        });

        if (response.ok) {
          const results = await response.json();
          // Count only successfully updated clinics (where second element is true)
          const resolved = Array.isArray(results)
            ? results.filter((r: [string, boolean, string]) => r[1] === true).length
            : 0;
          const totalProcessed = Array.isArray(results) ? results.length : 0;
          totalResolved += resolved;

          setSaveStatus(`resolving (${totalResolved} updated)`);

          // Stop if no clinics were processed or batch is incomplete
          if (totalProcessed === 0 || totalProcessed < batchSize) {
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
              onClick={() => setShowChurnRisk(true)}
              className="flex-1 bg-red-500 text-white px-3 py-2 rounded-lg hover:bg-red-600 text-sm"
            >
              Churn Risk
            </button>
          </div>

          <div className="flex gap-2 mt-2">
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

          <button
            onClick={() => setShowAddLocation(true)}
            className="mt-2 w-full bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600"
          >
            + Add New Location
          </button>

          {selectedClinicIds.size > 0 && (
            <button
              onClick={() => {
                setPushTargetingMode('batch');
                setPushTargetingStatus('confirming');
              }}
              disabled={pushTargetingStatus === 'pushing'}
              className="mt-2 w-full bg-green-600 text-white px-3 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400 text-sm"
            >
              Push {selectedClinicIds.size} Selected to Facebook
            </button>
          )}

          <button
            onClick={() => {
              setPushTargetingMode('all');
              setPushTargetingStatus('confirming');
            }}
            disabled={pushTargetingStatus === 'pushing'}
            className="mt-2 w-full bg-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-300 disabled:bg-gray-100 text-sm"
          >
            Push All Targeting to Facebook
          </button>

          <AIInsightsPanel
            supabaseUrl={SUPABASE_URL}
            supabaseKey={SUPABASE_KEY}
          />
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-700">
              {searchTerm ? `Found ${filteredClinics.length}` : `All Clinics (${clinics.length})`}
            </h2>
            <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedClinicIds.size === filteredClinics.length && filteredClinics.length > 0}
                onChange={toggleSelectAll}
                className="rounded border-gray-300"
              />
              Select All
            </label>
          </div>
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
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selectedClinicIds.has(clinic.clinic_id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleClinicSelection(clinic.clinic_id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 rounded border-gray-300"
                    />
                    <div>
                      <h3 className="font-semibold text-gray-800">{clinic.clinic_name}</h3>
                      <p className="text-sm text-gray-600">ID: {clinic.clinic_id}</p>
                      <p className="text-xs text-gray-500">{clinic.state} - {clinic.metro_type}</p>
                    </div>
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
                  <button
                    onClick={() => {
                      setPushTargetingMode('single');
                      setPushTargetingStatus('confirming');
                    }}
                    disabled={pushTargetingStatus === 'pushing'}
                    className="w-full flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 2L11 13"></path>
                      <path d="M22 2l-7 20-4-9-9-4 20-7z"></path>
                    </svg>
                    {pushTargetingStatus === 'pushing' ? 'Pushing...' : 'Push to Facebook'}
                  </button>
                </>
              ) : (
                <>
                  {/* Drive Time Presets */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                    <p className="text-xs text-blue-800 font-medium mb-2">Select Drive Time Boundary</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: '10 min', index: 3, type: 'Urban' },
                        { label: '15 min', index: 2, type: 'Urban' },
                        { label: '20 min', index: 1, type: 'Suburban' },
                        { label: '30 min', index: 0, type: 'Rural' },
                      ].map((option) => (
                        <button
                          key={option.index}
                          onClick={() => selectIsochronePreset(option.index)}
                          className={`px-2 py-1.5 text-xs rounded border ${
                            selectedClinic?.metro_type === option.type
                              ? 'bg-blue-500 text-white border-blue-500'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {option.label}
                          {selectedClinic?.metro_type === option.type && ' ✓'}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Current: {selectedClinic?.metro_type || 'Unknown'} metro type
                    </p>
                  </div>

                  {/* Draw New Option */}
                  <button
                    onClick={() => {
                      if (draw.current) {
                        draw.current.deleteAll();
                        draw.current.changeMode('draw_polygon');
                      }
                    }}
                    className="w-full mb-3 px-3 py-2 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
                  >
                    ✏️ Draw Custom Boundary
                  </button>

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

        {!selectedClinic && !showOverlapPanel && !showAddLocation && (
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

        {showAddLocation && (
          <div className="absolute top-4 left-4 bg-white rounded-lg shadow-xl p-6 w-96">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Add New Location</h2>
                <p className="text-sm text-gray-600 mt-1">Create a clinic with drive-time boundaries</p>
              </div>
              <button
                onClick={() => setShowAddLocation(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XIcon />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location Number (ID)
                </label>
                <input
                  type="text"
                  value={newLocationForm.clinic_id}
                  onChange={(e) => setNewLocationForm(f => ({ ...f, clinic_id: e.target.value }))}
                  placeholder="e.g., 12345"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Clinic Name
                </label>
                <input
                  type="text"
                  value={newLocationForm.clinic_name}
                  onChange={(e) => setNewLocationForm(f => ({ ...f, clinic_name: e.target.value }))}
                  placeholder="e.g., The Joint Chiropractic Downtown"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address
                </label>
                <input
                  type="text"
                  value={newLocationForm.address}
                  onChange={(e) => setNewLocationForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="e.g., 123 Main St, Dallas, TX 75201"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-800">
                  <strong>What happens:</strong><br/>
                  • Address will be geocoded to coordinates<br/>
                  • Drive-time isochrones (10/15/20/30 min) will be generated<br/>
                  • Metro type will be auto-detected<br/>
                  • Boundary will be set based on metro type<br/>
                  • <strong>Overlaps with nearby clinics will be resolved</strong>
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddLocation(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddLocation}
                  disabled={addingLocation}
                  className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-400"
                >
                  {addingLocation ? 'Creating...' : 'Create Location'}
                </button>
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

        {/* Push Targeting Confirmation / Results Modal */}
        {pushTargetingStatus !== 'idle' && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
              {pushTargetingStatus === 'confirming' && (
                <>
                  <h3 className="text-lg font-bold text-gray-800 mb-3">Push Targeting to Facebook</h3>
                  <p className="text-gray-600 mb-4">
                    {pushTargetingMode === 'single' && selectedClinic && (
                      <>Update targeting for <strong>{selectedClinic.clinic_name}</strong> on Facebook?</>
                    )}
                    {pushTargetingMode === 'batch' && (
                      <>Update targeting for <strong>{selectedClinicIds.size} selected clinics</strong> on Facebook?</>
                    )}
                    {pushTargetingMode === 'all' && (
                      <>Update targeting for <strong>all clinics with targeting data</strong> on Facebook? This may take several minutes.</>
                    )}
                  </p>
                  <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg mb-4">
                    This will replace the location targeting on all active ad sets in matching campaigns. Non-location targeting (age, interests, platforms) will be preserved.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setPushTargetingStatus('idle');
                        setPushTargetingResult(null);
                      }}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => pushTargetingToFacebook(pushTargetingMode)}
                      className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      Confirm Push
                    </button>
                  </div>
                </>
              )}

              {pushTargetingStatus === 'pushing' && (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
                  <p className="text-gray-700 font-medium">Pushing targeting to Facebook...</p>
                  <p className="text-sm text-gray-500 mt-2">This may take a few minutes for large batches.</p>
                </div>
              )}

              {pushTargetingStatus === 'done' && pushTargetingResult && (
                <>
                  <h3 className="text-lg font-bold text-gray-800 mb-3">
                    {pushTargetingResult.success ? 'Targeting Updated' : 'Update Failed'}
                  </h3>

                  {pushTargetingResult.error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-4">
                      {pushTargetingResult.error}
                    </div>
                  )}

                  {pushTargetingResult.summary && (
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="bg-green-50 p-3 rounded-lg text-center">
                        <p className="text-2xl font-bold text-green-700">{pushTargetingResult.summary.updated}</p>
                        <p className="text-xs text-green-600">Updated</p>
                      </div>
                      <div className="bg-yellow-50 p-3 rounded-lg text-center">
                        <p className="text-2xl font-bold text-yellow-700">{pushTargetingResult.summary.skipped}</p>
                        <p className="text-xs text-yellow-600">Skipped</p>
                      </div>
                      <div className="bg-red-50 p-3 rounded-lg text-center">
                        <p className="text-2xl font-bold text-red-700">{pushTargetingResult.summary.errors}</p>
                        <p className="text-xs text-red-600">Errors</p>
                      </div>
                    </div>
                  )}

                  {pushTargetingResult.results && pushTargetingResult.results.length > 0 && (
                    <div className="max-h-48 overflow-y-auto mb-4">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left p-2">Clinic</th>
                            <th className="text-left p-2">Status</th>
                            <th className="text-left p-2">Ad Sets</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pushTargetingResult.results.map((r) => (
                            <tr key={r.clinic_id} className="border-t">
                              <td className="p-2">{r.clinic_name}</td>
                              <td className="p-2">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                  r.status === 'updated' ? 'bg-green-100 text-green-700' :
                                  r.status === 'skipped' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {r.status}
                                </span>
                              </td>
                              <td className="p-2 text-gray-600">{r.adsets_updated ?? r.reason ?? '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setPushTargetingStatus('idle');
                      setPushTargetingResult(null);
                    }}
                    className="w-full px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900"
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {showChurnRisk && (
          <ChurnRiskPanel
            onClose={() => setShowChurnRisk(false)}
            selectedClinicName={selectedClinic?.clinic_name}
          />
        )}
      </div>
    </div>
  );
}
