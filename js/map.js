// Map setup, view persistence, basemap switching, layer stacking anchors, tool modes and once-only event binding.
//
// Every layer and source this app adds is prefixed `bcm-`. A basemap switch carries all of them into the new style
// with setStyle's transformStyle, so overlays, tracks, pins and terrain survive untouched. (The old code re-added
// everything after each switch and re-bound its click handlers each time, so after two switches one tap on a
// track or pin opened three popups.)

import { CFG } from './config.js';
import { S, Store } from './state.js';
import { $, debounce } from './ui.js';

export const ANCHORS = ['bcm-z-overlays', 'bcm-z-tracks', 'bcm-z-pins', 'bcm-z-gps'];
const isOurs = (id) => id.startsWith('bcm-');

function buildStyle(key) {
  const bm = CFG.basemaps[key];
  if (bm.style) return bm.style;
  return { version: 8, glyphs: CFG.glyphs, sources: { ...bm.sources }, layers: [...bm.layers] };
}

function firstSymbolIndex(layers) {
  const i = layers.findIndex((l) => l.type === 'symbol' && !isOurs(l.id));
  return i < 0 ? layers.length : i;
}

/** Anchor layers: invisible markers that keep overlays under basemap labels and tracks/pins/GPS above them. */
function addAnchors() {
  const style = S.map.getStyle();
  const sym = style.layers[firstSymbolIndex(style.layers)]?.id;
  ANCHORS.forEach((id, i) => {
    if (S.map.getLayer(id)) return;
    S.map.addLayer({ id, type: 'background', layout: { visibility: 'none' } }, i === 0 ? sym : undefined);
  });
}

/** Carry every bcm- source and layer, and the terrain, from the old style into the new one. */
function carryOver(prev, next) {
  const ours = prev.layers.filter((l) => isOurs(l.id));
  const split = ours.findIndex((l) => l.id === ANCHORS[0]) + 1;
  const base = next.layers.filter((l) => !isOurs(l.id));
  const sym = firstSymbolIndex(base);
  const sources = { ...next.sources };
  for (const [id, src] of Object.entries(prev.sources)) if (isOurs(id)) sources[id] = src;
  return {
    ...next,
    glyphs: next.glyphs || CFG.glyphs,
    sources,
    layers: [...base.slice(0, sym), ...ours.slice(0, split), ...base.slice(sym), ...ours.slice(split)],
    terrain: prev.terrain,
  };
}

export function setBasemap(key) {
  if (S.basemap === key || !CFG.basemaps[key]) return;
  S.basemap = key;
  S.map.setStyle(buildStyle(key), { transformStyle: carryOver });
  Store.saveSettings();
  document.dispatchEvent(new CustomEvent('bcm:basemap', { detail: key }));
}

/* ---- Feature taps: one dispatcher with a finger-sized hit box and priorities, so a tap on a waypoint that sits on a
   track opens exactly one popup (the waypoint). Modules register { match(layerId), priority, handler(feature, e) }. */

const clickables = [];
export function onFeatureClick(match, priority, handler) { clickables.push({ match, priority, handler }); }

function hit(point, r) {
  const feats = S.map.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]]);
  let best = null;
  for (const f of feats) {
    for (const c of clickables) if (c.match(f.layer.id) && (!best || c.priority > best.c.priority)) best = { c, f };
  }
  return best;
}

export function removeLayers(ids) {
  for (const id of ids) if (S.map.getLayer(id)) S.map.removeLayer(id);
}
export function removeSources(ids) {
  for (const id of ids) if (S.map.getSource(id)) S.map.removeSource(id);
}

/* ---- Tool modes: while pin or measure is active, map taps go to the tool and feature popups stay quiet. ---- */

const modeHandlers = {};
export function registerMode(name, { onClick, onExit }) { modeHandlers[name] = { onClick, onExit }; }

export function setMode(name) {
  const prev = S.mode;
  if (prev === name) return;
  S.mode = name || null;
  if (prev) modeHandlers[prev]?.onExit?.();
  document.body.dataset.mode = S.mode || '';
  S.map.getCanvas().style.cursor = S.mode ? 'crosshair' : '';
  if (S.mode) S.map.doubleClickZoom.disable(); else S.map.doubleClickZoom.enable();
  document.dispatchEvent(new CustomEvent('bcm:mode', { detail: S.mode }));
}

/* ---- View: URL hash for sharing, localStorage so an installed app reopens where you left it. ---- */

function initialView() {
  const h = location.hash.slice(1).split('/').map(Number);
  if (h.length >= 3 && h.slice(0, 3).every(Number.isFinite)) {
    return { center: [h[1], h[0]], zoom: h[2], pitch: h[3] || 0, bearing: h[4] || 0 };
  }
  const v = Store.view();
  if (v && Array.isArray(v.center)) return v;
  return { ...CFG.defaultView, pitch: 0, bearing: 0 };
}

const saveView = debounce(() => {
  const c = S.map.getCenter(), z = S.map.getZoom(), p = S.map.getPitch(), b = S.map.getBearing();
  const parts = [c.lat.toFixed(5), c.lng.toFixed(5), z.toFixed(2)];
  if (p > 0.5 || Math.abs(b) > 0.5) parts.push(p.toFixed(0), b.toFixed(0));
  history.replaceState(null, '', `#${parts.join('/')}`);
  Store.saveView({ center: [c.lng, c.lat], zoom: z, pitch: p, bearing: b });
}, 400);

function updateCompass() {
  const b = S.map.getBearing(), p = S.map.getPitch();
  const btn = $('#btn-compass');
  btn.hidden = Math.abs(b) < 0.5 && p < 0.5;
  $('#compass-needle').style.transform = `rotate(${-b}deg)`;
}

export async function initMap() {
  const saved = Store.settings();
  if (saved?.basemap && CFG.basemaps[saved.basemap]) S.basemap = saved.basemap;
  const view = initialView();

  S.map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(S.basemap),
    ...view,
    maxPitch: 80,
    attributionControl: false,
    fadeDuration: 150,
  });
  S.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: CFG.terrainAttribution }), 'bottom-right');
  S.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 110 }), 'bottom-left');

  S.map.on('style.load', addAnchors);
  S.map.on('move', updateCompass);
  S.map.on('moveend', saveView);
  $('#btn-compass').onclick = () => S.map.easeTo({ bearing: 0, pitch: 0, duration: 500 });

  const coarse = matchMedia('(pointer: coarse)').matches;
  S.map.on('click', (e) => {
    if (S.mode) { modeHandlers[S.mode]?.onClick?.(e); return; }
    const best = hit(e.point, coarse ? 14 : 5);
    if (best) best.c.handler(best.f, e);
  });
  let raf = 0;
  S.map.on('mousemove', (e) => {
    if (raf || S.mode) return;
    raf = requestAnimationFrame(() => { raf = 0; S.map.getCanvas().style.cursor = hit(e.point, 3) ? 'pointer' : ''; });
  });

  // Wait for the style only, not every tile ('load'), so panels and tracks are usable on a slow connection.
  await new Promise((resolve) => (S.map.isStyleLoaded() ? resolve() : S.map.once('style.load', resolve)));
  addAnchors();
  updateCompass();
  // Compact attribution opens expanded once it gets text and would cover the scale bar on a phone; fold it when
  // the first render settles (tap the i to read it).
  S.map.once('idle', () => document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
}
