// Boot order: panel and controls first (they work even if the map style is slow), then the map, then everything
// that adds map layers, then the GPX library last because it is the largest download.

import { S } from './state.js';
import { initMap, setMode } from './map.js';
import { registerDemProtocol } from './dem.js';
import { initLayers } from './layers.js';
import { initTracks, deselect, fitAll } from './tracks.js';
import { initProfile, hideProfile } from './profile.js';
import { initWeather, hideWeather } from './weather.js';
import { initTools } from './tools.js';
import { initLocate } from './locate.js';
import { initSearch } from './search.js';
import { initSheet, showTab } from './sheet.js';
import { initOffline, registerServiceWorker } from './offline.js';
import { $, toast } from './ui.js';

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); document.body.classList.toggle('panel-closed'); return; }
  if (e.target.closest('input, textarea, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === '/') { e.preventDefault(); $('#search').focus(); }
  else if (k === 'escape') {
    if (S.mode) setMode(null);
    else if (!$('#weather').hidden) hideWeather();
    else if (!$('#profile').hidden) hideProfile();
    else if (S.selectedTrackId) deselect();
  }
  else if (k === '3') $('#btn-3d').click();
  else if (k === 'p') $('#btn-pin').click();
  else if (k === 'm') $('#btn-measure').click();
  else if (k === 'l') $('#btn-locate').click();
  else if (k === 'f') fitAll();
  else if (k === 't') showTab('tracks');
}

async function boot() {
  registerServiceWorker();
  registerDemProtocol();
  initSheet();
  initSearch();
  document.addEventListener('keydown', onKey);
  try {
    await initMap();
  } catch (e) {
    console.error(e);
    toast('The map could not start. Check your connection, or that WebGL is enabled.', 'error', 8000);
    return;
  }
  initLayers();
  initLocate();
  initTools();
  initProfile();
  initWeather();
  initOffline();
  await initTracks();
}

boot();
