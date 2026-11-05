// Point forecast (Open-Meteo) with today's avalanche danger (avalanche.org), opened by long-press, right-click, the
// track card, or the conditions chip. The chip in the bottom bar tracks the map center.

import { CFG } from './config.js';
import { S } from './state.js';
import { fmt, compass, dangerAt, DANGER } from './core.js';
import { avalancheZones } from './layers.js';
import { elevationAt } from './dem.js';
import { $, esc, icon } from './ui.js';

const SKY = {
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  part: '<path d="M8 5.5V4M3.8 7.8 2.7 6.7M12.2 7.8l1.1-1.1M3 12H1.5"/><path d="M5.5 12a3 3 0 0 1 5.7-1.3"/><path d="M17.5 20a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.6A3.3 3.3 0 0 0 7.5 20z"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 6.5 19z"/>',
  fog: '<path d="M4 9h16M2 13h20M5 17h14M8 21h8"/>',
  rain: '<path d="M17.5 15a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 6.5 15"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path d="M17.5 14a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 6.5 14"/><path d="M8 18h.01M12 17h.01M16 18h.01M10 21h.01M14 21h.01"/>',
  storm: '<path d="M17.5 14a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.8A3.6 3.6 0 0 0 6.5 14"/><path d="M12 13l-2 4h4l-2 4"/>',
};

/** WMO weather code -> [icon, text]. */
function sky(code) {
  if (code === 0) return ['sun', 'Clear'];
  if (code <= 2) return ['part', code === 1 ? 'Mostly clear' : 'Partly cloudy'];
  if (code === 3) return ['cloud', 'Overcast'];
  if (code <= 48) return ['fog', 'Fog'];
  if (code <= 67) return ['rain', code < 60 ? 'Drizzle' : code >= 66 ? 'Freezing rain' : 'Rain'];
  if (code <= 77) return ['snow', code === 71 ? 'Light snow' : code === 75 ? 'Heavy snow' : 'Snow'];
  if (code <= 82) return ['rain', 'Rain showers'];
  if (code <= 86) return ['snow', 'Snow showers'];
  return ['storm', 'Thunderstorm'];
}

export function skyIcon(code, size = 24) {
  return `<svg class="sky" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SKY[sky(code)[0]]}</svg>`;
}

async function forecast(lat, lng, full) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lng.toFixed(4), timezone: 'auto',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,relative_humidity_2m',
    ...(full ? { daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum,sunrise,sunset', forecast_days: '7' } : {}),
  });
  const r = await fetch(`${CFG.weatherApi}?${q}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function danger(lng, lat) {
  try { return dangerAt((await avalancheZones()).features, lng, lat); } catch { return null; }
}

function avyLink(d, lat, lng) {
  if (d?.center === 'CAIC') return CFG.caicForecast;
  return d?.link || `https://avalanche.org/#/current?lat=${lat.toFixed(3)}&lng=${lng.toFixed(3)}`;
}

function dailyRows(d) {
  const lo = Math.min(...d.temperature_2m_min), span = Math.max(1, Math.max(...d.temperature_2m_max) - lo);
  return d.time.map((t, i) => {
    const day = i === 0 ? 'Today' : new Date(`${t}T12:00`).toLocaleDateString('en-US', { weekday: 'short' });
    const left = (d.temperature_2m_min[i] - lo) / span * 100, width = Math.max(6, (d.temperature_2m_max[i] - d.temperature_2m_min[i]) / span * 100);
    const snow = d.snowfall_sum[i] ?? 0, pop = d.precipitation_probability_max[i] ?? 0;
    return `<div class="wx-day"><span class="wx-dname">${day}</span>${skyIcon(d.weather_code[i], 20)}
      <span class="wx-bar"><i style="left:${left}%;width:${width}%"></i></span>
      <span class="wx-temps"><b>${fmt.tempF(d.temperature_2m_max[i])}°</b> ${fmt.tempF(d.temperature_2m_min[i])}°</span>
      <span class="wx-precip">${snow >= 0.25 ? `${fmt.inches(snow)}" snow` : pop >= 20 ? `${pop}%` : ''}</span></div>`;
  }).join('');
}

function render(data, d, ele, lat, lng, title) {
  const c = data.current, [, text] = sky(c.weather_code), lvl = DANGER[d?.level || 0];
  const sunrise = new Date(data.daily.sunrise[0]), sunset = new Date(data.daily.sunset[0]);
  const time = (x) => x.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  $('#wx-body').innerHTML = `
    <div class="wx-now">${skyIcon(c.weather_code, 44)}<div><div class="wx-temp">${fmt.tempF(c.temperature_2m)}°F</div><div class="wx-text">${text} · feels ${fmt.tempF(c.apparent_temperature)}°</div></div></div>
    <div class="wx-meta">
      <div><span>Wind</span><b>${fmt.mph(c.wind_speed_10m)} mph ${compass(c.wind_direction_10m)}</b></div>
      <div><span>Gusts</span><b>${fmt.mph(c.wind_gusts_10m)} mph</b></div>
      <div><span>Sun</span><b>${time(sunrise)} to ${time(sunset)}</b></div>
      <div><span>Elevation</span><b>${ele !== null ? `${fmt.ft(ele)} ft` : 'n/a'}</b></div>
    </div>
    <a class="wx-avy" href="${esc(avyLink(d, lat, lng))}" target="_blank" rel="noopener">
      <span class="danger-dot" style="background:${lvl.color}"></span>
      <span>${d ? `${esc(d.center)} avalanche danger: <b>${lvl.label}</b>` : 'Avalanche forecast (avalanche.org)'}</span>${icon('external', 16)}
    </a>
    <div class="wx-days">${dailyRows(data.daily)}</div>`;
  $('#wx-title').textContent = title || 'Forecast';
  $('#wx-loc').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

let wxMarker = null;
export async function showWeatherAt(lng, lat, title) {
  wxMarker?.remove();
  wxMarker = new maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'wx-dot' }) }).setLngLat([lng, lat]).addTo(S.map);
  $('#weather').hidden = false;
  $('#wx-title').textContent = title || 'Forecast';
  $('#wx-loc').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  $('#wx-body').innerHTML = '<div class="wx-loading"><span class="spinner"></span>Loading forecast</div>';
  try {
    const [data, d, ele] = await Promise.all([forecast(lat, lng, true), danger(lng, lat), elevationAt(lng, lat)]);
    render(data, d, ele, lat, lng, title);
  } catch (e) {
    $('#wx-body').innerHTML = `<div class="wx-loading">Forecast unavailable (${esc(e.message)}). Weather needs a connection.</div>`;
  }
}

export function hideWeather() {
  $('#weather').hidden = true;
  wxMarker?.remove();
  wxMarker = null;
}

/* ---------- conditions chip: map center, refreshed when the map moves about 30 km ---------- */

let last = null, busy = false;
async function refreshChip(force = false) {
  const c = S.map.getCenter();
  if (busy || (!force && last && Math.hypot(c.lat - last.lat, c.lng - last.lng) < 0.3)) return;
  busy = true;
  last = { lat: c.lat, lng: c.lng };
  try {
    const [data, d] = await Promise.all([forecast(c.lat, c.lng, false), danger(c.lng, c.lat)]);
    const lvl = DANGER[d?.level || 0];
    $('#chip-wx').innerHTML = `${skyIcon(data.current.weather_code, 20)}<b>${fmt.tempF(data.current.temperature_2m)}°</b>${d ? `<span class="danger-dot" style="background:${lvl.color}" title="Avalanche danger: ${lvl.label}"></span><span class="chip-danger">${lvl.short}</span>` : ''}`;
    $('#chip-wx').setAttribute('aria-label', `Weather at map center ${fmt.tempF(data.current.temperature_2m)} degrees${d ? `, avalanche danger ${lvl.label}` : ''}`);
  } catch {
    $('#chip-wx').innerHTML = `${icon('weather', 20)}<b>--</b>`;
    last = null;
  } finally { busy = false; }
}

export function initWeather() {
  $('#wx-close').onclick = hideWeather;
  $('#chip-wx').onclick = () => { const c = S.map.getCenter(); showWeatherAt(c.lng, c.lat, 'Map center'); };
  S.map.on('contextmenu', (e) => { e.preventDefault(); showWeatherAt(e.lngLat.lng, e.lngLat.lat); });
  // Long-press on touch. MapLibre has no long-press event, so time a still single finger.
  let timer = null, start = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  S.map.on('touchstart', (e) => {
    cancel();
    if (e.points.length !== 1 || S.mode) return;
    start = e.point;
    const ll = e.lngLat;
    timer = setTimeout(() => { navigator.vibrate?.(30); showWeatherAt(ll.lng, ll.lat); }, 600);
  });
  S.map.on('touchmove', (e) => { if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 10) cancel(); });
  S.map.on('touchend', cancel);
  S.map.on('touchcancel', cancel);
  S.map.on('movestart', (e) => { if (e.originalEvent?.touches?.length > 1) cancel(); });
  refreshChip(true);
  let t;
  S.map.on('moveend', () => { clearTimeout(t); t = setTimeout(refreshChip, 1500); });
}
