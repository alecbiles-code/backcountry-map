// GPS: a live position dot with accuracy circle and compass heading, follow mode, and the position readout.
// The old Locate button flew to one getCurrentPosition fix and drew nothing, so you could not see where you were.
//
// Button cycle: off -> follow (camera tracks you) -> panning the map drops to "free" (dot keeps updating) ->
// tap recenters and follows again -> tap while following turns GPS off.

import { S } from './state.js';
import { fmt } from './core.js';
import { elevationAt } from './dem.js';
import { $, icon, toast, copyText, debounce } from './ui.js';

const ACC = 'bcm-gps-acc';
const gps = { state: 'off', watch: null, fix: null, marker: null, heading: null, wake: null, firstFix: false };

export const currentFix = () => gps.fix;

function circle(lng, lat, meters, n = 48) {
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * 2 * Math.PI;
    ring.push([lng + meters / (111320 * Math.cos(lat * Math.PI / 180)) * Math.cos(a), lat + meters / 110540 * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
}

function addAccuracyLayer() {
  S.map.addSource(ACC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  S.map.addLayer({ id: ACC, type: 'fill', source: ACC, paint: { 'fill-color': '#4A9EFF', 'fill-opacity': 0.12 } }, 'bcm-z-gps');
  S.map.addLayer({ id: `${ACC}-line`, type: 'line', source: ACC, paint: { 'line-color': '#4A9EFF', 'line-width': 1, 'line-opacity': 0.5 } }, 'bcm-z-gps');
}

function setState(state) {
  gps.state = state;
  const btn = $('#btn-locate');
  btn.dataset.state = state;
  btn.innerHTML = icon(state === 'follow' ? 'locateOn' : 'locate', 22);
  btn.setAttribute('aria-label', { off: 'Show my location', follow: 'Following your location. Tap to turn off', free: 'Center on my location', wait: 'Finding your location' }[state]);
  document.body.classList.toggle('gps-on', state !== 'off');
  if (state === 'follow') keepAwake(); else releaseAwake();
}

/* Keep the screen on while following, as a navigation app should. Released when GPS stops or the tab hides. */
async function keepAwake() {
  if (gps.wake || !('wakeLock' in navigator)) return;
  try { gps.wake = await navigator.wakeLock.request('screen'); gps.wake.addEventListener('release', () => { gps.wake = null; }); } catch { /* not allowed */ }
}
function releaseAwake() { gps.wake?.release(); gps.wake = null; }

function onFix(pos) {
  const { longitude: lng, latitude: lat, accuracy, altitude, heading, speed } = pos.coords;
  gps.fix = { lng, lat, accuracy, altitude, ts: pos.timestamp };
  if (!gps.marker) {
    const el = Object.assign(document.createElement('div'), { className: 'gps-dot', innerHTML: '<span class="gps-cone"></span><span class="gps-core"></span>' });
    gps.marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([lng, lat]).addTo(S.map);
  }
  gps.marker.setLngLat([lng, lat]);
  if (Number.isFinite(heading) && speed > 0.5) setHeading(heading);
  S.map.getSource(ACC)?.setData(circle(lng, lat, accuracy));
  if (gps.state === 'wait') setState('follow');
  if (gps.state === 'follow') {
    S.map.easeTo({ center: [lng, lat], zoom: gps.firstFix ? S.map.getZoom() : Math.max(S.map.getZoom(), 14), duration: gps.firstFix ? 500 : 1000, essential: true });
    gps.firstFix = true;
  }
  showFix();
}

function onError(err) {
  const msg = err.code === 1 ? 'Location permission is off. Allow it for this site in your browser settings.'
    : err.code === 3 ? 'Still looking for a GPS fix. Try in the open, away from buildings.' : 'Location unavailable.';
  toast(msg, 'error', 5000);
  if (err.code === 1 || !gps.fix) stop();
}

function setHeading(deg) {
  gps.heading = deg;
  const el = gps.marker?.getElement();
  if (el) { el.classList.add('has-heading'); el.querySelector('.gps-cone').style.transform = `rotate(${deg}deg)`; }
}

function onOrientation(e) {
  const h = Number.isFinite(e.webkitCompassHeading) ? e.webkitCompassHeading : e.absolute && Number.isFinite(e.alpha) ? 360 - e.alpha : null;
  if (h !== null) setHeading(h);
}

async function startCompass() {
  // iOS asks for motion permission, and only from a tap.
  try { if (typeof DeviceOrientationEvent?.requestPermission === 'function' && (await DeviceOrientationEvent.requestPermission()) !== 'granted') return; } catch { return; }
  window.addEventListener('deviceorientationabsolute', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
}

function start() {
  if (!('geolocation' in navigator)) { toast('This browser has no location support.', 'error'); return; }
  if (!window.isSecureContext) { toast('Location needs HTTPS. Open the site over https://', 'error', 5000); return; }
  gps.firstFix = false;
  setState('wait');
  startCompass();
  gps.watch = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}

function stop() {
  if (gps.watch !== null) navigator.geolocation.clearWatch(gps.watch);
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  window.removeEventListener('deviceorientation', onOrientation);
  gps.watch = null;
  gps.fix = null;
  gps.marker?.remove();
  gps.marker = null;
  S.map.getSource(ACC)?.setData({ type: 'FeatureCollection', features: [] });
  setState('off');
  showCenter();
}

function onLocateTap() {
  if (gps.state === 'off') start();
  else if (gps.state === 'free' && gps.fix) { setState('follow'); onFix({ coords: { longitude: gps.fix.lng, latitude: gps.fix.lat, accuracy: gps.fix.accuracy, altitude: gps.fix.altitude }, timestamp: gps.fix.ts }); }
  else stop();
}

/* ---------- readout: GPS fix when on, otherwise the map center (touch) or the cursor (mouse) ---------- */

let readoutLL = null;
function setReadout(kind, lng, lat, eleM, extra = '') {
  readoutLL = [lng, lat];
  $('#ro-kind').textContent = kind;
  $('#ro-ll').textContent = `${fmt.ll(lat)}, ${fmt.ll(lng)}`;
  $('#ro-ele').textContent = eleM == null ? '' : `${fmt.ft(eleM)} ft`;
  $('#ro-extra').textContent = extra;
}

async function showFix() {
  const f = gps.fix;
  if (!f) return;
  // Phone GPS altitude is often 30+ m off; the DEM under the dot is the better number when it is available.
  const dem = await elevationAt(f.lng, f.lat);
  setReadout('GPS', f.lng, f.lat, dem ?? f.altitude, `±${fmt.ft(f.accuracy)} ft`);
}

const showCenter = debounce(async () => {
  if (gps.fix) return;
  const c = S.map.getCenter();
  setReadout('Center', c.lng, c.lat, undefined);
  const ele = await elevationAt(c.lng, c.lat);
  if (!gps.fix) setReadout('Center', c.lng, c.lat, ele);
}, 250);

const showCursor = debounce(async (ll) => {
  if (gps.fix) return;
  const ele = await elevationAt(ll.lng, ll.lat);
  if (!gps.fix) setReadout('Cursor', ll.lng, ll.lat, ele);
}, 120);

export function initLocate() {
  addAccuracyLayer();
  setState('off');
  $('#btn-locate').onclick = onLocateTap;
  // A drag, pinch or wheel by the user ends follow mode; our own easeTo has no originalEvent.
  S.map.on('movestart', (e) => { if (e.originalEvent && gps.state === 'follow') setState('free'); });
  S.map.on('moveend', showCenter);
  if (matchMedia('(pointer: fine)').matches) {
    S.map.on('mousemove', (e) => { if (!gps.fix) { setReadout('Cursor', e.lngLat.lng, e.lngLat.lat, undefined); showCursor(e.lngLat); } });
    S.map.getCanvas().addEventListener('mouseleave', showCenter);
  }
  $('#readout').onclick = () => readoutLL && copyText(`${readoutLL[1].toFixed(5)}, ${readoutLL[0].toFixed(5)}`, 'Copied');
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && gps.state === 'follow') keepAwake(); });
  showCenter();
}
