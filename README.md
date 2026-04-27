# Backcountry

A self-hosted backcountry web map. Single HTML file, no build step, no backend, no API keys. Designed to replace an onX subscription for personal use — your GPX library lives in your own GitHub repo, the map renders in any modern browser, and every dependency is loaded from a public CDN.

![status](https://img.shields.io/badge/status-personal%20tool-FF6B35?style=flat-square)
![deps](https://img.shields.io/badge/build_step-none-4ade80?style=flat-square)
![keys](https://img.shields.io/badge/api_keys-none-4ade80?style=flat-square)

---

## What's in here

- **Full GPX support** — tracks, routes, AND waypoints. Drag-and-drop, multi-load, auto-load via a manifest, optional `localStorage` persistence
- **Waypoint classification** — `<sym>` and name parsed into camp / peak / water / trailhead / view / food / hazard. Color-coded dots on the map and rich popups with name, description, elevation, and coordinates
- **Slope angle shading** — USGS 3DEP `Slope Map` rendering. The avalanche-relevant zone (~30–45°) shows up in deep orange to red-brown
- **Hiking trails overlay** — OSM-derived Waymarked Trails for marked routes
- **Library (pinned) tracks** — files listed in `manifest.json` always reload fresh and stay locked at the top of the sidebar (📌). User-dropped tracks live in `localStorage` as before
- **Drop-pin tool** — click the pin button (or press `P`), then click anywhere to mark a spot. Name it, save it, persists across sessions
- **Elevation profiles** — Chart.js, hover-syncs a marker along the track on the map, segments colored by slope grade (green → red → pink for ≥30°, the avalanche-relevant zone)
- **Public lands overlays** — National Forests, BLM, NPS via the USGS PAD-US authoritative dataset (server-side filtered by manager); Wilderness Areas via USFS EDW
- **Weather** — right-click (or long-press on touch) any point for current conditions + 7-day forecast from Open-Meteo, with a CAIC link that auto-routes to the Colorado state forecast for points inside CO
- **3D terrain** — AWS Terrarium DEM tiles, hillshade as a separate toggleable layer
- **Three basemaps** — OpenFreeMap Liberty (topo), ESRI World Imagery (satellite + labels), CartoDB dark
- **Geocoding** — Nominatim search
- **Shareable URLs** — the map's lat/lng/zoom/pitch/bearing live in the URL hash
- **Mobile-friendly** — sidebar collapses to a bottom sheet on narrow screens; long-press for weather

---

## GPX files: library vs dropped

Two ways to get tracks on the map:

### Library (always-loaded, pinned)

Files listed in `/manifest.json` auto-load every time the page opens, are marked with 📌 in the sidebar, and can't be deleted from the UI. They reload fresh from `/gpx/` on each page open — edit the file in the repo, push, refresh, and the new version is live.

The default `manifest.json` reserves two slots for a personal library:

```json
{
  "files": [
    { "file": "camping.gpx",       "name": "Camping" },
    { "file": "PeaksAndRoutes.gpx", "name": "Peaks & Routes" }
  ]
}
```

Each entry is either a plain filename string (uses the GPX `<n>` tag or filename) or an object with `{file, name}` to override the display name. Drop those two GPX files into `/gpx/` and they'll appear on every load. Add or remove entries as your library grows.

### Dropped (session-persistent)

Drag any `.gpx` file onto the map to load it ad-hoc. These persist in `localStorage` between visits on that browser, but never get pushed to the repo. Use the × button to remove them. They can be deleted; library tracks can't.

---

## What gets rendered from a GPX file

| GPX tag | Rendered as |
|---|---|
| `<trk>` (tracks) | Colored polyline + glow underlay, start (green) and end (pink) pins |
| `<rte>` (routes) | Same as tracks |
| `<wpt>` (waypoints) | Colored dot, color depends on `<sym>` / name (camp = orange, peak = blue, water = cyan, trailhead = gold, view = purple, food = amber, hazard = red, generic = track color) |

Click any waypoint for name, description, symbol type, elevation, and coordinates. Click any track line for distance / gain / time stats and to open the elevation profile.

Waypoint name labels appear at zoom 11+ (regional / detail view) so they don't clutter at country zoom.

---

## Pins: marking spots on the fly

Click the pin button in the map toolbar (or press `P`), then click anywhere on the map. You'll be prompted for a name; the pin saves to `localStorage` and reappears across sessions. Click an existing pin to see its name, coordinates, and a remove button.

Pins are independent of GPX tracks — they're just lightweight personal markers. Useful for "remember this trailhead," "note this spring," or marking somewhere you saw avy debris that didn't make it onto a track.

`Esc` cancels pin-drop mode without dropping anything.

---

## Slope angle shading: how to read it

The Slope Angle layer pulls from USGS 3DEP elevation data and shades terrain by steepness. The colormap is approximately:

| Color | Slope | What it means for skiing |
|---|---|---|
| Gray | 0–15° | Flat / mellow — generally safe but boring |
| Light yellow | 15–25° | Gentle terrain — safe but not steep enough to slide |
| Light orange | 25–30° | Lower limit of avalanche terrain |
| Orange / brown | 30–35° | **Sweet spot for slab avalanches** — pay attention |
| Red-brown | 35–45° | **Most avalanche-prone zone** |
| Dark red | 45°+ | Too steep to often slide as a slab; new concerns (sluffs, falls) |

This is server-rendered raster, so panning and zooming is instant. **It does not replace a CAIC forecast or trained avalanche judgment** — but it's the single most useful map layer for picking lines or recognizing terrain traps.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `3` | Toggle 3D terrain |
| `F` | Toggle fullscreen |
| `P` | Toggle pin-drop mode |
| `/` | Focus the search bar |
| `Esc` | Close any open panel, exit pin mode |
| `Ctrl/⌘ + B` | Toggle sidebar |

On the map: **right-click** for weather (desktop), **long-press** for weather (touch). **Click any track** for stats, **click any waypoint** for details, **click a sidebar entry** to fly there, **click a pin** to see its info.

---

## Free services this uses (zero keys)

| What | Where | Notes |
|---|---|---|
| Topo basemap | [OpenFreeMap](https://openfreemap.org) Liberty style | Community-funded OSM tiles |
| Satellite | ESRI World Imagery | Free for non-commercial; included reference labels overlay |
| Dark basemap | CartoDB `dark_all` | Free with attribution |
| Terrain DEM | AWS [Terrarium tiles](https://registry.opendata.aws/terrain-tiles/) | Public, sponsored by Mapzen / Amazon |
| Slope angle | USGS 3DEP [`3DEPElevation/ImageServer`](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) | `Slope Map` rendering rule, server-rendered |
| Hiking trails | [Waymarked Trails](https://hiking.waymarkedtrails.org) | OSM-derived, donation-supported |
| National Forests / BLM / National Parks | USGS [PAD-US](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview) (`Federal_Fee_Managers_Authoritative` MapServer) | Authoritative federal land inventory, server-side filtered by `Mang_Name` |
| Wilderness Areas | USFS EDW (`EDW_Wilderness_01`) | |
| Weather | [Open-Meteo](https://open-meteo.com) | Public API, generous free tier |
| Geocoding | [Nominatim](https://nominatim.openstreetmap.org) | OSM, please respect their fair-use policy |
| Avalanche forecasts | [CAIC](https://avalanche.state.co.us) (Colorado), [avalanche.org](https://avalanche.org) (everywhere else) | Direct links, no integration |

PAD-US replaced the BLM `BLM_Natl_SMA_LimitedScale` service that ships with most ArcGIS demos — that one has a `minScale` of 1:36K, meaning it only renders when zoomed in past zoom 14 and is invisible at any normal regional view. PAD-US has no such restriction and renders correctly from world view to detail.

---

## Customizing layers and endpoints

All endpoints live in a single `CFG` object near the top of the script. Each layer entry has a `kind` field (`arcgis-export`, `arcgis-image`, or `xyz`) and the renderer adapts. To swap a basemap, change a public-lands service, filter PAD-US differently, or add an entirely new tile overlay, edit there:

```js
const CFG = {
  layers: {
    slope: {
      kind: 'arcgis-image',
      url: 'https://elevation.nationalmap.gov/.../3DEPElevation/ImageServer',
      renderingRule: { rasterFunction: 'Slope Map' },
      // try also: 'Aspect Map', 'Hillshade Multidirectional', 'Elevation Tinted Hillshade'
    },
    forests: {
      kind: 'arcgis-export',
      url: 'https://gis1.usgs.gov/.../Federal_Fee_Managers_Authoritative/MapServer',
      layers: 'show:0',
      layerDefs: { 0: "Mang_Name = 'USFS'" },
    },
    trails: {
      kind: 'xyz',
      url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
    },
    // ...
  },
  basemaps: { /* topo, sat, dark */ },
  terrainTiles: '...',
};
```

PAD-US `Mang_Name` values include `BLM`, `NPS`, `USFS`, `FWS`, `USACE`, `USBR`, `BIA`, `DOD`, `STAT_LAND` (state lands), `LOC_LAND` (local), and many more. Add a new layer toggle by adding a new entry under `CFG.layers` with the manager you want — no other code changes needed.

The `LANDS_Z_ORDER` array near the top of the script controls how layers stack: earlier entries draw lower. Default order is slope → public-land fills → trails → tracks. Reorder if you want trails under fills, etc.

---

## Performance notes

- Tracks with >2000 points are downsampled to ~600 points for the elevation profile (the map keeps full resolution)
- Elevation gain is computed on a 7-window smoothed series with a 1m noise threshold — this matches what most GPS apps report rather than the inflated raw-sum number
- `localStorage` is capped at ~4MB; library (pinned) tracks are NOT counted against this since they always reload fresh from `/gpx/`. Only dropped tracks persist
- Public-lands layers are raster (ArcGIS `export` endpoint) and only redrawn when toggled on, the bbox changes, or you zoom — they don't tax the renderer when off
- Waypoints render as a dedicated `circle` layer with zoom-interpolated radius; thousands of points render smoothly

---

## Browser support

Tested on recent Chrome, Safari (desktop + iOS), Firefox, Edge. Requires WebGL2. The 3D terrain mode needs decent GPU; on older mobile devices use the flat view.

---

## License & attribution

The code in this repo is yours to do whatever you want with. The data sources have their own attributions, which the map shows in the bottom-right corner — please leave those visible. CartoDB, OpenFreeMap, OSM/Nominatim, and Waymarked Trails in particular are donation-supported; consider tossing them a few bucks if this becomes part of your daily kit.

---

*Built for people who'd rather own their map than rent it.*
