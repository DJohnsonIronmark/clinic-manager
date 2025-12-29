// Generate distinct color for each clinic using golden angle
export const generateColor = (clinicId: string | number): string => {
  const numId = parseInt(String(clinicId)) || 0;
  const hue = (numId * 137.508) % 360;
  const saturation = 65 + (numId % 20);
  const lightness = 55 + (numId % 15);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

// Calculate distance between two points using Haversine formula (returns miles)
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
           Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
           Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Check if a point is inside a polygon using ray casting algorithm
export const isPointInPolygon = (point: [number, number], polygon: [number, number][]): boolean => {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// Estimate drive time based on distance and metro type
export const estimateDriveTime = (distanceMiles: number, metroType: string): number => {
  const speeds: Record<string, number> = { urban: 25, suburban: 35, rural: 45 };
  const speed = speeds[metroType] || 35;
  return (distanceMiles / speed) * 60; // Returns minutes
};

// Calculate perpendicular distance from point to line segment
export const perpendicularDistance = (
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number]
): number => {
  const [px, py] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;

  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  let xx: number, yy: number;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
};

// Douglas-Peucker algorithm for polygon simplification
export const douglasPeucker = (points: [number, number][], tolerance: number): [number, number][] => {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIndex = 0;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], firstPoint, lastPoint);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
    const right = douglasPeucker(points.slice(maxIndex), tolerance);
    return left.slice(0, -1).concat(right);
  } else {
    return [firstPoint, lastPoint];
  }
};

// Simplify polygon to target number of points
export const simplifyPolygon = (coordinates: [number, number][], targetPoints: number): [number, number][] => {
  if (coordinates.length <= targetPoints) return coordinates;

  let tolerance = 0.001;
  let simplified = douglasPeucker(coordinates, tolerance);

  let iterations = 0;
  while (simplified.length > targetPoints && iterations < 20) {
    tolerance *= 1.5;
    simplified = douglasPeucker(coordinates, tolerance);
    iterations++;
  }

  while (simplified.length < targetPoints * 0.8 && tolerance > 0.0001 && iterations < 30) {
    tolerance *= 0.8;
    simplified = douglasPeucker(coordinates, tolerance);
    iterations++;
  }

  return simplified;
};

// Parse JSON safely
export const parseJSON = <T>(val: string | T | null | undefined): T | null => {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }
  return val as T | null;
};

// Calculate exclusion circles along boundary
export const calculateExclusionCircles = (
  boundaryCoords: [number, number][],
  centerLat: number,
  centerLng: number
): Array<{
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  distance_unit: string;
}> => {
  const circles: Array<{
    name: string;
    latitude: number;
    longitude: number;
    radius: number;
    distance_unit: string;
  }> = [];

  const step = Math.max(1, Math.floor(boundaryCoords.length / 20));

  for (let i = 0; i < boundaryCoords.length; i += step) {
    const [lon, lat] = boundaryCoords[i];
    const distFromCenter = calculateDistance(centerLat, centerLng, lat, lon);

    if (distFromCenter > 5) {
      circles.push({
        name: `Boundary exclusion ${circles.length + 1}`,
        latitude: lat,
        longitude: lon,
        radius: 25,
        distance_unit: 'mile'
      });
    }
  }

  return circles;
};

// Select radii based on territory size
export const selectRadii = (size: number, count: number): number[] => {
  if (size < 20) return [1, 3, 5, 1, 3, 5, 1, 3, 5, 1].slice(0, count);
  if (size < 40) return [3, 5, 10, 3, 5, 10, 3, 5, 10, 3].slice(0, count);
  if (size < 60) return [5, 10, 15, 5, 10, 15, 5, 10, 15, 5].slice(0, count);
  return [10, 15, 25, 10, 15, 25, 10, 15, 25, 10].slice(0, count);
};
