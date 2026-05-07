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

// Calculate distance from a point to the nearest polygon edge (in miles)
// Uses proper perpendicular distance to each edge segment
export const getDistanceToPolygonEdge = (
  testLat: number,
  testLng: number,
  coords: number[][]
): number => {
  let minDist = Infinity;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];

    // Convert to local cartesian approximation for edge distance
    const latMid = (lat1 + lat2 + testLat) / 3;
    const lngScale = Math.cos(latMid * Math.PI / 180);

    // Normalize coordinates to miles (approx)
    const x = testLng * lngScale * 69;
    const y = testLat * 69;
    const x1 = lng1 * lngScale * 69;
    const y1 = lat1 * 69;
    const x2 = lng2 * lngScale * 69;
    const y2 = lat2 * 69;

    // Calculate perpendicular distance to segment
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    let dist: number;
    if (lenSq === 0) {
      // Segment is a point
      dist = Math.sqrt((x - x1) * (x - x1) + (y - y1) * (y - y1));
    } else {
      // Project point onto line segment
      let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t)); // Clamp to segment

      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      dist = Math.sqrt((x - projX) * (x - projX) + (y - projY) * (y - projY));
    }

    if (dist < minDist) minDist = dist;
  }

  return minDist;
};

// Get maximum safe radius that keeps most of the circle inside the polygon
// Returns the largest radius from [1, 2, 3, 5] that has >75% coverage inside
export const getMaxSafeRadius = (
  centerLat: number,
  centerLng: number,
  coords: number[][],
  availableRadii: number[] = [1, 2, 3, 5]
): number => {
  const distToEdge = getDistanceToPolygonEdge(centerLat, centerLng, coords);

  // If distance to edge is large, use largest radius
  const sortedRadii = [...availableRadii].sort((a, b) => b - a);

  for (const radius of sortedRadii) {
    // If distance to edge is at least 75% of radius, the circle fits well
    if (distToEdge >= radius * 0.75) {
      return radius;
    }
  }

  // Return smallest radius
  return sortedRadii[sortedRadii.length - 1];
};

// Sample evenly spaced points along polygon perimeter
// Returns points offset inward by the given distance
export const samplePolygonPerimeter = (
  coords: number[][],
  numPoints: number,
  inwardOffsetMiles: number = 0.5
): Array<{ lat: number; lng: number }> => {
  const points: Array<{ lat: number; lng: number }> = [];

  // Calculate total perimeter length and segment lengths
  const segmentLengths: number[] = [];
  let totalLength = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const len = calculateDistance(lat1, lng1, lat2, lng2);
    segmentLengths.push(len);
    totalLength += len;
  }

  // Sample evenly spaced points
  const spacing = totalLength / numPoints;
  let accumulatedLength = 0;
  let segmentIndex = 0;
  let segmentOffset = 0;

  for (let i = 0; i < numPoints; i++) {
    const targetLength = i * spacing;

    // Advance to correct segment
    while (segmentIndex < segmentLengths.length - 1 &&
           accumulatedLength + segmentLengths[segmentIndex] < targetLength) {
      accumulatedLength += segmentLengths[segmentIndex];
      segmentIndex++;
    }

    // Interpolate within segment
    const segmentLen = segmentLengths[segmentIndex];
    const t = segmentLen > 0 ? (targetLength - accumulatedLength) / segmentLen : 0;

    const [lng1, lat1] = coords[segmentIndex];
    const [lng2, lat2] = coords[segmentIndex + 1] || coords[segmentIndex];

    const pointLat = lat1 + t * (lat2 - lat1);
    const pointLng = lng1 + t * (lng2 - lng1);

    // Calculate inward offset direction (perpendicular to edge, pointing inward)
    // Use polygon centroid to determine inward direction
    const centroidLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
    const centroidLng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;

    // Direction from perimeter point toward centroid
    const dirLat = centroidLat - pointLat;
    const dirLng = centroidLng - pointLng;
    const dirLen = Math.sqrt(dirLat * dirLat + dirLng * dirLng);

    if (dirLen > 0) {
      // Convert offset to degrees (approximate)
      const offsetLat = (inwardOffsetMiles / 69) * (dirLat / dirLen);
      const offsetLng = (inwardOffsetMiles / (69 * Math.cos(pointLat * Math.PI / 180))) * (dirLng / dirLen);

      points.push({
        lat: pointLat + offsetLat,
        lng: pointLng + offsetLng
      });
    }
  }

  return points;
};

// Estimate what percentage of a circle is inside the polygon using Monte Carlo sampling
export const estimateCircleCoverage = (
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
  coords: number[][],
  sampleCount: number = 16
): { insidePercent: number; outsidePercent: number } => {
  let insideCount = 0;

  // Sample points around circle
  for (let i = 0; i < sampleCount; i++) {
    const angle = (i / sampleCount) * 2 * Math.PI;
    const sampleLat = centerLat + (radiusMiles / 69) * Math.sin(angle);
    const sampleLng = centerLng + (radiusMiles / (69 * Math.cos(centerLat * Math.PI / 180))) * Math.cos(angle);

    if (isPointInPolygon([sampleLng, sampleLat], coords as [number, number][])) {
      insideCount++;
    }
  }

  // Also check center point (weights coverage toward center)
  if (isPointInPolygon([centerLng, centerLat], coords as [number, number][])) {
    insideCount += 4; // Weight center point heavily
  }

  const totalSamples = sampleCount + 4;
  const insidePercent = (insideCount / totalSamples) * 100;

  return {
    insidePercent: Math.round(insidePercent),
    outsidePercent: Math.round(100 - insidePercent)
  };
};

// Generate hexagonal grid points covering a bounding box
// Hex grids provide ~15% better coverage than square grids due to optimal circle packing
export const generateHexGrid = (
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  spacingMiles: number,
  centerLat: number // for longitude conversion
): Array<{ lat: number; lng: number }> => {
  const points: Array<{ lat: number; lng: number }> = [];

  // Convert spacing to degrees
  const latStep = spacingMiles / 69;
  const lngStep = spacingMiles / (69 * Math.cos(centerLat * Math.PI / 180));

  // Hex grid uses staggered rows - row offset is spacing * sin(60°) ≈ 0.866
  const rowHeight = latStep * 0.866;
  const colOffset = lngStep / 2;

  let rowIndex = 0;
  for (let lat = bounds.minLat; lat <= bounds.maxLat; lat += rowHeight) {
    // Alternate rows get horizontal offset for hex pattern
    const xOffset = (rowIndex % 2 === 1) ? colOffset : 0;

    for (let lng = bounds.minLng + xOffset; lng <= bounds.maxLng; lng += lngStep) {
      points.push({ lat, lng });
    }
    rowIndex++;
  }

  return points;
};

// Calculate optimal radius for coverage-first circle packing
// Uses the formula: radius = sqrt(area / (num_points * π * overlap_factor))
// Then scales up to ensure overlap for continuous coverage
export const calculateOptimalRadius = (
  polygonAreaSqMi: number,
  maxPoints: number,
  overlapFactor: number = 1.5, // 1.5 = ~50% overlap between adjacent circles
  metroType: string = 'suburban'
): number => {
  // Base calculation: how big should each circle be to cover the area?
  // With overlap factor, we need circles that are larger than pure tiling
  const baseRadius = Math.sqrt(polygonAreaSqMi / (maxPoints * Math.PI * overlapFactor));

  // Scale based on metro type and practical FB targeting limits
  let scaledRadius: number;
  const metro = metroType.toLowerCase();

  if (metro === 'urban') {
    // Urban: smaller territories, use 2-4mi circles
    scaledRadius = Math.max(2, Math.min(4, baseRadius * 1.5));
  } else if (metro === 'rural') {
    // Rural: larger territories, use 4-8mi circles
    scaledRadius = Math.max(4, Math.min(8, baseRadius * 1.8));
  } else {
    // Suburban (default): use 3-6mi circles
    scaledRadius = Math.max(3, Math.min(6, baseRadius * 1.6));
  }

  return Math.round(scaledRadius);
};

// Calculate polygon area using shoelace formula (returns sq miles)
export const calculatePolygonArea = (coords: number[][]): number => {
  if (coords.length < 3) return 0;

  // Get centroid for latitude scaling
  const centroidLat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
  const lngScale = Math.cos(centroidLat * Math.PI / 180);

  // Convert to miles and calculate area using shoelace
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const x1 = coords[i][0] * lngScale * 69;
    const y1 = coords[i][1] * 69;
    const x2 = coords[i + 1][0] * lngScale * 69;
    const y2 = coords[i + 1][1] * 69;
    area += (x1 * y2 - x2 * y1);
  }

  return Math.abs(area / 2);
};

// Score a grid point by its coverage contribution
// Higher scores for interior points, lower for edge points
export const scoreCoveragePoint = (
  testLat: number,
  testLng: number,
  polygonCoords: number[][],
  allPolygonRings: number[][][],
  clinicLat: number,
  clinicLng: number
): { score: number; distToEdge: number; distToClinic: number } => {
  // Find minimum distance to any polygon edge
  let distToEdge = Infinity;
  for (const ring of allPolygonRings) {
    const ringDist = getDistanceToPolygonEdge(testLat, testLng, ring);
    if (ringDist < distToEdge) distToEdge = ringDist;
  }

  const distToClinic = calculateDistance(clinicLat, clinicLng, testLat, testLng);

  // Score formula: prioritize interior points but ensure edge coverage
  // Interior (>3mi from edge): high score
  // Mid-zone (1-3mi from edge): medium score
  // Edge (<1mi from edge): lower score but still valued for coverage
  let score: number;
  if (distToEdge >= 3) {
    score = 100 + distToEdge; // Interior gets highest scores
  } else if (distToEdge >= 1) {
    score = 50 + distToEdge * 10; // Mid-zone
  } else {
    score = 20 + distToEdge * 20; // Edge points still contribute
  }

  // Slight penalty for being too close to clinic (already covered)
  if (distToClinic < 2) {
    score *= 0.5;
  }

  return { score, distToEdge, distToClinic };
};

// Calculate total coverage metrics for a set of circles against a polygon
export const calculateCoverageMetrics = (
  circles: Array<{ lat: number; lng: number; radius: number }>,
  coords: number[][],
  gridResolution: number = 0.5 // miles
): {
  polygonArea: number; // approximate sq miles
  circlesCoverage: number; // sq miles inside polygon
  overspill: number; // sq miles outside polygon
  coveragePercent: number;
  overspillPercent: number;
} => {
  // Calculate polygon bounding box
  const lats = coords.map(c => c[1]);
  const lngs = coords.map(c => c[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const centerLat = (minLat + maxLat) / 2;
  const latStep = gridResolution / 69;
  const lngStep = gridResolution / (69 * Math.cos(centerLat * Math.PI / 180));

  let polygonPoints = 0;
  let coveredInsidePoints = 0;
  let coveredOutsidePoints = 0;

  // Grid sampling
  for (let lat = minLat; lat <= maxLat; lat += latStep) {
    for (let lng = minLng; lng <= maxLng; lng += lngStep) {
      const inPolygon = isPointInPolygon([lng, lat], coords as [number, number][]);

      if (inPolygon) {
        polygonPoints++;
      }

      // Check if covered by any circle
      let covered = false;
      for (const circle of circles) {
        const dist = calculateDistance(lat, lng, circle.lat, circle.lng);
        if (dist <= circle.radius) {
          covered = true;
          break;
        }
      }

      if (covered) {
        if (inPolygon) {
          coveredInsidePoints++;
        } else {
          coveredOutsidePoints++;
        }
      }
    }
  }

  const cellArea = gridResolution * gridResolution;
  const polygonArea = polygonPoints * cellArea;
  const circlesCoverage = coveredInsidePoints * cellArea;
  const overspill = coveredOutsidePoints * cellArea;

  return {
    polygonArea: Math.round(polygonArea * 10) / 10,
    circlesCoverage: Math.round(circlesCoverage * 10) / 10,
    overspill: Math.round(overspill * 10) / 10,
    coveragePercent: polygonPoints > 0 ? Math.round((coveredInsidePoints / polygonPoints) * 100) : 0,
    overspillPercent: (coveredInsidePoints + coveredOutsidePoints) > 0
      ? Math.round((coveredOutsidePoints / (coveredInsidePoints + coveredOutsidePoints)) * 100)
      : 0
  };
};
