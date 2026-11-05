// Overlays (terrain, snow, avalanche, public lands, trails, drive time), the layer panel and the map legend.

import { CFG } from './config.js';
import { S, Store } from './state.js';
import { ANCHORS, onFeatureClick, removeLayers, removeSources, setBasemap } from './map.js';
import { demTiles } from './dem.js';
import { SLOPE_CLASSES, ASPECT_CLASSES, DANGER, bulletinLevel } from './core.js';
import { $, $$, esc, toast } from './ui.js';

const P = (key) => `bcm-ov-${key}`;
const rgb = (c) => `rgb(${c.join(',')})`;

/* ---------- placement ---------- */

function overlayLayerIds(key) {
  const p = P(key);
  return S.map.getStyle().layers.map((l) => l.id).filter((id) => id === p || id.startsWith(`${p}-`));
}

/** Insert below the next overlay that is on (by CFG.zOrder), else just under the basemap labels. */
function beforeId(key) {
  const order = CFG.zOrder;
  for (const k of order.slice(order.indexOf(key) + 1)) {
    if (!S.layers[k]) continue;
    const first = overlayLayerIds(k)[0];
    if (first) return first;
  }
  return ANCHORS[0];
}

function popup(lngLat, html) {
  return new maplibregl.Popup({ offset: 8, maxWidth: '280px' }).setLngLat(lngLat).setHTML(html).addTo(S.map);
}

/* ---------- per-kind add/remove ---------- */

function arcgisTileUrl(cfg) {
  const q = 'bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png32&transparent=true&f=image';
  return `${cfg.url}/export?${q}&dpi=96&layers=${cfg.layers}`;
}

function addRaster(key, cfg) {
  const tiles = cfg.kind === 'dem' ? demTiles(cfg.mode) : cfg.kind === 'xyz' ? [cfg.url] : [arcgisTileUrl(cfg)];
  const tileSize = cfg.kind === 'arcgis-export' ? 512 : 256;
  const maxzoom = cfg.kind === 'dem' ? CFG.terrainMaxZoom : cfg.maxzoom;
  if (!S.map.getSource(P(key))) {
    S.map.addSource(P(key), { type: 'raster', tiles, tileSize, ...(cfg.attribution ? { attribution: cfg.attribution } : {}), ...(maxzoom ? { maxzoom } : {}) });
  }
  S.map.addLayer({ id: P(key), type: 'raster', source: P(key), paint: { 'raster-opacity': cfg.opacity } }, beforeId(key));
  setState(key, cfg.kind === 'dem' ? 'ok' : 'loading');
}

function addHillshade(key) {
  S.map.addSource(P(key), { type: 'raster-dem', tiles: [CFG.terrainTiles], tileSize: 256, encoding: 'terrarium', maxzoom: CFG.terrainMaxZoom });
  S.map.addLayer({
    id: P(key), type: 'hillshade', source: P(key),
    paint: { 'hillshade-shadow-color': '#000', 'hillshade-highlight-color': '#fff', 'hillshade-exaggeration': 0.45 },
  }, beforeId(key));
}

// 3D uses its own DEM source: MapLibre warns when terrain and hillshade share one.
function setTerrain3d(on) {
  if (on) {
    if (!S.map.getSource('bcm-dem-3d')) {
      S.map.addSource('bcm-dem-3d', { type: 'raster-dem', tiles: [CFG.terrainTiles], tileSize: 256, encoding: 'terrarium', maxzoom: CFG.terrainMaxZoom });
    }
    S.map.setTerrain({ source: 'bcm-dem-3d', exaggeration: 1.4 });
    if (S.map.getPitch() < 30) S.map.easeTo({ pitch: 55, duration: 700 });
  } else {
    S.map.setTerrain(null);
    S.map.easeTo({ pitch: 0, duration: 500 });
  }
  $('#btn-3d').classList.toggle('on', on);
  $('#btn-3d').setAttribute('aria-pressed', String(on));
}

function addFill(key, cfg, data, paint = {}) {
  if (!S.map.getSource(P(key))) S.map.addSource(P(key), { type: 'geojson', data, ...(cfg.attribution ? { attribution: cfg.attribution } : {}) });
  const before = beforeId(key);
  S.map.addLayer({ id: P(key), type: 'fill', source: P(key), paint: { 'fill-color': cfg.color, 'fill-opacity': cfg.opacity, ...paint.fill } }, before);
  S.map.addLayer({ id: `${P(key)}-line`, type: 'line', source: P(key), paint: { 'line-color': cfg.color, 'line-width': 1, 'line-opacity': 0.75, ...paint.line } }, before);
}

/* ---------- public lands: viewport feature queries ---------- */

const lands = { abort: new Map(), lastKey: new Map(), staticData: new Map(), noStatic: new Set(), useFallback: new Set() };

function esriQuery(endpoint, b, { outFields, whereField, whereValue }) {
  const params = new URLSearchParams({
    geometry: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`, geometryType: 'esriGeometryEnvelope',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: outFields || '*', returnGeometry: 'true',
    f: 'geojson', resultRecordCount: '1000', geometryPrecision: '5',
    where: whereField && whereValue ? `${whereField} = '${whereValue.replace(/'/g, "''")}'` : '1=1',
  });
  return `${endpoint}?${params}`;
}

async function esriFeatures(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  if (data?.error) throw new Error(data.error.message || 'service error');
  return data.features || [];
}

async function loadStatic(key, cfg) {
  if (lands.staticData.has(key)) return lands.staticData.get(key);
  if (!cfg.staticUrl || lands.noStatic.has(key)) return null;
  try {
    const r = await fetch(cfg.staticUrl);
    const gj = r.ok ? await r.json() : null;
    if (gj?.type === 'FeatureCollection') { lands.staticData.set(key, gj); return gj; }
  } catch { /* no bundled file: use the live service */ }
  lands.noStatic.add(key);
  return null;
}

async function refreshLands(key, cfg, force = false) {
  if (!S.layers[key]) return;
  const staticGj = await loadStatic(key, cfg);
  if (staticGj) { S.map.getSource(P(key))?.setData(staticGj); setState(key, 'static'); return; }
  if (S.map.getZoom() < 5) { setState(key, 'zoom', 'Zoom in to load'); return; }
  const b = S.map.getBounds(), vk = b.toArray().flat().map((v) => v.toFixed(3)).join(',');
  if (!force && lands.lastKey.get(key) === vk) return;
  lands.lastKey.set(key, vk);
  lands.abort.get(key)?.abort();
  const ctl = new AbortController();
  lands.abort.set(key, ctl);
  setState(key, 'loading');
  const tries = [];
  if (!lands.useFallback.has(key)) tries.push(['primary', esriQuery(cfg.featureUrl, b, cfg)]);
  if (cfg.fallback) tries.push(['fallback', esriQuery(cfg.fallback.featureUrl, b, cfg.fallback)]);
  let err;
  for (const [which, url] of tries) {
    try {
      const features = await esriFeatures(url, ctl.signal);
      S.map.getSource(P(key))?.setData({ type: 'FeatureCollection', features });
      if (which === 'fallback' && !lands.useFallback.has(key)) {
        lands.useFallback.add(key);
        toast(`${cfg.label}: main source failed, using ${cfg.fallback.attribution}`);
      }
      setState(key, 'ok');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      err = e;
      console.warn(`[lands] ${key} ${which}`, e.message);
    }
  }
  setState(key, 'error', `${cfg.label}: ${err?.message || 'unavailable'}`);
}

function landsPopup(f, e) {
  const p = f.properties || {};
  const key = f.layer.id.replace('bcm-ov-', '');
  const cfg = CFG.layers[key], fb = cfg.fallback || {};
  const name = p[cfg.nameField] || p[fb.nameField] || cfg.label;
  const sub = p[cfg.agencyField] || p[fb.agencyField] || cfg.label;
  popup(e.lngLat, `<div class="pop-title">${esc(name)}</div><div class="pop-sub">${esc(sub)}</div>`);
}

const onMoveEnd = () => {
  for (const [key, cfg] of Object.entries(CFG.layers)) if (cfg.kind === 'feature-query' && S.layers[key]) refreshLands(key, cfg);
};

/* ---------- avalanche danger zones ---------- */

let avy = { at: 0, data: null };
export async function avalancheZones() {
  if (avy.data && Date.now() - avy.at < 30 * 60 * 1000) return avy.data;
  const r = await fetch(CFG.layers.avalanche.url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  avy = { at: Date.now(), data: await r.json() };
  return avy.data;
}

async function addAvalanche(key, cfg) {
  setState(key, 'loading');
  const data = await avalancheZones();
  for (const f of data.features) f.properties._level = bulletinLevel(f.properties);
  if (!S.layers[key]) return;
  const color = ['match', ['get', '_level'], ...DANGER.flatMap((d, i) => (i ? [i, d.color] : [])), DANGER[0].color];
  addFill(key, cfg, data, { fill: { 'fill-color': color }, line: { 'line-color': '#111', 'line-opacity': 0.5 } });
  setState(key, 'ok');
}

function avalanchePopup(f, e) {
  const p = f.properties, lvl = DANGER[p._level || 0], link = p.link || p.center_link;
  popup(e.lngLat, `<div class="pop-title">${esc(p.center_id || p.center || 'Avalanche center')} · <span style="color:${lvl.color}">${lvl.label}</span></div>
    <div class="pop-sub">Today's highest rated danger</div>${link ? `<a class="pop-link" href="${esc(link)}" target="_blank" rel="noopener">Read the forecast</a>` : ''}`);
}

/* ---------- drive-time isochrones ---------- */

const ISO_CACHE = 'bcm.isochrone.v2';
const mins = (m) => (m % 60 ? `${m} min` : `${m / 60} hr`);
async function isochrones(cfg) {
  const o = CFG.driveOrigin, ck = `${o.lat.toFixed(4)},${o.lng.toFixed(4)}`;
  try {
    const c = JSON.parse(localStorage.getItem(ISO_CACHE) || '{}')[ck];
    if (c && Date.now() - c.ts < 30 * 864e5) return c.data;
  } catch { /* refetch */ }
  const body = { locations: [{ lat: o.lat, lon: o.lng }], costing: 'auto', contours: cfg.contours.map((time) => ({ time })), polygons: true, denoise: 0.5, generalize: 200 };
  const r = await fetch(`${cfg.url}?json=${encodeURIComponent(JSON.stringify(body))}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  try { localStorage.setItem(ISO_CACHE, JSON.stringify({ [ck]: { ts: Date.now(), data } })); } catch { /* fine */ }
  return data;
}

/** Donut bands: each contour minus the next smaller one, so colors never stack. */
function isoBands(data, cfg) {
  const outer = (g) => (g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : []);
  const fs = [...data.features].sort((a, b) => Number(b.properties.contour) - Number(a.properties.contour));
  return fs.map((f, i) => {
    const minutes = Number(f.properties.contour), inner = fs[i + 1];
    const holes = inner ? outer(inner.geometry) : [];
    const polys = outer(f.geometry).map((ring, j) => (j === 0 ? [ring, ...holes] : [ring]));
    const color = cfg.contourColors[cfg.contours.indexOf(minutes)] || cfg.color;
    return { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polys },
      properties: { minutes, inner: inner ? Number(inner.properties.contour) : 0, color, label: mins(minutes).toUpperCase() } };
  });
}

async function addIsochrone(key, cfg) {
  setState(key, 'loading');
  const bands = isoBands(await isochrones(cfg), cfg);
  if (!S.layers[key]) return;
  addFill(key, cfg, { type: 'FeatureCollection', features: bands },
    { fill: { 'fill-color': ['get', 'color'] }, line: { 'line-color': ['get', 'color'], 'line-width': 1.5 } });
  S.map.addLayer({
    id: `${P(key)}-label`, type: 'symbol', source: P(key),
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 420, 'text-field': ['get', 'label'], 'text-font': CFG.fontBold, 'text-size': 11 },
    paint: { 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(5,7,9,0.9)', 'text-halo-width': 1.6 },
  }, beforeId(key));
  setState(key, 'ok');
}

function isochronePopup(f, e) {
  const p = f.properties;
  popup(e.lngLat, `<div class="pop-title">${p.inner ? `${mins(p.inner)} to ${mins(p.minutes)}` : `Within ${mins(p.minutes)}`}</div>
    <div class="pop-sub">Driving from ${esc(CFG.driveOrigin.label)}</div>`);
}

/* ---------- toggle ---------- */

export async function setLayer(key, on) {
  const cfg = CFG.layers[key];
  if (!cfg || !S.map) return;
  S.layers[key] = on;
  syncToggle(key);
  Store.saveSettings();
  renderLegend();
  if (cfg.kind === 'terrain') { setTerrain3d(on); return; }
  removeLayers(overlayLayerIds(key));
  removeSources([P(key)]);
  if (!on) { setState(key, 'off'); lands.lastKey.delete(key); return; }
  try {
    if (cfg.kind === 'hillshade') addHillshade(key);
    else if (cfg.kind === 'feature-query') {
      addFill(key, cfg, { type: 'FeatureCollection', features: [] });
      await refreshLands(key, cfg, true);
    } else if (cfg.kind === 'avalanche') await addAvalanche(key, cfg);
    else if (cfg.kind === 'isochrone') await addIsochrone(key, cfg);
    else addRaster(key, cfg);
  } catch (e) {
    console.warn(`[layer] ${key}`, e);
    setState(key, 'error', `${cfg.label}: ${e.message || 'failed to load'}`);
  }
}

/* ---------- toggle state badge: loading / ok / static / error (tap to retry) / zoom ---------- */

function setState(key, state, title = '') {
  const row = $(`.layer-row[data-key="${key}"]`);
  if (!row) return;
  row.dataset.state = state;
  const badge = $('.layer-badge', row);
  badge.textContent = { error: 'Retry', static: 'Bundled', zoom: 'Zoom in' }[state] || '';
  badge.title = title;
  if (state === 'error') toast(title, 'error', 4500);
}

function syncToggle(key) {
  const row = $(`.layer-row[data-key="${key}"]`);
  if (row) row.setAttribute('aria-checked', String(!!S.layers[key]));
}

/* ---------- legends (inline in the panel and floating on the map) ---------- */

function legendHtml(key) {
  const cfg = CFG.layers[key];
  if (key === 'slope') return `<div class="lg-classes">${SLOPE_CLASSES.map((c) => `<span><i style="background:${rgb(c.color)}"></i>${c.label}</span>`).join('')}</div>`;
  if (key === 'aspect') {
    const wedges = ASPECT_CLASSES.map((c, i) => `<path d="M16 16 L${16 + 15 * Math.sin((i * 45 - 22.5) * Math.PI / 180)} ${16 - 15 * Math.cos((i * 45 - 22.5) * Math.PI / 180)} A15 15 0 0 1 ${16 + 15 * Math.sin((i * 45 + 22.5) * Math.PI / 180)} ${16 - 15 * Math.cos((i * 45 + 22.5) * Math.PI / 180)} Z" fill="${rgb(c.color)}"/>`).join('');
    return `<div class="lg-aspect"><svg viewBox="0 0 32 32" width="40" height="40">${wedges}<text x="16" y="7" text-anchor="middle" font-size="5" fill="#fff" font-weight="700">N</text></svg><span>Colored by the direction a slope faces. Flat ground under 5° is clear.</span></div>`;
  }
  if (key === 'snow') return '<div class="lg-ramp snow"></div><div class="lg-ends"><span>0 in</span><span>100+ in</span></div>';
  if (key === 'avalanche') return `<div class="lg-classes">${DANGER.slice(1).map((d) => `<span><i style="background:${d.color}"></i>${d.label}</span>`).join('')}</div>`;
  if (key === 'isochrone') return `<div class="lg-classes">${cfg.contours.map((m, i) => `<span><i style="background:${cfg.contourColors[i]}"></i>${mins(m)}</span>`).join('')}</div>`;
  return '';
}

function renderLegend() {
  for (const key of Object.keys(CFG.layers)) {
    const el = $(`.layer-legend[data-key="${key}"]`);
    if (el) el.innerHTML = S.layers[key] ? legendHtml(key) : '';
  }
  // The floating legend is a compact strip of the classes you read while looking at the map.
  const keys = ['slope', 'aspect', 'avalanche'].filter((k) => S.layers[k]);
  const box = $('#map-legend');
  box.hidden = !keys.length;
  box.innerHTML = keys.map((k) => `<div class="ml-item" title="${esc(CFG.layers[k].label)}">${miniLegend(k)}</div>`).join('');
}

function miniLegend(key) {
  if (key === 'aspect') return legendHtml('aspect').replace(/<span>.*<\/span>/, '');
  const cells = key === 'slope' ? SLOPE_CLASSES.map((c) => [rgb(c.color), c.min === 50 ? '50+' : c.min])
    : DANGER.slice(1).map((d) => [d.color, d.short]);
  return `<span class="ml-name">${key === 'slope' ? 'Slope°' : 'Avy'}</span>${cells.map(([c, t]) => `<span class="ml-cell"><i style="background:${c}"></i>${t}</span>`).join('')}`;
}

/* ---------- panel ---------- */

function basemapCards() {
  return `<div class="basemaps" role="radiogroup" aria-label="Basemap">${Object.entries(CFG.basemaps).map(([k, b]) =>
    `<button class="bm-card bm-${k}" role="radio" aria-checked="${S.basemap === k}" data-bm="${k}"><span class="bm-thumb"></span><span>${b.label}</span></button>`).join('')}</div>`;
}

function layerRow(key) {
  const c = CFG.layers[key];
  return `<div class="layer-item">
    <button class="layer-row" role="switch" aria-checked="${!!S.layers[key]}" data-key="${key}">
      <span class="layer-swatch" style="background:${c.color}"></span>
      <span class="layer-text"><span class="layer-name">${esc(c.label)}</span><span class="layer-sub">${esc(c.sub || '')}</span></span>
      <span class="layer-badge"></span><span class="switch" aria-hidden="true"></span>
    </button>
    <div class="layer-legend" data-key="${key}"></div>
  </div>`;
}

export function buildLayerPanel() {
  $('#panel-layers').innerHTML = `<h3 class="sec-title">Basemap</h3>${basemapCards()}${CFG.groups.map((g) =>
    `<h3 class="sec-title">${g.title}</h3><div class="layer-group">${g.keys.map(layerRow).join('')}</div>`).join('')}
    <p class="fineprint">Slope and aspect are computed on your device from the same DEM as 3D terrain, so they also work in saved offline areas. They do not replace an avalanche forecast or field judgment.</p>`;
  $('#panel-layers').addEventListener('click', (e) => {
    const bm = e.target.closest('[data-bm]');
    if (bm) {
      setBasemap(bm.dataset.bm);
      $$('[data-bm]').forEach((b) => b.setAttribute('aria-checked', String(b === bm)));
      return;
    }
    const row = e.target.closest('.layer-row');
    if (!row) return;
    const key = row.dataset.key;
    if (row.dataset.state === 'error' && S.layers[key]) { lands.useFallback.delete(key); setLayer(key, true); return; }
    setLayer(key, !S.layers[key]);
  });
  renderLegend();
}

export function initLayers() {
  for (const key of Object.keys(CFG.layers)) S.layers[key] = false;
  buildLayerPanel();
  S.map.on('moveend', onMoveEnd);
  const fillOf = (kind) => (id) => id.startsWith('bcm-ov-') && !id.endsWith('-line') && !id.endsWith('-label') && CFG.layers[id.slice(7)]?.kind === kind;
  onFeatureClick(fillOf('feature-query'), 10, landsPopup);
  onFeatureClick(fillOf('avalanche'), 11, avalanchePopup);
  onFeatureClick(fillOf('isochrone'), 9, isochronePopup);
  // Raster overlays: clear the spinner when tiles land, flag the toggle when tiles fail (throttled).
  const lastErr = new Map();
  S.map.on('sourcedata', (e) => {
    if (e.sourceId?.startsWith('bcm-ov-') && e.isSourceLoaded) {
      const row = $(`.layer-row[data-key="${e.sourceId.slice(7)}"]`);
      if (row?.dataset.state === 'loading' && !['feature-query', 'avalanche', 'isochrone'].includes(CFG.layers[e.sourceId.slice(7)]?.kind)) setState(e.sourceId.slice(7), 'ok');
    }
  });
  S.map.on('error', (e) => {
    const id = e.sourceId || '';
    if (!id.startsWith('bcm-ov-')) { if (e.error) console.warn('[map]', e.error.message || e.error); return; }
    const key = id.slice(7), now = Date.now();
    if (now - (lastErr.get(key) || 0) < 10000) return;
    lastErr.set(key, now);
    setState(key, 'error', `${CFG.layers[key]?.label}: ${e.error?.message || 'tiles failed to load'}`);
  });
  const saved = Store.settings();
  for (const [k, on] of Object.entries(saved?.layers || {})) if (on && CFG.layers[k]) setLayer(k, true);
  $('#btn-3d').onclick = () => setLayer('terrain3d', !S.layers.terrain3d);
}
