// Pure logic: units, geodesy, track statistics, waypoint classes, tile math, DEM slope/aspect, avalanche lookup,
// GPX export. No DOM and no map access, so `node --test test/` verifies it without a browser.

export const M_PER_MI = 1609.344;
export const FT_PER_M = 3.28084;
const EARTH_R = 6371008.8;
const EARTH_CIRC = 40075016.686;
const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

export const fmt = {
  /** Miles with one decimal, e.g. "3.2". */
  mi(m) { return (m / M_PER_MI).toFixed(1); },
  /** Distance with unit: feet under 0.1 mi, otherwise miles with two decimals. */
  dist(m) { return m < 0.1 * M_PER_MI ? `${Math.round(m * FT_PER_M).toLocaleString('en-US')} ft` : `${(m / M_PER_MI).toFixed(2)} mi`; },
  /** Feet, rounded, with thousands separators. */
  ft(m) { return Math.round(m * FT_PER_M).toLocaleString('en-US'); },
  tempF(c) { return Math.round(c * 9 / 5 + 32); },
  mph(kmh) { return Math.round(kmh * 0.621371); },
  inches(cm) { return (cm * 0.393701).toFixed(1); },
  ll(n, d = 5) { return Number(n).toFixed(d); },
};

/** Great-circle distance in meters between [lng, lat] pairs. */
export function haversine(a, b) {
  const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Initial true bearing in degrees [0, 360) from a to b. */
export function bearing(a, b) {
  const p1 = toRad(a[1]), p2 = toRad(b[1]), dl = toRad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function compass(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/** Centered moving average that skips non-numbers. */
export function smooth(arr, window = 7) {
  const half = Math.floor(window / 2), out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      if (Number.isFinite(arr[j])) { sum += arr[j]; n++; }
    }
    out[i] = n ? sum / n : null;
  }
  return out;
}

/**
 * Distance, gain and loss for a coordinate list ([lng, lat, ele?]). Gain uses a 7-point smoothed elevation series
 * with a 1 m noise floor, which matches GPS apps better than the raw sum. Missing elevations stay missing: a track
 * without elevation reports hasEle false and zero gain, never a fake profile at 0 m.
 */
export function trackStats(coords) {
  const empty = { distance: 0, gain: 0, loss: 0, maxEle: null, minEle: null, hasEle: false, cumDist: [0], smoothEle: [] };
  if (!coords || coords.length < 2) return empty;
  const raw = coords.map((c) => (Number.isFinite(c[2]) ? c[2] : null));
  const hasEle = raw.some((v) => v !== null);
  const smoothEle = hasEle ? smooth(raw, 7) : [];
  let distance = 0, gain = 0, loss = 0, maxEle = -Infinity, minEle = Infinity;
  const cumDist = [0];
  for (let i = 1; i < coords.length; i++) {
    distance += haversine(coords[i - 1], coords[i]);
    cumDist.push(distance);
  }
  if (hasEle) {
    for (let i = 0; i < smoothEle.length; i++) {
      const e = smoothEle[i];
      if (e === null) continue;
      if (e > maxEle) maxEle = e;
      if (e < minEle) minEle = e;
      const prev = i > 0 ? smoothEle[i - 1] : null;
      if (prev === null) continue;
      const d = e - prev;
      if (d > 1) gain += d; else if (d < -1) loss -= d;
    }
  }
  return { distance, gain, loss, maxEle: hasEle ? maxEle : null, minEle: hasEle ? minEle : null, hasEle, cumDist, smoothEle };
}

/**
 * Stats for an entry: a single line keeps its profile series; several lines are measured one by one and summed,
 * so the gaps between separate routes never count as distance.
 */
export function entryStats(features) {
  const lines = features.filter((f) => /LineString$/.test(f.geometry?.type || ''));
  if (lines.length <= 1) return trackStats(lineCoords(lines));
  const parts = lines.map((f) => trackStats(lineCoords([f])));
  const eles = parts.filter((p) => p.hasEle);
  return {
    distance: parts.reduce((a, p) => a + p.distance, 0), gain: eles.reduce((a, p) => a + p.gain, 0),
    loss: eles.reduce((a, p) => a + p.loss, 0), hasEle: eles.length > 0,
    maxEle: eles.length ? Math.max(...eles.map((p) => p.maxEle)) : null, minEle: eles.length ? Math.min(...eles.map((p) => p.minEle)) : null,
    cumDist: [0], smoothEle: [],
  };
}

/** All coordinates of the line features in a FeatureCollection, flattened in order. */
export function lineCoords(features) {
  const out = [];
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') out.push(...g.coordinates);
    else if (g.type === 'MultiLineString') for (const l of g.coordinates) out.push(...l);
  }
  return out;
}

/** Every vertex of every feature (points, lines, polygons), for fitting the map. */
export function allCoords(features) {
  const out = [];
  const walk = (c) => { if (typeof c[0] === 'number') out.push(c); else for (const x of c) walk(x); };
  for (const f of features) if (f.geometry) walk(f.geometry.coordinates);
  return out;
}

/** [[west, south], [east, north]] or null. Pads a single point so fitBounds has an area. */
export function bounds(coords, pad = 0.01) {
  if (!coords.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const c of coords) {
    if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
  }
  if (e - w < 0.001 && n - s < 0.001) { w -= pad; e += pad; s -= pad; n += pad; }
  return [[w, s], [e, n]];
}

export const WAYPOINT_KINDS = {
  camp: '#FF6B35', peak: '#4A9EFF', water: '#3DC9F5', trailhead: '#FFD700',
  view: '#A78BFA', food: '#F5A623', hazard: '#FF3B30',
};

/** Waypoint class from <sym>, <type> and <name>. */
export function classifyWaypoint(props = {}) {
  const s = `${props.sym || ''} ${props.type || ''} ${props.name || ''}`.toLowerCase();
  if (/\b(camp|campsite|tent|bivvy|bivouac|shelter|hut|lodge|cabin)\b/.test(s)) return 'camp';
  if (/\b(summit|peak|mountain|pass|saddle|highpoint|13er|14er)\b/.test(s)) return 'peak';
  if (/\b(water|spring|stream|creek|river|lake|pond|tarn|reservoir|well)\b/.test(s)) return 'water';
  if (/\b(trail.?head|parking|car ?park)\b/.test(s)) return 'trailhead';
  if (/\b(photo|view|vista|scenic|overlook|lookout)\b/.test(s)) return 'view';
  if (/\b(danger|warning|hazard|cliff|crevasse|slide)\b/.test(s)) return 'hazard';
  if (/\b(food|restaurant|store|resupply)\b/.test(s)) return 'food';
  return 'generic';
}

/**
 * Parse a typed coordinate pair. Accepts "39.64, -106.37", "39.64 -106.37", "39.64N 106.37W" and the degree sign.
 * Returns [lng, lat] or null.
 */
export function parseCoords(q) {
  const m = String(q).trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]), lng = Number(m[3]);
  if (m[2] && m[2].toUpperCase() === 'S') lat = -Math.abs(lat);
  if (m[4] && m[4].toUpperCase() === 'W') lng = -Math.abs(lng);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

/* ---- Web Mercator tiles ---- */

export function lngLatToTile(lng, lat, z) {
  const n = 2 ** z, r = toRad(Math.max(-85.0511, Math.min(85.0511, lat)));
  return [(lng + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
}

export function tileToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / 2 ** z;
  return toDeg(Math.atan(Math.sinh(n)));
}

/** Integer tile range covering [[w,s],[e,n]] at zoom z. */
export function tileRange(b, z) {
  const [x0, y0] = lngLatToTile(b[0][0], b[1][1], z), [x1, y1] = lngLatToTile(b[1][0], b[0][1], z);
  const max = 2 ** z - 1, c = (v) => Math.max(0, Math.min(max, Math.floor(v)));
  return { x0: c(x0), y0: c(y0), x1: c(x1), y1: c(y1) };
}

export function countTiles(b, zmin, zmax) {
  let n = 0;
  for (let z = zmin; z <= zmax; z++) { const r = tileRange(b, z); n += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); }
  return n;
}

/** Ground meters per pixel for a 256 px tile at zoom z and latitude lat. */
export function metersPerPixel(z, lat, tileSize = 256) {
  return EARTH_CIRC * Math.cos(toRad(lat)) / (tileSize * 2 ** z);
}

/* ---- DEM (Terrarium encoding) ---- */

export function terrariumElevation(r, g, b) { return r * 256 + g + b / 256 - 32768; }

/**
 * Slope (degrees) and aspect (degrees clockwise from north, direction the slope faces) for every pixel of an RGBA
 * Terrarium tile, using Horn's 3x3 method with edge pixels clamped.
 */
export function slopeAspect(rgba, size, mPerPx) {
  const ele = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) ele[i] = terrariumElevation(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  const slope = new Float32Array(size * size), aspect = new Float32Array(size * size);
  const at = (x, y) => ele[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x + 1, y - 1);
      const d = at(x - 1, y), f = at(x + 1, y);
      const g = at(x - 1, y + 1), h = at(x, y + 1), k = at(x + 1, y + 1);
      const dzdx = ((c + 2 * f + k) - (a + 2 * d + g)) / (8 * mPerPx); // + = rises to the east
      const dzdy = ((g + 2 * h + k) - (a + 2 * b + c)) / (8 * mPerPx); // + = rises to the south
      const i = y * size + x;
      slope[i] = toDeg(Math.atan(Math.hypot(dzdx, dzdy)));
      // Downslope direction is the negative gradient: east component -dzdx, north component +dzdy.
      aspect[i] = (toDeg(Math.atan2(-dzdx, dzdy)) + 360) % 360;
    }
  }
  return { slope, aspect };
}

/** Avalanche-terrain slope classes, low edge inclusive. Shared by the renderer and the legend. */
export const SLOPE_CLASSES = [
  { min: 27, max: 30, color: [255, 228, 92], label: '27-29°' },
  { min: 30, max: 35, color: [255, 165, 60], label: '30-34°' },
  { min: 35, max: 40, color: [242, 84, 45], label: '35-39°' },
  { min: 40, max: 45, color: [194, 29, 58], label: '40-44°' },
  { min: 45, max: 50, color: [142, 59, 181], label: '45-49°' },
  { min: 50, max: 91, color: [43, 58, 140], label: '50°+' },
];

export function slopeColor(deg) {
  for (const c of SLOPE_CLASSES) if (deg >= c.min && deg < c.max) return c.color;
  return null;
}

/** Eight aspect classes, N first, clockwise. */
export const ASPECT_CLASSES = [
  { dir: 'N', color: [59, 130, 246] }, { dir: 'NE', color: [6, 182, 212] },
  { dir: 'E', color: [16, 185, 129] }, { dir: 'SE', color: [163, 230, 53] },
  { dir: 'S', color: [250, 204, 21] }, { dir: 'SW', color: [249, 115, 22] },
  { dir: 'W', color: [239, 68, 68] }, { dir: 'NW', color: [168, 85, 247] },
];

export function aspectClass(deg) { return ASPECT_CLASSES[Math.round(deg / 45) % 8]; }

/** Paint slope or aspect into an RGBA buffer. Flat ground (under 5 degrees) stays transparent for aspect. */
export function paintDem(mode, rgba, size, mPerPx) {
  const { slope, aspect } = slopeAspect(rgba, size, mPerPx);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const col = mode === 'slope' ? slopeColor(slope[i]) : slope[i] >= 5 ? aspectClass(aspect[i]).color : null;
    if (!col) continue;
    out[i * 4] = col[0]; out[i * 4 + 1] = col[1]; out[i * 4 + 2] = col[2]; out[i * 4 + 3] = 255;
  }
  return out;
}

/* ---- Avalanche danger (avalanche.org map-layer) ---- */

function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(pt, geom) {
  if (!geom) return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.some((rings) => inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h)));
}

/**
 * Today's danger level (1-5) from an avalanche.org map-layer zone, or 0. start_date/end_date carry no offset but are
 * UTC (the convention the Powcast site verified against the products API). Off season or outside the window is 0.
 */
export function bulletinLevel(p = {}, now = Date.now()) {
  const utc = (s) => (s ? Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`) : NaN);
  const start = utc(p.start_date), end = utc(p.end_date), n = Number(p.danger_level);
  const valid = Number.isFinite(start) && Number.isFinite(end) && start <= now && end > now && !p.off_season;
  return valid && Number.isInteger(n) && n >= 1 && n <= 5 ? n : 0;
}

/** Zone containing [lng, lat] with today's level, or null outside every zone. */
export function dangerAt(features, lng, lat, now = Date.now()) {
  const f = (features || []).find((x) => pointInGeometry([lng, lat], x.geometry));
  if (!f) return null;
  const p = f.properties || {};
  return { center: p.center_id || p.center || '', link: p.link || p.center_link || '', level: bulletinLevel(p, now) };
}

export const DANGER = [
  { label: 'No rating', short: 'N/A', color: '#8b92a6' },
  { label: 'Low', short: 'LOW', color: '#50B848' },
  { label: 'Moderate', short: 'MOD', color: '#FFF200' },
  { label: 'Considerable', short: 'CONS', color: '#F7941E' },
  { label: 'High', short: 'HIGH', color: '#ED1C24' },
  { label: 'Extreme', short: 'EXTR', color: '#231F20' },
];

/* ---- GPX export ---- */

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** GPX 1.1 document with one <wpt> per pin. */
export function pinsToGpx(pins, creator = 'Backcountry map') {
  const wpts = pins.map((p) => [
    `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">`,
    Number.isFinite(p.ele) ? `    <ele>${p.ele.toFixed(1)}</ele>` : null,
    p.ts ? `    <time>${new Date(p.ts).toISOString()}</time>` : null,
    `    <name>${xml(p.name || 'Pin')}</name>`,
    p.note ? `    <desc>${xml(p.note)}</desc>` : null,
    '  </wpt>',
  ].filter(Boolean).join('\n'));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="${xml(creator)}" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts.join('\n')}\n</gpx>\n`;
}

/* ---- GPX features -> sidebar entries ---- */

const isLine = (f) => /LineString$/.test(f.geometry?.type || '');
const isPoint = (f) => /Point$/.test(f.geometry?.type || '');
const isPoly = (f) => /Polygon$/.test(f.geometry?.type || '');

/** Number of points, counting each MultiPoint member. */
export function pointCount(features) {
  return features.filter(isPoint).reduce((n, f) => n + (f.geometry.type === 'MultiPoint' ? f.geometry.coordinates.length : 1), 0);
}

/**
 * Split parsed GPX features into sidebar entries, following the manifest.json modes:
 *   'split' (default)  one entry per track/route, plus one entry holding every waypoint
 *   'grouped'          one entry for the whole file
 *   'byType'           one entry each for Lines, Points and Polygons
 * Waypoints get a `_kind` class for coloring. Returns [{ name, features, grouped, waypointsOnly }].
 */
export function splitFeatures(features, mode, baseName) {
  const fs = features.filter((f) => f.geometry);
  for (const f of fs) if (isPoint(f)) f.properties = { ...f.properties, _kind: classifyWaypoint(f.properties || {}) };
  const lines = fs.filter(isLine), points = fs.filter(isPoint), polys = fs.filter(isPoly);
  if (mode === 'grouped') return fs.length ? [{ name: baseName, features: fs, grouped: true, waypointsOnly: !lines.length && !polys.length }] : [];
  if (mode === 'byType') {
    return [
      lines.length && { name: `${baseName} · Lines`, features: lines, grouped: true },
      points.length && { name: `${baseName} · Points`, features: points, grouped: true, waypointsOnly: true },
      polys.length && { name: `${baseName} · Polygons`, features: polys, grouped: true },
    ].filter(Boolean);
  }
  const out = lines.map((f, i) => ({ name: f.properties?.name || (lines.length === 1 ? baseName : `${baseName} #${i + 1}`), features: [f] }));
  if (points.length) out.push({ name: lines.length ? `${baseName} · waypoints` : baseName, features: points, grouped: true, waypointsOnly: true });
  return out;
}
