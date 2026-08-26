// Server-side port of the coverage-first Meta targeting generator behind the
// UI "Export FB Targeting" button (components/ClinicTerritoryManager.tsx
// exportFacebookTargeting) and scripts/generate-fb-targeting.js. Pure: no I/O.
//
// Output is the fb_geo_locations JSON stored on clinic_territories. Pin names
// are coordinate strings (the UI's own fallback when reverse-geocoding finds
// nothing); Meta targets purely on lat/lng/radius, so geometry is identical.

export interface NeighborInput {
  clinic_name: string;
  latitude: number;
  longitude: number;
}

export interface GenerateInput {
  clinic_id: string;
  clinic_name: string;
  metro_type?: string | null;
  latitude: number;
  longitude: number;
  neighbors?: NeighborInput[];
  geometry: { type: string; coordinates: unknown };
}

export interface CustomLocation {
  name: string;
  radius: number;
  latitude: number;
  longitude: number;
  distance_unit: 'mile';
}

export interface FbGeoLocations {
  geo_locations: {
    location_types: string[];
    custom_locations: CustomLocation[];
  };
  excluded_geo_locations: {
    custom_locations: CustomLocation[];
  };
}

export interface GenerateSummary {
  optimalRadius: number;
  hexSpacing: number;
  territory: string;
  polygonArea: number;
  inclusions: number;
  exclusions: number;
  radiusBreakdown: Record<string, number>;
}

type Ring = number[][]; // [lng, lat][]
interface LatLng { lat: number; lng: number }
interface Pin extends LatLng { radius: number }
interface ExclusionPin extends Pin { name: string }

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3959;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const isPointInPolygon = (point: [number, number], polygon: Ring): boolean => {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

const getDistanceToPolygonEdge = (testLat: number, testLng: number, coords: Ring): number => {
  let minDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const latMid = (lat1 + lat2 + testLat) / 3;
    const lngScale = Math.cos((latMid * Math.PI) / 180);
    const x = testLng * lngScale * 69, y = testLat * 69;
    const x1 = lng1 * lngScale * 69, y1 = lat1 * 69;
    const x2 = lng2 * lngScale * 69, y2 = lat2 * 69;
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let dist: number;
    if (lenSq === 0) {
      dist = Math.hypot(x - x1, y - y1);
    } else {
      let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      dist = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
    }
    if (dist < minDist) minDist = dist;
  }
  return minDist;
};

const samplePolygonPerimeter = (coords: Ring, numPoints: number, inwardOffsetMiles = 0.5): LatLng[] => {
  const points: LatLng[] = [];
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const len = calculateDistance(lat1, lng1, lat2, lng2);
    segmentLengths.push(len);
    totalLength += len;
  }
  const spacing = totalLength / numPoints;
  let accumulatedLength = 0, segmentIndex = 0;
  for (let i = 0; i < numPoints; i++) {
    const targetLength = i * spacing;
    while (
      segmentIndex < segmentLengths.length - 1 &&
      accumulatedLength + segmentLengths[segmentIndex] < targetLength
    ) {
      accumulatedLength += segmentLengths[segmentIndex];
      segmentIndex++;
    }
    const segmentLen = segmentLengths[segmentIndex];
    const t = segmentLen > 0 ? (targetLength - accumulatedLength) / segmentLen : 0;
    const [lng1, lat1] = coords[segmentIndex];
    const [lng2, lat2] = coords[segmentIndex + 1] || coords[segmentIndex];
    const pointLat = lat1 + t * (lat2 - lat1);
    const pointLng = lng1 + t * (lng2 - lng1);
    const centroidLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const centroidLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const dirLat = centroidLat - pointLat, dirLng = centroidLng - pointLng;
    const dirLen = Math.hypot(dirLat, dirLng);
    if (dirLen > 0) {
      const offsetLat = (inwardOffsetMiles / 69) * (dirLat / dirLen);
      const offsetLng = (inwardOffsetMiles / (69 * Math.cos((pointLat * Math.PI) / 180))) * (dirLng / dirLen);
      points.push({ lat: pointLat + offsetLat, lng: pointLng + offsetLng });
    }
  }
  return points;
};

interface Bounds { minLat: number; maxLat: number; minLng: number; maxLng: number }

const generateHexGrid = (bounds: Bounds, spacingMiles: number, centerLat: number): LatLng[] => {
  const points: LatLng[] = [];
  const latStep = spacingMiles / 69;
  const lngStep = spacingMiles / (69 * Math.cos((centerLat * Math.PI) / 180));
  const rowHeight = latStep * 0.866;
  const colOffset = lngStep / 2;
  let rowIndex = 0;
  for (let lat = bounds.minLat; lat <= bounds.maxLat; lat += rowHeight) {
    const xOffset = rowIndex % 2 === 1 ? colOffset : 0;
    for (let lng = bounds.minLng + xOffset; lng <= bounds.maxLng; lng += lngStep) {
      points.push({ lat, lng });
    }
    rowIndex++;
  }
  return points;
};

const calculateOptimalRadius = (area: number, maxPoints: number, overlapFactor = 1.5, metroType = 'suburban'): number => {
  const baseRadius = Math.sqrt(area / (maxPoints * Math.PI * overlapFactor));
  const metro = metroType.toLowerCase();
  let r: number;
  if (metro === 'urban') r = Math.max(2, Math.min(4, baseRadius * 1.5));
  else if (metro === 'rural') r = Math.max(4, Math.min(8, baseRadius * 1.8));
  else r = Math.max(3, Math.min(6, baseRadius * 1.6));
  return Math.round(r);
};

const calculatePolygonArea = (coords: Ring): number => {
  if (coords.length < 3) return 0;
  const centroidLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const lngScale = Math.cos((centroidLat * Math.PI) / 180);
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const x1 = coords[i][0] * lngScale * 69, y1 = coords[i][1] * 69;
    const x2 = coords[i + 1][0] * lngScale * 69, y2 = coords[i + 1][1] * 69;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
};

export function generateFbTargeting(input: GenerateInput): {
  fb_geo_locations: FbGeoLocations;
  summary: GenerateSummary;
} {
  const lat = Number(input.latitude);
  const lng = Number(input.longitude);
  const geometry = input.geometry;

  // Collect all outer rings + holes.
  let allPolygonRings: Ring[] = [];
  const allPolygonHoles: Ring[] = [];
  if (geometry.type === 'Polygon') {
    const coords = geometry.coordinates as Ring[];
    allPolygonRings = [coords[0]];
    for (const hole of coords.slice(1)) if (hole && hole.length > 3) allPolygonHoles.push(hole);
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates as Ring[][]) {
      if (polygon[0] && polygon[0].length > 3) {
        allPolygonRings.push(polygon[0]);
        for (const hole of polygon.slice(1)) if (hole && hole.length > 3) allPolygonHoles.push(hole);
      }
    }
  } else {
    allPolygonRings = [((geometry.coordinates as Ring[])?.[0]) || []];
  }
  if (allPolygonRings.length === 0 || allPolygonRings[0].length < 4) {
    throw new Error(`No usable polygon ring for clinic ${input.clinic_id}`);
  }

  const isPointInAnyPolygon = (testLng: number, testLat: number): boolean => {
    for (const hole of allPolygonHoles) if (isPointInPolygon([testLng, testLat], hole)) return false;
    for (const ring of allPolygonRings) if (isPointInPolygon([testLng, testLat], ring)) return true;
    return false;
  };
  const distanceToTerritoryEdge = (testLat: number, testLng: number): number => {
    let dist = Infinity;
    for (const ring of allPolygonRings) dist = Math.min(dist, getDistanceToPolygonEdge(testLat, testLng, ring));
    for (const hole of allPolygonHoles) dist = Math.min(dist, getDistanceToPolygonEdge(testLat, testLng, hole));
    return dist;
  };
  const adaptiveIncludeRadius = (distToEdge: number, maxRadius: number): number =>
    Math.max(1, Math.min(maxRadius, Math.round(distToEdge * 1.15)));

  // Bounding box.
  const allLats: number[] = [], allLngs: number[] = [];
  for (const ring of allPolygonRings) for (const c of ring) { allLngs.push(c[0]); allLats.push(c[1]); }
  const minLat = Math.min(...allLats), maxLat = Math.max(...allLats);
  const minLng = Math.min(...allLngs), maxLng = Math.max(...allLngs);
  const territoryWidth = calculateDistance(lat, minLng, lat, maxLng);
  const territoryHeight = calculateDistance(minLat, lng, maxLat, lng);
  const territorySize = Math.max(territoryWidth, territoryHeight);

  const metroType = (input.metro_type || 'suburban').toLowerCase();
  const neutralBuffer = metroType === 'urban' ? 3 : metroType === 'rural' ? 10 : 5;

  const MAX_TOTAL_POINTS = 25, MAX_NEIGHBOR_EXCLUSIONS = 6, MAX_CARDINAL_EXCLUSIONS = 4;
  const MAX_EXCLUSIONS = MAX_NEIGHBOR_EXCLUSIONS + MAX_CARDINAL_EXCLUSIONS; // 10
  const MAX_INCLUSIONS = MAX_TOTAL_POINTS - MAX_EXCLUSIONS; // 15

  const milesToDegreesLat = (m: number) => m / 69;
  const milesToDegreesLng = (m: number, atLat: number) => m / (69 * Math.cos((atLat * Math.PI) / 180));

  // Optimal radius + hex grid.
  let totalPolygonArea = 0;
  for (const ring of allPolygonRings) totalPolygonArea += calculatePolygonArea(ring);
  const optimalRadius = calculateOptimalRadius(totalPolygonArea, MAX_INCLUSIONS, 1.5, metroType);
  const hexSpacing = Math.max(0.75, optimalRadius * 0.5);
  const gridPoints = generateHexGrid({ minLat, maxLat, minLng, maxLng }, hexSpacing, lat);

  // Score grid points.
  const scoredPoints: Array<Pin & { score: number; distToEdge: number; distToClinic: number }> = [];
  for (const point of gridPoints) {
    if (!isPointInAnyPolygon(point.lng, point.lat)) continue;
    const distToEdge = distanceToTerritoryEdge(point.lat, point.lng);
    const distToClinic = calculateDistance(lat, lng, point.lat, point.lng);
    const adaptiveRadius = adaptiveIncludeRadius(distToEdge, optimalRadius);
    let score = distToEdge >= optimalRadius * 0.5 ? 100 + distToEdge : 60 + distToEdge * 5;
    if (distToClinic < optimalRadius * 0.5) score *= 0.3;
    scoredPoints.push({ lat: point.lat, lng: point.lng, radius: adaptiveRadius, score, distToEdge, distToClinic });
  }
  scoredPoints.sort((a, b) => b.score - a.score);

  // Select with spacing; the clinic itself is always pin #1.
  const selectedPoints: Pin[] = [];
  const clinicDistToEdge = distanceToTerritoryEdge(lat, lng);
  selectedPoints.push({ lat, lng, radius: adaptiveIncludeRadius(clinicDistToEdge, optimalRadius) });
  const isTooClose = (testLat: number, testLng: number, testRadius: number): boolean => {
    for (const s of selectedPoints) {
      const dist = calculateDistance(testLat, testLng, s.lat, s.lng);
      if (dist < Math.max(s.radius, testRadius) * 0.7) return true;
    }
    return false;
  };
  for (const c of scoredPoints) {
    if (selectedPoints.length >= MAX_INCLUSIONS) break;
    if (!isTooClose(c.lat, c.lng, c.radius)) selectedPoints.push({ lat: c.lat, lng: c.lng, radius: c.radius });
  }

  // Perimeter gap-fillers.
  if (selectedPoints.length < MAX_INCLUSIONS) {
    const pointsPerRing = Math.max(4, Math.floor(20 / allPolygonRings.length));
    const perimeterInset = Math.max(0.5, Math.min(1.5, optimalRadius * 0.4));
    const fillers: LatLng[] = [];
    for (const ring of allPolygonRings) fillers.push(...samplePolygonPerimeter(ring, pointsPerRing, perimeterInset));
    const perimeterMaxRadius = Math.max(1, Math.min(3, Math.round(optimalRadius * 0.6)));
    for (const p of fillers) {
      if (selectedPoints.length >= MAX_INCLUSIONS) break;
      if (!isPointInAnyPolygon(p.lng, p.lat)) continue;
      const distToEdge = distanceToTerritoryEdge(p.lat, p.lng);
      const perimRadius = adaptiveIncludeRadius(distToEdge, perimeterMaxRadius);
      if (isTooClose(p.lat, p.lng, perimRadius)) continue;
      selectedPoints.push({ lat: p.lat, lng: p.lng, radius: perimRadius });
    }
  }

  // Exclusion donut: 4 corners @45 mi, 4 cardinals @30 mi, well outside the
  // territory. Intentional — see feedback_fb_targeting_exclusion_donut.
  const cornerDistance = neutralBuffer + 50 + territorySize / 2;
  const cardinalDistance = neutralBuffer + 40 + territorySize / 2;
  const exclusionPoints: ExclusionPin[] = [
    { lat: lat - milesToDegreesLat(cornerDistance * 0.707), lng: lng - milesToDegreesLng(cornerDistance * 0.707, lat), radius: 45, name: 'Southwest' },
    { lat: lat - milesToDegreesLat(cornerDistance * 0.707), lng: lng + milesToDegreesLng(cornerDistance * 0.707, lat), radius: 45, name: 'Southeast' },
    { lat: lat + milesToDegreesLat(cornerDistance * 0.707), lng: lng - milesToDegreesLng(cornerDistance * 0.707, lat), radius: 45, name: 'Northwest' },
    { lat: lat + milesToDegreesLat(cornerDistance * 0.707), lng: lng + milesToDegreesLng(cornerDistance * 0.707, lat), radius: 45, name: 'Northeast' },
    { lat: lat - milesToDegreesLat(cardinalDistance), lng, radius: 30, name: 'South' },
    { lat, lng: lng - milesToDegreesLng(cardinalDistance, lat), radius: 30, name: 'West' },
    { lat: lat + milesToDegreesLat(cardinalDistance), lng, radius: 30, name: 'North' },
    { lat, lng: lng + milesToDegreesLng(cardinalDistance, lat), radius: 30, name: 'East' },
  ];

  // Neighbor exclusions: 1-mile pins on nearby clinics, in the order given
  // (callers pass nearest-first).
  const MAX_NEIGHBOR_DISTANCE = 15, NEIGHBOR_EXCLUSION_RADIUS = 1;
  const remainingSlots = MAX_EXCLUSIONS - exclusionPoints.length;
  if (remainingSlots > 0) {
    const neighborExclusions: ExclusionPin[] = [];
    for (const clinic of input.neighbors || []) {
      if (!clinic.latitude || !clinic.longitude) continue;
      if (calculateDistance(lat, lng, Number(clinic.latitude), Number(clinic.longitude)) <= MAX_NEIGHBOR_DISTANCE) {
        neighborExclusions.push({
          lat: Number(clinic.latitude), lng: Number(clinic.longitude),
          radius: NEIGHBOR_EXCLUSION_RADIUS, name: `${clinic.clinic_name} clinic`,
        });
      }
    }
    for (let i = 0; i < Math.min(remainingSlots, neighborExclusions.length); i++) exclusionPoints.push(neighborExclusions[i]);
  }
  const distributedExclusions = exclusionPoints.slice(0, MAX_EXCLUSIONS);

  const coordName = (la: number, lo: number) => `${la.toFixed(6)}, ${lo.toFixed(6)}`;
  const fb_geo_locations: FbGeoLocations = {
    geo_locations: {
      location_types: ['home', 'recent'],
      custom_locations: selectedPoints.map((p) => ({
        name: coordName(p.lat, p.lng), radius: p.radius,
        latitude: p.lat, longitude: p.lng, distance_unit: 'mile',
      })),
    },
    excluded_geo_locations: {
      custom_locations: distributedExclusions.map((p) => ({
        name: p.name, radius: p.radius,
        latitude: p.lat, longitude: p.lng, distance_unit: 'mile',
      })),
    },
  };

  const radiusBreakdown = selectedPoints.reduce<Record<string, number>>((a, p) => {
    a[p.radius] = (a[p.radius] || 0) + 1;
    return a;
  }, {});

  return {
    fb_geo_locations,
    summary: {
      optimalRadius,
      hexSpacing: Number(hexSpacing.toFixed(2)),
      territory: `${territoryWidth.toFixed(1)} x ${territoryHeight.toFixed(1)} mi`,
      polygonArea: Number(totalPolygonArea.toFixed(1)),
      inclusions: selectedPoints.length,
      exclusions: distributedExclusions.length,
      radiusBreakdown,
    },
  };
}

export { calculateDistance as haversineMiles };
