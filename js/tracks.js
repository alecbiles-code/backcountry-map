// GPX tracks, routes and waypoints: loading (library manifest, file picker, drag and drop), map rendering, the
// track list, the selected-track card, and persistence.

import { gpx } from '../vendor/togeojson.mjs';
import { CFG } from './config.js';
import { S, Store } from './state.js';
import { onFeatureClick, removeLayers, removeSources } from './map.js';
import { trackStats, entryStats, lineCoords, allCoords, bounds, splitFeatures, pointCount, fmt, WAYPOINT_KINDS } from './core.js';
import { $, esc, icon, toast } from './ui.js';
import { showProfile, hideProfile, profileTrackId } from './profile.js';
import { showWeatherAt } from './weather.js';
import { openSheet } from './sheet.js';

let colorIdx = 0;
const nextColor = () => CFG.trackColors[colorIdx++ % CFG.trackColors.length];
const uid = () => Math.random().toString(36).slice(2, 10);
const L = (id) => ({ src: `bcm-trk-${id}`, pts: `bcm-trk-${id}-pts`, glow: `bcm-trk-${id}-glow`, line: `bcm-trk-${id}-line`,
  fill: `bcm-trk-${id}-fill`, ends: `bcm-trk-${id}-ends`, wpt: `bcm-trk-${id}-wpt`, label: `bcm-trk-${id}-label` });
const trackIdOf = (layerId) => layerId.match(/^bcm-trk-(.+)-(line|fill|wpt)$/)?.[1];

/* ---------- model ---------- */

function makeTrack(part, { id, source, partIdx, library, style = {} }) {
  const coords = lineCoords(part.features);
  return {
    id, source, part: partIdx, library, name: part.name, grouped: !!part.grouped, waypointsOnly: !!part.waypointsOnly,
    geojson: { type: 'FeatureCollection', features: part.features }, coords, stats: entryStats(part.features),
    wptCount: pointCount(part.features), lineCount: part.features.filter((f) => /LineString$/.test(f.geometry.type)).length,
    color: style.color || (part.waypointsOnly ? '#FFD93D' : nextColor()), visible: style.visible !== false,
    lineWidth: style.lineWidth || 3, opacity: style.opacity ?? 0.95,
  };
}

function parseGpx(text) {
  const dom = new DOMParser().parseFromString(text, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('not valid XML');
  return gpx(dom).features || [];
}

/** Parse and add one GPX document. Returns the created tracks. */
function addGpx(text, { name, source, mode = 'split', library = false, styles = {} }) {
  const parts = splitFeatures(parseGpx(text), mode, name);
  if (!parts.length) throw new Error('no tracks, routes or waypoints found');
  return parts.map((part, i) => {
    const id = library ? `lib-${source.replace(/\W+/g, '_')}-${i}` : `trk-${uid()}`;
    const t = makeTrack(part, { id, source, partIdx: i, library, style: styles[`${source}#${i}`] });
    S.tracks.set(t.id, t);
    render(t);
    return t;
  });
}

/* ---------- rendering ---------- */

function render(t) {
  const l = L(t.id), vis = t.visible ? 'visible' : 'none', before = 'bcm-z-tracks';
  const shapes = t.geojson.features.filter((f) => !/Point$/.test(f.geometry.type));
  const points = t.geojson.features.flatMap((f) => (f.geometry.type === 'Point' ? [f]
    : f.geometry.type === 'MultiPoint' ? f.geometry.coordinates.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: f.properties })) : []));
  const add = (spec) => S.map.addLayer({ ...spec, layout: { ...spec.layout, visibility: vis } }, before);
  const lineFilter = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]];

  if (shapes.length) {
    S.map.addSource(l.src, { type: 'geojson', data: { type: 'FeatureCollection', features: shapes } });
    add({ id: l.fill, type: 'fill', source: l.src, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': t.color, 'fill-opacity': 0.18 } });
    add({ id: l.glow, type: 'line', source: l.src, filter: lineFilter, layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': t.color, 'line-width': t.lineWidth * 3, 'line-opacity': t.opacity * 0.25, 'line-blur': 4 } });
    add({ id: l.line, type: 'line', source: l.src, filter: lineFilter, layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': t.color, 'line-width': t.lineWidth, 'line-opacity': t.opacity } });
  }
  const ends = !t.grouped && t.coords.length > 1 ? [['start', t.coords[0]], ['end', t.coords[t.coords.length - 1]]] : [];
  if (points.length || ends.length) {
    const endFeatures = ends.map(([kind, c]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { _end: kind } }));
    S.map.addSource(l.pts, { type: 'geojson', data: { type: 'FeatureCollection', features: [...points, ...endFeatures] } });
    add({ id: l.ends, type: 'circle', source: l.pts, filter: ['has', '_end'],
      paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', '_end'], 'start', '#6BCB77', '#FF6B9D'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    const kindColor = ['match', ['get', '_kind'], ...Object.entries(WAYPOINT_KINDS).flat(), t.color];
    add({ id: l.wpt, type: 'circle', source: l.pts, filter: ['!', ['has', '_end']],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 11, 5, 15, 8], 'circle-color': kindColor, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    add({ id: l.label, type: 'symbol', source: l.pts, minzoom: 11, filter: ['!', ['has', '_end']],
      layout: { 'text-field': ['coalesce', ['get', 'name'], ''], 'text-font': CFG.font, 'text-size': 12, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 9 },
      paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.5 } });
  }
}

function unrender(id) {
  const l = L(id);
  removeLayers([l.fill, l.glow, l.line, l.ends, l.wpt, l.label]);
  removeSources([l.src, l.pts]);
}

/* ---------- map interaction ---------- */

function popup(lngLat, html) {
  return new maplibregl.Popup({ offset: 12, maxWidth: '290px' }).setLngLat(lngLat).setHTML(html).addTo(S.map);
}

function onTrackClick(f, e) {
  const t = S.tracks.get(trackIdOf(f.layer.id));
  if (!t) return;
  if (!t.grouped) { select(t.id); return; }
  const p = f.properties || {};
  // Rendered geometry is clipped to tiles; measure the stored feature instead.
  const s = trackStats(lineCoords([t.geojson.features.find((x) => x.properties?.name === p.name) || f]));
  popup(e.lngLat, `<div class="pop-title" style="color:${t.color}">${esc(p.name || t.name)}</div>
    ${p.desc ? `<div class="pop-desc">${esc(String(p.desc).slice(0, 280))}</div>` : ''}
    ${s.distance ? `<div class="pop-grid"><span>Distance</span><b>${fmt.mi(s.distance)} mi</b>${s.hasEle ? `<span>Gain</span><b>${fmt.ft(s.gain)} ft</b><span>Max</span><b>${fmt.ft(s.maxEle)} ft</b>` : ''}</div>` : ''}
    <div class="pop-sub">in ${esc(t.name)}</div>`);
}

function onWaypointClick(f) {
  const id = trackIdOf(f.layer.id), p = f.properties || {}, [lng, lat] = f.geometry.coordinates;
  const desc = p.desc || p.cmt || '';
  const kind = p._kind && p._kind !== 'generic' ? `<span class="kind" style="--k:${WAYPOINT_KINDS[p._kind]}">${p._kind}</span>` : '';
  popup([lng, lat], `<div class="pop-title">${esc(p.name || 'Waypoint')} ${kind}</div>
    ${desc ? `<div class="pop-desc">${esc(desc.slice(0, 280))}${desc.length > 280 ? '…' : ''}</div>` : ''}
    <div class="pop-grid">${Number.isFinite(Number(p.ele)) && p.ele !== '' && p.ele != null ? `<span>Elevation</span><b>${fmt.ft(Number(p.ele))} ft</b>` : ''}
    <span>Position</span><b class="mono">${lat.toFixed(5)}, ${lng.toFixed(5)}</b></div>
    <div class="pop-sub">in ${esc(S.tracks.get(id).name)}</div>`);
}

/* ---------- selection and the track card ---------- */

export function select(id) {
  const t = S.tracks.get(id);
  if (!t) return;
  S.selectedTrackId = id;
  renderList();
  renderCard(t);
  openSheet('peek');
}

export function deselect() {
  S.selectedTrackId = null;
  $('#track-card').hidden = true;
  hideProfile();
  renderList();
}

function statCells(t) {
  const s = t.stats, cells = [];
  if (s.distance > 0) cells.push([fmt.mi(s.distance), 'mi']);
  if (s.hasEle) cells.push([fmt.ft(s.gain), 'ft gain'], [fmt.ft(s.loss), 'ft loss'], [fmt.ft(s.maxEle), 'ft max']);
  if (t.wptCount) cells.push([t.wptCount, t.wptCount === 1 ? 'point' : 'points']);
  return cells.slice(0, 4);
}

function renderCard(t) {
  const card = $('#track-card');
  const start = t.coords[0] || t.geojson.features.find((f) => f.geometry.type === 'Point')?.geometry.coordinates;
  const canProfile = t.coords.length > 1 && t.stats.hasEle && !t.grouped;
  card.innerHTML = `
    <div class="tc-head"><span class="dot" style="background:${t.color}"></span><span class="tc-name">${esc(t.name)}</span>
      <button class="icon-btn" data-act="close" aria-label="Close">${icon('close', 18)}</button></div>
    <div class="tc-stats">${statCells(t).map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
    <div class="tc-actions">
      ${canProfile ? `<button data-act="profile" aria-pressed="${profileTrackId() === t.id}">${icon('chart', 18)}Profile</button>` : ''}
      ${start ? `<button data-act="weather">${icon('weather', 18)}Weather</button>` : ''}
      <button data-act="fit">${icon('fit', 18)}Zoom to</button>
    </div>`;
  card.hidden = false;
  card.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') deselect();
    else if (act === 'fit') fit([t]);
    else if (act === 'weather') showWeatherAt(start[0], start[1], `Start of ${t.name}`);
    else if (act === 'profile') { if (profileTrackId() === t.id) hideProfile(); else showProfile(t); renderCard(t); }
  };
}

/* ---------- track list ---------- */

function spark(t) {
  const s = t.stats;
  if (!s.hasEle || s.smoothEle.length < 2) return '';
  const N = 60, n = s.smoothEle.length, lo = s.minEle, span = Math.max(1, s.maxEle - lo);
  const pts = Array.from({ length: N }, (_, i) => {
    const e = s.smoothEle[Math.round(i * (n - 1) / (N - 1))] ?? lo;
    return `${(i / (N - 1) * 100).toFixed(1)},${(22 - (e - lo) / span * 20).toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,24 ${pts} 100,24" fill="${t.color}" opacity="0.15"/><polyline points="${pts}" fill="none" stroke="${t.color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

function itemHtml(t) {
  const s = t.stats, bits = [];
  if (s.distance > 0) bits.push(`${fmt.mi(s.distance)} mi`);
  if (s.hasEle && s.gain > 0) bits.push(`${fmt.ft(s.gain)} ft gain`);
  if (t.wptCount) bits.push(`${t.wptCount} ${t.wptCount === 1 ? 'point' : 'points'}`);
  if (t.grouped && t.lineCount > 1) bits.push(`${t.lineCount} lines`);
  return `<li class="trk${S.selectedTrackId === t.id ? ' selected' : ''}${t.visible ? '' : ' off'}" data-id="${t.id}">
    <button class="trk-main" data-act="select"><span class="trk-color" style="background:${t.color}"></span>
      <span class="trk-body"><span class="trk-name">${esc(t.name)}</span><span class="trk-meta">${bits.join(' · ') || '&nbsp;'}</span>${spark(t)}</span></button>
    <button class="icon-btn" data-act="visible" aria-label="${t.visible ? 'Hide' : 'Show'} ${esc(t.name)}" aria-pressed="${t.visible}">${icon(t.visible ? 'eye' : 'eyeOff', 20)}</button>
    <button class="icon-btn" data-act="edit" aria-label="Style ${esc(t.name)}" aria-expanded="false">${icon('more', 20)}</button>
    <div class="trk-edit" hidden>
      <div class="swatches">${CFG.trackColors.map((c) => `<button class="swatch${c === t.color ? ' on' : ''}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('')}</div>
      <label>Width <input type="range" min="1" max="8" step="0.5" value="${t.lineWidth}" data-prop="lineWidth"></label>
      <label>Opacity <input type="range" min="0.2" max="1" step="0.05" value="${t.opacity}" data-prop="opacity"></label>
      ${t.library ? '<p class="fineprint">Library file: remove it from manifest.json to drop it.</p>' : `<button class="danger-btn" data-act="delete">${icon('trash', 16)} Remove</button>`}
    </div></li>`;
}

export function renderList() {
  const all = [...S.tracks.values()], lib = all.filter((t) => t.library), mine = all.filter((t) => !t.library);
  $('#tracks-count').textContent = all.length || '';
  const section = (title, list) => (list.length ? `<h3 class="sec-title">${title}</h3><ul class="trk-list">${list.map(itemHtml).join('')}</ul>` : '');
  $('#track-list').innerHTML = all.length ? section('Library', lib) + section('Your files', mine)
    : `<button class="empty" data-act="add">${icon('route', 28)}<b>No tracks yet</b><span>Add a GPX file, or drop one on the map.</span></button>`;
}

function onListClick(e) {
  const btn = e.target.closest('[data-act], [data-color]');
  if (!btn) return;
  if (btn.dataset.act === 'add') { $('#file-input').click(); return; }
  const id = btn.closest('.trk')?.dataset.id, t = S.tracks.get(id);
  if (!t) return;
  if (btn.dataset.color) setStyle(t, { color: btn.dataset.color });
  else if (btn.dataset.act === 'select') { if (!t.visible) setStyle(t, { visible: true }); select(id); fit([t]); }
  else if (btn.dataset.act === 'visible') setStyle(t, { visible: !t.visible });
  else if (btn.dataset.act === 'delete') remove(id);
  else if (btn.dataset.act === 'edit') {
    const panel = btn.parentElement.querySelector('.trk-edit');
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
  }
}

function onListInput(e) {
  const prop = e.target.dataset.prop, t = S.tracks.get(e.target.closest('.trk')?.dataset.id);
  if (prop && t) setStyle(t, { [prop]: Number(e.target.value) }, false);
}

function setStyle(t, patch, rerenderList = true) {
  Object.assign(t, patch);
  const l = L(t.id), set = (id, k, v) => S.map.getLayer(id) && S.map.setPaintProperty(id, k, v);
  set(l.line, 'line-color', t.color); set(l.glow, 'line-color', t.color); set(l.fill, 'fill-color', t.color);
  set(l.line, 'line-width', t.lineWidth); set(l.glow, 'line-width', t.lineWidth * 3);
  set(l.line, 'line-opacity', t.opacity); set(l.glow, 'line-opacity', t.opacity * 0.25);
  for (const id of Object.values(l)) if (S.map.getLayer(id)) S.map.setLayoutProperty(id, 'visibility', t.visible ? 'visible' : 'none');
  if (!t.visible && S.selectedTrackId === t.id) deselect();
  if (rerenderList) renderList();
  if (S.selectedTrackId === t.id) renderCard(t);
  persist();
}

function remove(id) {
  unrender(id);
  S.tracks.delete(id);
  if (S.selectedTrackId === id) deselect();
  renderList();
  persist();
}

/* ---------- fitting ---------- */

export function fit(tracks) {
  const b = bounds(tracks.flatMap((t) => allCoords(t.geojson.features)));
  if (!b) { toast('Nothing to zoom to'); return; }
  const pad = matchMedia('(max-width: 720px)').matches ? { top: 90, bottom: 190, left: 30, right: 70 } : 70;
  S.map.fitBounds(b, { padding: pad, duration: 800, maxZoom: 14 });
}

export const fitAll = () => fit([...S.tracks.values()].filter((t) => t.visible));

/* ---------- loading and persistence ---------- */

function persist() {
  if (!Store.saveTracks()) toast('Storage is full: your dropped GPX files will not survive a reload.', 'error', 5000);
}

export async function addFiles(files) {
  const added = [];
  for (const file of files) {
    if (!/\.gpx$/i.test(file.name)) { toast(`${file.name} is not a .gpx file`, 'error'); continue; }
    try { added.push(...addGpx(await file.text(), { name: file.name.replace(/\.gpx$/i, ''), source: file.name })); }
    catch (e) { toast(`${file.name}: ${e.message}`, 'error'); }
  }
  if (!added.length) return;
  renderList();
  persist();
  fit(added);
  toast(`Added ${added.length} ${added.length === 1 ? 'entry' : 'entries'}`, 'success');
}

/** manifest.json lists library files in gpx/. They reload fresh every visit and never move the map. */
async function loadLibrary() {
  let m;
  try { const r = await fetch('./manifest.json', { cache: 'no-cache' }); if (!r.ok) return; m = await r.json(); } catch { return; }
  const styles = Store.trackStyles();
  const entries = (m.files || []).map((e) => (typeof e === 'string' ? { file: e } : e)).filter((e) => e.file);
  const texts = await Promise.all(entries.map(async (e) => {
    try { const r = await fetch(`./gpx/${e.file}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }
    catch (err) { toast(`Library file ${e.file}: ${err.message}`, 'error'); return null; }
  }));
  entries.forEach((e, i) => {
    if (texts[i] === null) return;
    const mode = e.grouped ? 'grouped' : e.groupByGeomType ? 'byType' : 'split';
    try { addGpx(texts[i], { name: e.name || e.file.replace(/\.gpx$/i, ''), source: `./gpx/${e.file}`, mode, library: true, styles }); }
    catch (err) { toast(`Library file ${e.file}: ${err.message}`, 'error'); }
  });
}

function restoreDropped() {
  for (const saved of Store.tracks()) {
    if (!saved?.geojson?.features) continue;
    const part = { name: saved.name, features: saved.geojson.features, grouped: saved.grouped, waypointsOnly: saved.waypointsOnly };
    const t = makeTrack(part, { id: saved.id, source: saved.source, partIdx: saved.part, library: false, style: saved });
    S.tracks.set(t.id, t);
    render(t);
  }
}

export async function initTracks() {
  onFeatureClick((id) => /^bcm-trk-.+-wpt$/.test(id), 30, onWaypointClick);
  onFeatureClick((id) => /^bcm-trk-.+-(line|fill)$/.test(id), 20, onTrackClick);
  $('#track-list').addEventListener('click', onListClick);
  $('#track-list').addEventListener('input', onListInput);
  $('#btn-add-gpx').onclick = () => $('#file-input').click();
  $('#btn-fit-all').onclick = fitAll;
  document.addEventListener('bcm:profile-closed', () => { const t = S.tracks.get(S.selectedTrackId); if (t) renderCard(t); });
  $('#file-input').onchange = async (e) => { await addFiles([...e.target.files]); e.target.value = ''; };
  const zone = $('#map-wrap'), over = $('#drop-overlay');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); over.hidden = false; });
  zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) over.hidden = true; });
  zone.addEventListener('drop', (e) => { e.preventDefault(); over.hidden = true; addFiles([...e.dataTransfer.files]); });
  restoreDropped();
  renderList();
  await loadLibrary();
  renderList();
}
