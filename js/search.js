// Place search (Nominatim, US only) and typed coordinates ("39.64, -106.37" or "39.64N 106.37W").

import { CFG } from './config.js';
import { S } from './state.js';
import { parseCoords } from './core.js';
import { $, esc, debounce } from './ui.js';

let abort = null, marker = null;

function goTo(lng, lat, bbox) {
  marker?.remove();
  marker = new maplibregl.Marker({ color: '#FF6B35' }).setLngLat([lng, lat]).addTo(S.map);
  if (bbox) S.map.fitBounds(bbox, { padding: 60, duration: 900, maxZoom: 14 });
  else S.map.flyTo({ center: [lng, lat], zoom: Math.max(S.map.getZoom(), 13), duration: 900 });
  close();
  $('#search').blur();
}

function close() { $('#search-results').hidden = true; }

function show(html) {
  $('#search-results').innerHTML = html;
  $('#search-results').hidden = false;
}

const lookup = debounce(async (q) => {
  abort?.abort();
  if (q.length < 3) { close(); return; }
  abort = new AbortController();
  try {
    const params = new URLSearchParams({ q, format: 'json', limit: '6', countrycodes: 'us' });
    const r = await fetch(`${CFG.geocodeApi}?${params}`, { signal: abort.signal, headers: { 'Accept-Language': 'en' } });
    const results = await r.json();
    show(results.length ? results.map((x) => {
      const [name, ...rest] = x.display_name.split(',');
      const bb = x.boundingbox.map(Number);
      return `<li><button data-lng="${x.lon}" data-lat="${x.lat}" data-bb="${[bb[2], bb[0], bb[3], bb[1]].join(',')}"><b>${esc(name)}</b><span>${esc(rest.slice(0, 3).join(',').trim())}</span></button></li>`;
    }).join('') : '<li class="none">No places found</li>');
  } catch (e) {
    if (e.name !== 'AbortError') show('<li class="none">Search needs a connection</li>');
  }
}, 350);

export function initSearch() {
  const input = $('#search');
  input.addEventListener('input', () => {
    const ll = parseCoords(input.value);
    if (ll) { abort?.abort(); show(`<li><button data-lng="${ll[0]}" data-lat="${ll[1]}"><b>Go to ${ll[1]}, ${ll[0]}</b><span>Coordinates</span></button></li>`); return; }
    lookup(input.value.trim());
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
    if (e.key === 'Enter') $('#search-results button')?.click();
  });
  $('#search-results').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lng]');
    if (!b) return;
    const bb = b.dataset.bb?.split(',').map(Number);
    goTo(Number(b.dataset.lng), Number(b.dataset.lat), bb && [[bb[0], bb[1]], [bb[2], bb[3]]]);
    input.value = b.querySelector('b').textContent.replace(/^Go to /, '');
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.search')) close(); });
}
