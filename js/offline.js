// Offline: service worker registration, "save this area" downloads, and the saved-area list.
// A saved area holds the topo basemap (OpenFreeMap vector tiles) and the DEM (hillshade, slope, aspect, 3D,
// elevation readout) for the visible map, zoom 6 to 14. The map overzooms past 14, so detail holds when zoomed in.

import { CFG } from './config.js';
import { S, Store } from './state.js';
import { countTiles, tileRange } from './core.js';
import { $, esc, icon, toast, askText } from './ui.js';

const CACHE = 'bcm-offline';
const AREAS = 'bcm-offline-areas';
let job = null;

/** Tile URL templates for the saved-area download: OpenFreeMap vector tiles (from its TileJSON) and the DEM. */
async function templates() {
  const out = [CFG.terrainTiles];
  try {
    const style = await (await fetch(CFG.basemaps.topo.style)).json();
    const tj = await (await fetch(style.sources.openmaptiles.url)).json();
    out.unshift(tj.tiles[0]);
    return { tiles: out, extras: extrasFor(style) };
  } catch {
    return { tiles: out, extras: [] };
  }
}

/** Style, sprite and the basic Latin glyph range, so labels render offline. */
function extrasFor(style) {
  const fonts = new Set([...CFG.font, ...CFG.fontBold, 'Noto Sans Italic']);
  const sprite = typeof style.sprite === 'string' ? style.sprite : null;
  return [CFG.basemaps.topo.style, style.sources.openmaptiles.url,
    ...(sprite ? [`${sprite}.json`, `${sprite}.png`, `${sprite}@2x.json`, `${sprite}@2x.png`] : []),
    ...[...fonts].map((f) => style.glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', '0-255'))];
}

function* tileUrls(area, tiles) {
  for (let z = area.zmin; z <= area.zmax; z++) {
    const r = tileRange(area.bounds, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) {
      for (const t of tiles) yield t.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    }
  }
}

function currentArea() {
  const b = S.map.getBounds();
  return { bounds: [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], zmin: CFG.offline.minZoom, zmax: CFG.offline.maxZoom };
}

function estimate() {
  const n = countTiles(currentArea().bounds, CFG.offline.minZoom, CFG.offline.maxZoom) * 2;
  const mb = Math.round(n * 0.045);
  const el = $('#offline-estimate');
  if (S.map.getZoom() < 9) { el.textContent = 'Zoom in closer (to a valley or range) to save an area.'; return 0; }
  el.textContent = n > CFG.offline.maxTiles ? `Too large: ${n.toLocaleString('en-US')} tiles. Zoom in further.`
    : `About ${n.toLocaleString('en-US')} tiles, roughly ${mb} MB, for the area on screen.`;
  return n;
}

async function saveArea() {
  if (job) { job.cancel = true; return; }
  const n = estimate();
  if (!n || n > CFG.offline.maxTiles) return;
  const name = await askText({ title: 'Save area offline', label: 'Name', value: `Area near ${S.map.getCenter().lat.toFixed(2)}, ${S.map.getCenter().lng.toFixed(2)}`, ok: 'Download' });
  if (name === null) return;
  navigator.storage?.persist?.();
  const area = { id: Date.now().toString(36), name: name || 'Saved area', ...currentArea(), ts: Date.now() };
  const { tiles, extras } = await templates();
  const urls = [...extras, ...tileUrls(area, tiles)];
  job = { cancel: false, done: 0, failed: 0, total: urls.length };
  renderJob();
  const cache = await caches.open(CACHE);
  let i = 0;
  const worker = async () => {
    while (!job.cancel && i < urls.length) {
      const url = urls[i++];
      try {
        if (!(await cache.match(url))) { const r = await fetch(url); if (r.ok) await cache.put(url, r); else if (r.status !== 404) job.failed++; }
      } catch { job.failed++; }
      job.done++;
      if (job.done % 20 === 0) renderJob();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const cancelled = job.cancel, failed = job.failed;
  job = null;
  renderJob();
  if (cancelled) { toast('Download stopped. Tiles saved so far stay cached.'); return; }
  Store.saveAreas([...Store.areas(), { ...area, tiles: urls.length }]);
  renderAreas();
  toast(failed ? `Saved "${area.name}" with ${failed} tiles missing. Try again with a better signal.` : `Saved "${area.name}" for offline use`, failed ? 'error' : 'success', 5000);
}

function renderJob() {
  const btn = $('#btn-save-area'), bar = $('#offline-progress');
  bar.hidden = !job;
  btn.innerHTML = job ? `${icon('close', 18)} Stop download` : `${icon('download', 18)} Save this area offline`;
  if (job) bar.querySelector('i').style.width = `${(job.done / job.total * 100).toFixed(1)}%`;
  if (job) $('#offline-estimate').textContent = `Downloading ${job.done.toLocaleString('en-US')} of ${job.total.toLocaleString('en-US')}`;
}

async function deleteArea(id) {
  const all = Store.areas(), gone = all.find((a) => a.id === id), keep = all.filter((a) => a.id !== id);
  if (!gone) return;
  const { tiles } = await templates();
  const keepUrls = new Set(keep.flatMap((a) => [...tileUrls(a, tiles)]));
  const cache = await caches.open(CACHE);
  for (const url of tileUrls(gone, tiles)) if (!keepUrls.has(url)) await cache.delete(url);
  Store.saveAreas(keep);
  renderAreas();
  toast(`Deleted "${gone.name}"`);
}

function areaOutlines() {
  return { type: 'FeatureCollection', features: Store.areas().map((a) => {
    const [[w, s], [e, n]] = a.bounds;
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, properties: { name: a.name } };
  }) };
}

async function renderAreas() {
  const areas = Store.areas();
  S.map.getSource(AREAS)?.setData(areaOutlines());
  $('#area-list').innerHTML = areas.length ? `<ul class="pin-list">${areas.map((a) => `<li data-id="${a.id}">
    <button class="pin-main" data-a="go"><span class="area-ic">${icon('download', 18)}</span><span class="trk-body"><span class="trk-name">${esc(a.name)}</span>
    <span class="trk-meta">${a.tiles?.toLocaleString('en-US') || '?'} tiles · saved ${new Date(a.ts).toLocaleDateString('en-US')}</span></span></button>
    <button class="icon-btn" data-a="delete" aria-label="Delete ${esc(a.name)}">${icon('trash', 18)}</button></li>`).join('')}</ul>`
    : '<p class="empty-text">No saved areas. Pan and zoom to where you are going, then save it while you have signal.</p>';
  const est = await navigator.storage?.estimate?.();
  $('#storage-use').textContent = est ? `Storage used by this app: ${(est.usage / 1048576).toFixed(0)} MB` : '';
}

function addAreaLayer() {
  S.map.addSource(AREAS, { type: 'geojson', data: areaOutlines() });
  S.map.addLayer({ id: AREAS, type: 'line', source: AREAS, layout: { visibility: 'none' },
    paint: { 'line-color': '#6BCB77', 'line-width': 2, 'line-dasharray': [3, 2] } }, 'bcm-z-tracks');
}

export function initOffline() {
  addAreaLayer();
  $('#btn-save-area').onclick = saveArea;
  $('#area-list').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a, id = e.target.closest('li')?.dataset.id;
    const area = Store.areas().find((x) => x.id === id);
    if (a === 'delete') deleteArea(id);
    if (a === 'go' && area) S.map.fitBounds(area.bounds, { padding: 40, duration: 800 });
  });
  document.addEventListener('bcm:tab', (e) => {
    if (S.map.getLayer(AREAS)) S.map.setLayoutProperty(AREAS, 'visibility', e.detail === 'offline' ? 'visible' : 'none');
    if (e.detail === 'offline') { estimate(); renderAreas(); }
  });
  S.map.on('moveend', () => { if (!job && !$('#panel-offline').hidden) estimate(); });
  const net = () => document.body.classList.toggle('is-offline', !navigator.onLine);
  addEventListener('online', net); addEventListener('offline', net); net();
  renderAreas();
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[sw]', e));
}
