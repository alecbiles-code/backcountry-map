// Elevation profile for the selected track. Chart.js loads on first use. Dragging a finger or the mouse along the
// chart moves a marker along the track on the map; segments are colored by grade.

import { S } from './state.js';
import { FT_PER_M, M_PER_MI, fmt } from './core.js';
import { $, toast } from './ui.js';

const CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js';
let chart = null, trackId = null, marker = null;

export const profileTrackId = () => trackId;

function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: CHART_JS, onload: resolve, onerror: () => reject(new Error('Chart.js failed to load')) });
    document.head.appendChild(s);
  });
}

function gradeColor(pct) {
  const a = Math.abs(pct);
  return a < 4 ? '#6BCB77' : a < 10 ? '#FFD93D' : a < 18 ? '#FF9F5A' : a < 30 ? '#FF6B35' : '#FF6B9D';
}

/** About 600 points from the smoothed series, keeping the source index for the map marker. */
function sample(t) {
  const n = t.coords.length, step = Math.max(1, Math.floor(n / 600)), pts = [];
  for (let i = 0; i < n; i += step) if (t.stats.smoothEle[i] !== null) pts.push({ x: t.stats.cumDist[i] / M_PER_MI, y: t.stats.smoothEle[i] * FT_PER_M, i });
  const last = n - 1;
  if (pts.at(-1)?.i !== last && t.stats.smoothEle[last] !== null) pts.push({ x: t.stats.cumDist[last] / M_PER_MI, y: t.stats.smoothEle[last] * FT_PER_M, i: last });
  return pts;
}

function moveMarker(t, pt) {
  const c = t.coords[pt.i];
  if (!marker) marker = new maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'hover-dot' }) }).setLngLat(c).addTo(S.map);
  else marker.setLngLat(c);
  $('#profile-readout').textContent = `${pt.x.toFixed(2)} mi · ${Math.round(pt.y).toLocaleString('en-US')} ft`;
}

function clearMarker() {
  marker?.remove();
  marker = null;
  $('#profile-readout').textContent = '';
}

export async function showProfile(t) {
  try { await loadChartJs(); } catch (e) { toast(e.message, 'error'); return; }
  trackId = t.id;
  const pts = sample(t);
  const seg = pts.slice(1).map((p, i) => {
    const run = (p.x - pts[i].x) * M_PER_MI, rise = (p.y - pts[i].y) / FT_PER_M;
    return gradeColor(run > 1 ? rise / run * 100 : 0);
  });
  $('#profile-title').textContent = t.name;
  $('#profile-stats').textContent = `${fmt.mi(t.stats.distance)} mi · ↑${fmt.ft(t.stats.gain)} ft · ↓${fmt.ft(t.stats.loss)} ft`;
  $('#profile').hidden = false;
  document.body.classList.add('has-profile');
  chart?.destroy();
  const tick = { color: '#8b92a6', font: { family: 'JetBrains Mono', size: 10 } };
  chart = new Chart($('#profile-canvas'), {
    type: 'line',
    data: { datasets: [{ data: pts, borderColor: t.color, borderWidth: 2, pointRadius: 0, tension: 0.2, fill: true,
      backgroundColor: `${t.color}33`, segment: { borderColor: (c) => seg[c.p0DataIndex] || t.color } }] },
    options: {
      maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { type: 'linear', ticks: { ...tick, maxTicksLimit: 6, callback: (v) => `${Number(v).toFixed(1)} mi` }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { ...tick, maxTicksLimit: 4, callback: (v) => `${Number(v).toLocaleString('en-US')}` }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
      onHover: (_, items) => (items.length ? moveMarker(t, pts[items[0].index]) : clearMarker()),
    },
  });
}

export function hideProfile() {
  trackId = null;
  chart?.destroy();
  chart = null;
  clearMarker();
  $('#profile').hidden = true;
  document.body.classList.remove('has-profile');
}

export function initProfile() {
  $('#profile-close').onclick = () => { hideProfile(); document.dispatchEvent(new CustomEvent('bcm:profile-closed')); };
}
