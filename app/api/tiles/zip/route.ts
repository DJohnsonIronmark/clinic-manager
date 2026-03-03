import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const bbox = searchParams.get('bbox');

  if (!bbox) {
    return NextResponse.json({ error: 'Missing bbox parameter' }, { status: 400 });
  }

  try {
    // Census Bureau TIGERweb ArcGIS REST service
    // Layer 2 in tigerWMS_ACS2023 is ZIP Code Tabulation Areas (ZCTA5)
    // Using dynamicLayers to enable labels
    const dynamicLayers = JSON.stringify([
      {
        id: 2,
        source: { type: 'mapLayer', mapLayerId: 2 },
        drawingInfo: {
          showLabels: true,
          labelingInfo: [
            {
              labelPlacement: 'esriServerPolygonPlacementAlwaysHorizontal',
              labelExpression: '[ZCTA5]',
              symbol: {
                type: 'esriTS',
                color: [50, 50, 50, 255],
                font: {
                  family: 'Arial',
                  size: 10,
                  weight: 'bold'
                },
                haloColor: [255, 255, 255, 255],
                haloSize: 1.5
              },
              minScale: 500000,
              maxScale: 0
            }
          ]
        }
      }
    ]);

    const params = new URLSearchParams({
      bbox: bbox,
      bboxSR: '3857',
      imageSR: '3857',
      size: '512,512',
      format: 'png32',
      transparent: 'true',
      dynamicLayers: dynamicLayers,
      dpi: '96',
      f: 'image',
    });

    const tigerWebUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/export?${params}`;

    const response = await fetch(tigerWebUrl, {
      headers: {
        'Accept': 'image/png',
      },
    });

    if (!response.ok) {
      console.error('TIGERweb tile error:', response.status, response.statusText);
      // Return a transparent 1x1 PNG on error
      const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      return new NextResponse(transparentPng, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    const imageBuffer = await response.arrayBuffer();

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Tile proxy error:', error);
    // Return a transparent 1x1 PNG on error
    const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    return new NextResponse(transparentPng, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
}
