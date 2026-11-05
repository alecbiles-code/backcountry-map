// Every endpoint, layer and default lives here. Each overlay has a `kind` and the renderer in layers.js adapts:
//   dem            slope or aspect computed in the browser from the Terrarium DEM (js/dem.js)
//   arcgis-export  ArcGIS MapServer /export as 512 px raster tiles
//   xyz            plain {z}/{x}/{y} raster tiles
//   feature-query  ArcGIS FeatureServer polygons fetched for the viewport (static ./data/<key>.geojson wins if present)
//   avalanche      avalanche.org forecast zones colored by today's danger
//   isochrone      Valhalla drive-time rings from CFG.driveOrigin

const ESRI_FED = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Federal_Lands/FeatureServer/0/query';
const ESRI_FED_ATTR = 'USA Federal Lands · Esri Living Atlas';

export const CFG = {
  driveOrigin: { lat: 39.7392, lng: -104.9903, label: 'Denver' },
  defaultView: { center: [-105.5, 39.5], zoom: 7 },

  trackColors: ['#FF6B35', '#4A9EFF', '#FFD93D', '#6BCB77', '#FF6B9D', '#A66DD4', '#FF9F5A', '#56CCF2', '#F2C94C', '#27AE60'],

  // One glyph server for every basemap. OpenFreeMap serves single font stacks only, so every label layer uses
  // exactly one font name (a comma-joined fallback stack 404s and silently drops the labels).
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  font: ['Noto Sans Regular'],
  fontBold: ['Noto Sans Bold'],

  terrainTiles: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  terrainMaxZoom: 14,
  terrainAttribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen/AWS</a>, USGS 3DEP',

  basemaps: {
    topo: { label: 'Topo', style: 'https://tiles.openfreemap.org/styles/liberty' },
    sat: {
      label: 'Satellite',
      sources: {
        sat: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: '© Esri, Maxar, Earthstar Geographics',
        },
        labels: {
          type: 'raster', tileSize: 256, maxzoom: 17,
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        },
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } },
      ],
    },
    dark: {
      label: 'Dark',
      sources: {
        carto: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['a', 'b', 'c'].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`),
          attribution: '© OpenStreetMap, © CARTO',
        },
      },
      layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
    },
  },

  // Layer panel groups, in display order. Keys refer to CFG.layers.
  groups: [
    { title: 'Terrain', keys: ['slope', 'aspect', 'hillshade', 'terrain3d'] },
    { title: 'Snow & avalanche', keys: ['avalanche', 'snow'] },
    { title: 'Public lands', keys: ['forests', 'blm', 'parks', 'wilderness'] },
    { title: 'Routes', keys: ['trails', 'isochrone'] },
  ],

  // Draw order for overlays, lowest first. Tracks, pins and measure lines always sit above all of these.
  zOrder: ['hillshade', 'aspect', 'slope', 'snow', 'forests', 'blm', 'parks', 'wilderness', 'avalanche', 'isochrone', 'trails'],

  layers: {
    slope: {
      kind: 'dem', mode: 'slope', label: 'Slope angle', sub: 'Avalanche terrain, 27° and up', color: '#F2542D', opacity: 0.6,
    },
    aspect: {
      kind: 'dem', mode: 'aspect', label: 'Aspect', sub: 'Direction slopes face', color: '#3B82F6', opacity: 0.5,
    },
    hillshade: { kind: 'hillshade', label: 'Hillshade', sub: 'Shading from the DEM', color: '#8b92a6' },
    terrain3d: { kind: 'terrain', label: '3D terrain', sub: 'Tilt with two fingers', color: '#4A9EFF' },
    avalanche: {
      kind: 'avalanche', label: 'Avalanche danger', sub: "Today's forecast zones · avalanche.org", color: '#F7941E', opacity: 0.35,
      url: 'https://api.avalanche.org/v2/public/products/map-layer',
      attribution: '<a href="https://avalanche.org">avalanche.org</a>',
    },
    snow: {
      kind: 'arcgis-export', label: 'Snow depth', sub: 'NOAA NOHRSC analysis', color: '#80d8ff', opacity: 0.65,
      url: 'https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer',
      layers: 'show:3', attribution: 'NOAA NOHRSC',
    },
    forests: {
      kind: 'feature-query', label: 'National Forests', sub: 'Esri Living Atlas', color: '#3d6b46', opacity: 0.45,
      staticUrl: './data/forests.geojson',
      // The service's Agency values are 'Forest Service', 'Bureau of Land Management', 'National Park Service', ...
      // ('U.S. Forest Service' matched nothing, so this layer used to load zero features without an error).
      featureUrl: ESRI_FED, whereField: 'Agency', whereValue: 'Forest Service',
      outFields: 'Agency,unit_name', nameField: 'unit_name', agencyField: 'Agency',
      fallback: {
        featureUrl: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/0/query',
        outFields: 'FORESTNAME', nameField: 'FORESTNAME', attribution: 'USFS EDW',
      },
      attribution: ESRI_FED_ATTR,
    },
    blm: {
      kind: 'feature-query', label: 'BLM land', sub: 'Esri Living Atlas', color: '#d4a017', opacity: 0.45,
      staticUrl: './data/blm.geojson',
      featureUrl: ESRI_FED, whereField: 'Agency', whereValue: 'Bureau of Land Management',
      outFields: 'Agency,unit_name', nameField: 'unit_name', agencyField: 'Agency',
      fallback: {
        featureUrl: 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/1/query',
        whereField: 'ADMIN_AGENCY_CODE', whereValue: 'BLM',
        outFields: 'ADMIN_UNIT_NAME,ADMIN_AGENCY_CODE', nameField: 'ADMIN_UNIT_NAME', agencyField: 'ADMIN_AGENCY_CODE',
        attribution: 'BLM National SMA',
      },
      attribution: ESRI_FED_ATTR,
    },
    parks: {
      kind: 'feature-query', label: 'National Parks', sub: 'NPS Land Resources Division', color: '#1f5132', opacity: 0.55,
      staticUrl: './data/parks.geojson',
      featureUrl: 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query',
      outFields: 'UNIT_NAME,UNIT_TYPE', nameField: 'UNIT_NAME', agencyField: 'UNIT_TYPE',
      attribution: 'NPS Land Resources Division',
    },
    wilderness: {
      kind: 'arcgis-export', label: 'Wilderness', sub: 'USFS EDW', color: '#7a3f9e', opacity: 0.5,
      url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_Wilderness_01/MapServer', layers: 'show:0',
      attribution: 'USFS EDW',
    },
    trails: {
      kind: 'xyz', label: 'Hiking trails', sub: 'OSM Waymarked Trails', color: '#dd5050', opacity: 0.85, maxzoom: 18,
      url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
      attribution: '<a href="https://hiking.waymarkedtrails.org/">Waymarked Trails</a> · <a href="https://www.openstreetmap.org/copyright">© OSM</a>',
    },
    isochrone: {
      // The public FOSSGIS Valhalla server caps isochrones at 60 minutes (it answers "Exceeded max time: 60"
      // to the old 1-4 hour request), so the rings stop at one hour.
      kind: 'isochrone', label: 'Drive time from Denver', sub: 'Valhalla · 15 to 60 min rings', color: '#FF9F5A', opacity: 0.28,
      url: 'https://valhalla1.openstreetmap.de/isochrone',
      contours: [15, 30, 45, 60], contourColors: ['#6BCB77', '#FFD93D', '#FF9F5A', '#FF6B35'],
      attribution: 'Valhalla · FOSSGIS',
    },
  },

  // Saving an area for offline use covers the topo basemap (OpenFreeMap permits bulk use) and the DEM, which feeds
  // hillshade, slope, aspect and 3D. Satellite imagery is only cached as you view it (Esri terms do not allow bulk
  // offline export without a license).
  offline: { minZoom: 6, maxZoom: 14, maxTiles: 12000 },

  weatherApi: 'https://api.open-meteo.com/v1/forecast',
  geocodeApi: 'https://nominatim.openstreetmap.org/search',
  caicForecast: 'https://avalanche.state.co.us/forecasts/backcountry-avalanche/',
};
