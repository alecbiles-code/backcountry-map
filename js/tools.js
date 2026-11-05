// Pins (drop on the map or at your GPS position, list, export as GPX) and the distance measure tool.

import { CFG } from './config.js';
import { S, Store } from './state.js';
import { onFeatureClick, registerMode, setMode } from './map.js';
import { haversine, bearing, compass, fmt, pinsToGpx } from './core.js';
import { elevationAt } from './dem.js';
import { currentFix } from './locate.js';
import { showWeatherAt } from './weather.js';
import { $, esc, icon, toast, askText, download, copyText } from './ui.js';

const PINS = 'bcm-pins';
const MEASURE = 'bcm-measure';
const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- pins ---------- */

function pinData() {
  return { type: 'FeatureCollection', features: S.pins.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, name: p.name } })) };
}

function addPinLayers() {
  S.map.addSource(PINS, { type: 'geojson', data: pinData() });
  S.map.addLayer({ id: PINS, type: 'circle', source: PINS,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 5, 14, 9], 'circle-color': '#FFD93D', 'circle-stroke-color': '#1a1d27', 'circle-stroke-width': 2.5 } }, 'bcm-z-pins');
  S.map.addLayer({ id: `${PINS}-label`, type: 'symbol', source: PINS, minzoom: 9,
    layout: { 'text-field': ['get', 'name'], 'text-font': CFG.fontBold, 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 10 },
    paint: { 'text-color': '#FFD93D', 'text-halo-color': 'rgba(0,0,0,0.9)', 'text-halo-width': 1.6 } }, 'bcm-z-pins');
}

function savePins() {
  Store.savePins();
  S.map.getSource(PINS)?.setData(pinData());
  renderPinList();
}

async function addPin(lng, lat, defaultName) {
  const name = await askText({ title: 'New pin', label: 'Name', value: defaultName || `Pin ${S.pins.length + 1}` });
  if (name === null) return;
  const pin = { id: `pin-${uid()}`, lng, lat, name: name || 'Pin', ts: Date.now(), ele: null };
  S.pins.push(pin);
  savePins();
  const ele = await elevationAt(lng, lat);
  if (ele !== null) { pin.ele = ele; savePins(); }
  toast(`Saved "${pin.name}"`, 'success');
}

export async function pinMyLocation() {
  const fix = currentFix();
  if (!fix) { toast('Turn on your location first (the target button).', 'error'); return; }
  await addPin(fix.lng, fix.lat, `Pin ${S.pins.length + 1}`);
}

function pinPopup(f) {
  const pin = S.pins.find((p) => p.id === f.properties.id);
  if (!pin) return;
  const pop = new maplibregl.Popup({ offset: 14, maxWidth: '280px' }).setLngLat([pin.lng, pin.lat]).setHTML(`
    <div class="pop-title" style="color:#FFD93D">${esc(pin.name)}</div>
    <div class="pop-grid"><span>Position</span><b class="mono">${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}</b>
      ${Number.isFinite(pin.ele) ? `<span>Elevation</span><b>${fmt.ft(pin.ele)} ft</b>` : ''}<span>Saved</span><b>${new Date(pin.ts).toLocaleDateString('en-US')}</b></div>
    <div class="pop-actions"><button data-a="copy">${icon('copy', 16)}Copy</button><button data-a="wx">${icon('weather', 16)}Weather</button>
      <button data-a="rename">Rename</button><button data-a="delete" class="danger">${icon('trash', 16)}</button></div>`).addTo(S.map);
  pop.getElement().addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'copy') copyText(`${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`, 'Copied');
    if (a === 'wx') { pop.remove(); showWeatherAt(pin.lng, pin.lat, pin.name); }
    if (a === 'delete') { pop.remove(); removePin(pin.id); }
    if (a === 'rename') {
      const name = await askText({ title: 'Rename pin', label: 'Name', value: pin.name });
      if (name) { pin.name = name; savePins(); pop.remove(); }
    }
  });
}

function removePin(id) {
  const pin = S.pins.find((p) => p.id === id);
  S.pins = S.pins.filter((p) => p.id !== id);
  savePins();
  if (pin) toast(`Removed "${pin.name}"`);
}

function renderPinList() {
  $('#pins-count').textContent = S.pins.length || '';
  $('#pin-list').innerHTML = S.pins.length ? `<ul class="pin-list">${S.pins.slice().reverse().map((p) => `
    <li data-id="${p.id}"><button class="pin-main" data-a="go"><span class="pin-dot"></span><span class="trk-body"><span class="trk-name">${esc(p.name)}</span>
      <span class="trk-meta mono">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${Number.isFinite(p.ele) ? ` · ${fmt.ft(p.ele)} ft` : ''}</span></span></button>
      <button class="icon-btn" data-a="delete" aria-label="Remove ${esc(p.name)}">${icon('trash', 18)}</button></li>`).join('')}</ul>`
    : `<p class="empty-text">No pins yet. Use the pin button on the map, or pin your current location.</p>`;
}

function onPinListClick(e) {
  const a = e.target.closest('[data-a]')?.dataset.a, id = e.target.closest('li')?.dataset.id;
  const pin = S.pins.find((p) => p.id === id);
  if (!pin) return;
  if (a === 'delete') removePin(id);
  if (a === 'go') S.map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(S.map.getZoom(), 14), duration: 900 });
}

/* ---------- measure ---------- */

const measure = { pts: [] };

function measureData() {
  let cum = 0;
  const pts = measure.pts.map((p, i) => {
    if (i) cum += haversine(measure.pts[i - 1], p);
    return { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { label: i ? fmt.dist(cum) : 'Start' } };
  });
  const line = measure.pts.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: measure.pts }, properties: {} }] : [];
  return { type: 'FeatureCollection', features: [...line, ...pts] };
}

function addMeasureLayers() {
  S.map.addSource(MEASURE, { type: 'geojson', data: measureData() });
  S.map.addLayer({ id: `${MEASURE}-line`, type: 'line', source: MEASURE, filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFD93D', 'line-width': 3, 'line-dasharray': [2, 1.5] } }, 'bcm-z-pins');
  S.map.addLayer({ id: `${MEASURE}-pts`, type: 'circle', source: MEASURE, filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 6, 'circle-color': '#FFD93D', 'circle-stroke-color': '#1a1d27', 'circle-stroke-width': 2 } }, 'bcm-z-pins');
  S.map.addLayer({ id: `${MEASURE}-label`, type: 'symbol', source: MEASURE, filter: ['==', ['geometry-type'], 'Point'],
    layout: { 'text-field': ['get', 'label'], 'text-font': CFG.fontBold, 'text-size': 12, 'text-offset': [0, -1.3], 'text-anchor': 'bottom', 'text-allow-overlap': true },
    paint: { 'text-color': '#FFD93D', 'text-halo-color': 'rgba(0,0,0,0.9)', 'text-halo-width': 1.6 } }, 'bcm-z-pins');
}

function updateMeasure() {
  S.map.getSource(MEASURE)?.setData(measureData());
  const p = measure.pts;
  let total = 0;
  for (let i = 1; i < p.length; i++) total += haversine(p[i - 1], p[i]);
  const leg = p.length > 1 ? bearing(p[p.length - 2], p[p.length - 1]) : null;
  $('#measure-text').innerHTML = p.length < 2 ? 'Tap the map to add points'
    : `<b>${fmt.dist(total)}</b> <span>${leg !== null ? `leg ${Math.round(leg)}° ${compass(leg)} · ${p.length} pts` : ''}</span>`;
  $('#measure-undo').disabled = !p.length;
}

/* ---------- wiring ---------- */

export function initTools() {
  S.pins = Store.pins();
  addPinLayers();
  addMeasureLayers();
  onFeatureClick((id) => id === PINS, 40, pinPopup);
  renderPinList();

  registerMode('pin', { onClick: (e) => { setMode(null); addPin(e.lngLat.lng, e.lngLat.lat); } });
  registerMode('measure', { onClick: (e) => { measure.pts.push([e.lngLat.lng, e.lngLat.lat]); updateMeasure(); } });
  document.addEventListener('bcm:mode', (e) => {
    $('#btn-pin').setAttribute('aria-pressed', String(e.detail === 'pin'));
    $('#btn-measure').setAttribute('aria-pressed', String(e.detail === 'measure'));
    $('#mode-hint').hidden = e.detail !== 'pin';
    $('#measure-bar').hidden = e.detail !== 'measure';
    if (e.detail === 'measure') updateMeasure();
  });

  $('#btn-pin').onclick = () => setMode(S.mode === 'pin' ? null : 'pin');
  $('#btn-measure').onclick = () => setMode(S.mode === 'measure' ? null : 'measure');
  $('#mode-hint-cancel').onclick = () => setMode(null);
  $('#measure-undo').onclick = () => { measure.pts.pop(); updateMeasure(); };
  $('#measure-clear').onclick = () => { measure.pts = []; updateMeasure(); };
  $('#measure-done').onclick = () => { measure.pts = []; updateMeasure(); setMode(null); };

  $('#pin-list').addEventListener('click', onPinListClick);
  $('#btn-pin-here').onclick = pinMyLocation;
  $('#btn-pins-export').onclick = () => {
    if (!S.pins.length) { toast('No pins to export'); return; }
    download(`pins-${new Date().toISOString().slice(0, 10)}.gpx`, pinsToGpx(S.pins));
  };
}
