# Backcountry

A self-hosted backcountry map that installs on a phone like an app. Static files, no build step, no backend, no API keys. Hosts on GitHub Pages as is.

## What it does

1. **Your position.** The target button turns on GPS: a blue dot with an accuracy circle and a compass heading cone. The map follows you until you pan it; tap again to recenter, tap while following to turn GPS off. The screen stays on while following. The bottom bar shows your coordinates, ground elevation and accuracy; tap it to copy the coordinates. With GPS off it shows the map center (phone) or the cursor (desktop).
2. **GPX tracks, routes and waypoints.** Files listed in `manifest.json` load from `gpx/` on every visit. Add your own with Add GPX or by dropping files on the map; those are kept in the browser. Tap a track for its card (distance, gain, loss, high point, elevation profile, weather at the start). Waypoints are colored by type (camp, peak, water, trailhead, view, food, hazard) and named from zoom 11.
3. **Layers.** Topo, satellite and dark basemaps. Slope angle and aspect, hillshade, 3D terrain, today's avalanche danger by forecast zone, snow depth, National Forests, BLM, National Parks, Wilderness, hiking trails, and drive time from Denver. Slope, aspect and avalanche danger show a compact legend on the map.
4. **Offline.** The Offline tab saves the area on screen (topo map, slope, aspect, hillshade, 3D, elevation; zoom 6 to 14). Everything you have looked at is also cached. The app itself opens with no signal once installed.
5. **Pins and measuring.** Drop a pin anywhere or at your GPS position; pins record ground elevation and export as GPX. The ruler measures a multi-leg distance with the bearing of the last leg.
6. **Weather.** Press and hold (or right-click) anywhere for current conditions, a 7-day forecast, ground elevation and that zone's avalanche danger with a link to the forecast. The chip in the bottom bar tracks the map center.
7. **Search.** Place names (US), or paste coordinates such as `39.6403, -106.3742` or `39.6403N 106.3742W`.

Slope shading does not replace an avalanche forecast or trained judgment.

## Install on a phone

Open the GitHub Pages URL in Safari (iPhone) or Chrome (Android), then Share > Add to Home Screen (iPhone) or Install app (Android). Allow location when asked. Before a trip, open the Offline tab while you still have signal and save the area.

## Run locally

Any static file server works. Geolocation and the service worker need `https://` or `localhost`.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Tests for the pure logic (units, geodesy, track stats, GPX splitting, slope/aspect math, avalanche lookup, GPX export) need only Node:

```sh
node --test test/core.test.mjs
```

## Files

| Path | Role |
|---|---|
| `index.html` | Markup only |
| `styles.css` | All styles, mobile first |
| `app.webmanifest`, `icons/` | Install metadata and icons |
| `sw.js` | Service worker: app files network first, CDN libraries and map tiles cache first |
| `manifest.json` | The GPX library list (not the web app manifest) |
| `gpx/` | Library GPX files |
| `js/config.js` | Every endpoint, layer, color and default |
| `js/core.js` | Pure logic, no DOM; covered by `test/core.test.mjs` |
| `js/main.js` | Boot order and keyboard shortcuts |
| `js/map.js` | Map setup, saved view, basemap switching, tap dispatch, tool modes |
| `js/layers.js` | Overlays, the layer panel and legends |
| `js/dem.js` | Slope and aspect tiles and ground elevation from the DEM |
| `js/tracks.js` | GPX loading, drawing, the track list and the track card |
| `js/profile.js` | Elevation profile (Chart.js, loaded on first use) |
| `js/weather.js` | Forecast panel and the conditions chip |
| `js/tools.js` | Pins and the measure tool |
| `js/locate.js` | GPS and the position readout |
| `js/search.js` | Place and coordinate search |
| `js/sheet.js` | Bottom sheet on phones, sidebar on desktop |
| `js/offline.js` | Saved offline areas and service worker registration |
| `vendor/togeojson.mjs` | @tmcw/togeojson 5.8.1 (BSD-2-Clause), vendored so GPX parsing works offline |

## The GPX library: manifest.json

```json
{
  "files": [
    { "file": "camping.gpx", "name": "Camping" },
    { "file": "PeaksAndRoutes.gpx", "name": "Peaks & Routes", "groupByGeomType": true }
  ]
}
```

Each entry is a filename in `gpx/` or an object with `file`, an optional display `name`, and one optional mode:

1. Default: one list entry per track or route, plus one entry holding all waypoints.
2. `"grouped": true`: one entry for the whole file.
3. `"groupByGeomType": true`: one entry each for lines, points and polygons. Best for files with hundreds of features.

Library files reload fresh on every visit and do not move the map. Their color, width, opacity and visibility are remembered. Remove a library file by deleting its entry.

## Data sources (all free, no keys)

| Layer | Source |
|---|---|
| Topo basemap | [OpenFreeMap](https://openfreemap.org) Liberty |
| Satellite | Esri World Imagery plus reference labels |
| Dark basemap | CARTO `dark_all` |
| Terrain DEM (3D, hillshade, slope, aspect, elevation) | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium), USGS 3DEP in the US |
| Avalanche danger | [avalanche.org](https://avalanche.org) map layer (all US centers, including CAIC) |
| Snow depth | NOAA NOHRSC snow analysis |
| National Forests, BLM | Esri Living Atlas USA Federal Lands, with USFS EDW and BLM SMA fallbacks |
| National Parks | NPS Land Resources Division |
| Wilderness | USFS EDW |
| Hiking trails | [Waymarked Trails](https://hiking.waymarkedtrails.org) |
| Drive time | Valhalla on the FOSSGIS public server (rings to 60 minutes, the server's limit) |
| Weather | [Open-Meteo](https://open-meteo.com) |
| Search | [Nominatim](https://nominatim.openstreetmap.org) |

Slope and aspect are computed on your device from the DEM (Horn's method). Slope classes: 27-29, 30-34, 35-39, 40-44, 45-49 and 50+ degrees. Aspect uses eight direction colors shown on a compass legend.

Bundled public-lands data: if `data/forests.geojson`, `data/blm.geojson` or `data/parks.geojson` exists, that layer loads it once instead of querying the service as you pan.

## Keyboard (desktop)

`/` search, `L` location, `P` pin, `M` measure, `3` 3D, `F` show all tracks, `T` tracks tab, `Esc` close, `Ctrl/Cmd+B` side panel. Right-click for weather.

## Notes

1. The service worker serves app files network first, so a push to GitHub Pages shows up on the next open with signal. Bump `VERSION` in `sw.js` when you add or rename a file in `js/`.
2. Dropped GPX files and pins live in this browser's storage. Export pins as GPX now and then; iOS can clear storage for sites that are not installed to the home screen.
3. OpenFreeMap, OSM, Nominatim, Waymarked Trails, Open-Meteo and FOSSGIS are donation supported. Keep the attribution visible (the i button).
