'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Link from 'next/link';

interface Clinic {
  clinic_id: string;
  clinic_name: string;
  state: string;
  city: string;
  metro_type: string;
  latitude?: number;
  longitude?: number;
  geojson?: GeoJSON.Geometry;
  raw_geojson?: string;
  zipCodes?: string[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function ClinicCard({
  clinic,
  onUpdate
}: {
  clinic: Clinic;
  onUpdate: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isLoading) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      // Add context about the clinic to the message
      const contextualMessage = `[Context: Working with clinic "${clinic.clinic_name}" (ID: ${clinic.clinic_id}) in ${clinic.city}, ${clinic.state}. Current metro type: ${clinic.metro_type}. Current zip codes in territory: ${clinic.zipCodes?.join(', ') || 'unknown'}]\n\nUser request: ${userMessage}`;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...chatMessages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: contextualMessage }
          ],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      const assistantMessage = data.message?.content || 'No response received';

      setChatMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }]);

      // If the assistant made changes, trigger a refresh
      if (data.message?.toolCalls?.some((tc: { toolName: string }) =>
        ['update_record', 'insert_record', 'delete_record'].includes(tc.toolName)
      )) {
        onUpdate();
      }
    } catch (err) {
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to process request'}`
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div
      className="p-3 bg-gray-50 rounded-lg border-l-4"
      style={{ borderLeftColor: generateColor(clinic.clinic_id) }}
    >
      <h3 className="font-semibold text-gray-800">{clinic.clinic_name}</h3>
      <p className="text-sm text-gray-600">ID: {clinic.clinic_id}</p>
      <p className="text-xs text-gray-500">
        {clinic.city}, {clinic.state} • {clinic.metro_type}
      </p>

      {clinic.zipCodes && clinic.zipCodes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <p className="text-xs font-medium text-gray-600 mb-1">
            Zip Codes ({clinic.zipCodes.length}):
          </p>
          <p className="text-xs text-gray-500 break-words">
            {clinic.zipCodes.join(', ')}
          </p>
        </div>
      )}

      {clinic.zipCodes === undefined && (
        <p className="text-xs text-gray-400 mt-2 italic">Loading zip codes...</p>
      )}

      {/* Edit Territory Button */}
      <button
        onClick={() => setIsEditing(!isEditing)}
        className={`mt-3 w-full px-3 py-1.5 text-xs font-medium rounded ${
          isEditing
            ? 'bg-gray-200 text-gray-700'
            : 'bg-blue-500 text-white hover:bg-blue-600'
        }`}
      >
        {isEditing ? 'Close Editor' : 'Edit Territory'}
      </button>

      {/* Chat Interface */}
      {isEditing && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          {/* Chat Messages */}
          {chatMessages.length > 0 && (
            <div className="max-h-48 overflow-y-auto mb-2 space-y-2">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`text-xs p-2 rounded ${
                    msg.role === 'user'
                      ? 'bg-blue-100 text-blue-800 ml-4'
                      : 'bg-gray-100 text-gray-700 mr-4'
                  }`}
                >
                  <span className="font-medium">
                    {msg.role === 'user' ? 'You: ' : 'Assistant: '}
                  </span>
                  {msg.content}
                </div>
              ))}
              {isLoading && (
                <div className="text-xs p-2 rounded bg-gray-100 text-gray-500 mr-4 italic">
                  Thinking...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Example Commands */}
          {chatMessages.length === 0 && (
            <div className="text-xs text-gray-500 mb-2">
              <p className="font-medium mb-1">Example commands:</p>
              <ul className="list-disc list-inside space-y-0.5 text-gray-400">
                <li>Change metro type to Urban</li>
                <li>Add zip code 32224 to the area</li>
                <li>Set drive time to 30 minutes</li>
              </ul>
            </div>
          )}

          {/* Input Field */}
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command..."
              disabled={isLoading}
              className="flex-1 text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            />
            <button
              onClick={handleSendMessage}
              disabled={isLoading || !chatInput.trim()}
              className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function generateColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = hash % 360;
  return `hsl(${h}, 70%, 50%)`;
}

function MapContent() {
  const searchParams = useSearchParams();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showZipCodes, setShowZipCodes] = useState(true);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  const clinicIds = searchParams.get('clinics')?.split(',').filter(Boolean) || [];
  const title = searchParams.get('title') || 'Clinic Territories';

  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

  // Function to refresh clinic data (called after edits)
  const refreshClinics = useCallback(async () => {
    try {
      const response = await fetch('/api/clinics');
      if (!response.ok) throw new Error('Failed to fetch clinics');

      const data = await response.json();
      const allClinics = data.clinics || [];

      // Filter to only the requested clinics and preserve zip codes
      const filtered = allClinics
        .filter((c: Clinic) => clinicIds.includes(c.clinic_id))
        .map((c: Clinic) => {
          // Preserve existing zip codes if available
          const existing = clinics.find(ec => ec.clinic_id === c.clinic_id);
          return { ...c, zipCodes: existing?.zipCodes };
        });

      setClinics(filtered);

      // Re-fetch zip codes for updated clinics
      setTimeout(async () => {
        const updatedWithZips = await Promise.all(
          filtered.map(async (clinic: Clinic) => {
            const geometry = getGeometry(clinic);
            if (!geometry) return clinic;

            try {
              const response = await fetch('/api/zip-codes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ geometry }),
              });

              if (response.ok) {
                const data = await response.json();
                return { ...clinic, zipCodes: data.zipCodes || [] };
              }
            } catch (err) {
              console.error(`Failed to fetch zip codes for ${clinic.clinic_id}:`, err);
            }
            return clinic;
          })
        );
        setClinics(updatedWithZips);
      }, 500);
    } catch (err) {
      console.error('Failed to refresh clinics:', err);
    }
  }, [clinicIds, clinics]);

  // Fetch clinic data
  useEffect(() => {
    async function fetchClinics() {
      if (clinicIds.length === 0) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/clinics');
        if (!response.ok) throw new Error('Failed to fetch clinics');

        const data = await response.json();
        const allClinics = data.clinics || [];

        // Filter to only the requested clinics
        const filtered = allClinics.filter((c: Clinic) =>
          clinicIds.includes(c.clinic_id)
        );

        setClinics(filtered);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load clinics');
      } finally {
        setLoading(false);
      }
    }

    fetchClinics();
  }, []);

  // Fetch zip codes for each clinic's territory
  useEffect(() => {
    async function fetchZipCodes() {
      if (clinics.length === 0) return;

      const updatedClinics = await Promise.all(
        clinics.map(async (clinic) => {
          const geometry = getGeometry(clinic);
          if (!geometry) return clinic;

          try {
            const response = await fetch('/api/zip-codes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ geometry }),
            });

            if (response.ok) {
              const data = await response.json();
              return { ...clinic, zipCodes: data.zipCodes || [] };
            }
          } catch (err) {
            console.error(`Failed to fetch zip codes for ${clinic.clinic_id}:`, err);
          }
          return clinic;
        })
      );

      setClinics(updatedClinics);
    }

    // Only fetch if clinics don't have zip codes yet
    if (clinics.length > 0 && !clinics[0].zipCodes) {
      fetchZipCodes();
    }
  }, [clinics.length]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current || loading) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-98.5795, 39.8283], // Center of US
      zoom: 4,
    });

    map.current.on('load', () => {
      if (!map.current) return;

      // Add zip code boundaries via our proxy to avoid CORS issues
      map.current.addSource('zip-wms', {
        type: 'raster',
        tiles: [
          `${window.location.origin}/api/tiles/zip?bbox={bbox-epsg-3857}`
        ],
        tileSize: 512,
        attribution: 'U.S. Census Bureau',
      });

      // Add the zip code raster layer - visible at zoom 6+
      map.current.addLayer({
        id: 'zip-borders',
        type: 'raster',
        source: 'zip-wms',
        minzoom: 6,
        paint: {
          'raster-opacity': 0.7,
        },
      });

      console.log('Zip code layer added via proxy');

      // Add territories for each clinic
      clinics.forEach((clinic) => {
        const geometry = getGeometry(clinic);
        if (!geometry || !map.current) return;

        const color = generateColor(clinic.clinic_id);
        const sourceId = `territory-${clinic.clinic_id}`;

        map.current.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry,
            properties: { clinic_id: clinic.clinic_id },
          },
        });

        // Fill layer
        map.current.addLayer({
          id: `${sourceId}-fill`,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': color,
            'fill-opacity': 0.3,
          },
        });

        // Outline layer
        map.current.addLayer({
          id: `${sourceId}-outline`,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': color,
            'line-width': 2,
          },
        });

        // Add marker at clinic location if available
        if (clinic.latitude && clinic.longitude) {
          new mapboxgl.Marker({ color })
            .setLngLat([clinic.longitude, clinic.latitude])
            .setPopup(
              new mapboxgl.Popup().setHTML(`
                <strong>${clinic.clinic_name}</strong><br/>
                ${clinic.city}, ${clinic.state}<br/>
                ${clinic.metro_type}
              `)
            )
            .addTo(map.current);
        }
      });

      // Fit bounds to show all territories
      if (clinics.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        clinics.forEach((clinic) => {
          if (clinic.latitude && clinic.longitude) {
            bounds.extend([clinic.longitude, clinic.latitude]);
          }
        });

        if (!bounds.isEmpty()) {
          map.current.fitBounds(bounds, { padding: 50, maxZoom: 10 });
        }
      }
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [clinics, loading, MAPBOX_TOKEN]);

  // Toggle zip code layer visibility
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;

    const visibility = showZipCodes ? 'visible' : 'none';
    if (map.current.getLayer('zip-borders')) {
      map.current.setLayoutProperty('zip-borders', 'visibility', visibility);
    }
  }, [showZipCodes]);

  function getGeometry(clinic: Clinic): GeoJSON.Geometry | null {
    if (clinic.geojson) return clinic.geojson;

    if (clinic.raw_geojson) {
      try {
        const parsed = JSON.parse(clinic.raw_geojson);
        if (parsed.type === 'FeatureCollection' && parsed.features?.length) {
          // Select based on metro type
          const indices: Record<string, number> = { Urban: 2, Suburban: 1, Rural: 0 };
          const idx = indices[clinic.metro_type] ?? 1;
          return parsed.features[idx]?.geometry || parsed.features[0]?.geometry;
        }
        if (parsed.type === 'Feature') return parsed.geometry;
        if (parsed.coordinates) return parsed;
      } catch {
        return null;
      }
    }

    return null;
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading map...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center text-red-600">
          <p className="text-xl font-bold mb-2">Error</p>
          <p>{error}</p>
          <Link href="/" className="text-blue-600 hover:underline mt-4 block">
            Back to Territory Manager
          </Link>
        </div>
      </div>
    );
  }

  if (clinicIds.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <p className="text-xl font-bold mb-2">No Clinics Specified</p>
          <p className="text-gray-600 mb-4">
            Add clinic IDs to the URL: /map?clinics=123,456,789
          </p>
          <Link href="/" className="text-blue-600 hover:underline">
            Back to Territory Manager
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-white shadow-sm border-b px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">{title}</h1>
          <p className="text-sm text-gray-600">
            Showing {clinics.length} clinic{clinics.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setShowZipCodes(!showZipCodes)}
            className={`px-4 py-2 rounded-lg ${
              showZipCodes
                ? 'bg-indigo-500 text-white'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            {showZipCodes ? 'Hide' : 'Show'} Zip Codes
          </button>
          <Link
            href="/"
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Back to Manager
          </Link>
          <Link
            href="/chat"
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Data Assistant
          </Link>
        </div>
      </div>

      <div className="flex-1 flex">
        {/* Sidebar with clinic list */}
        <div className="w-72 bg-white border-r overflow-y-auto">
          <div className="p-4">
            <h2 className="font-semibold text-gray-700 mb-3">Clinics</h2>
            <div className="space-y-3">
              {clinics.map((clinic) => (
                <ClinicCard
                  key={clinic.clinic_id}
                  clinic={clinic}
                  onUpdate={refreshClinics}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Map */}
        <div ref={mapContainer} className="flex-1" />
      </div>
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    }>
      <MapContent />
    </Suspense>
  );
}
