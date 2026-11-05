// Shared runtime state and localStorage persistence. Every storage call tolerates private mode and a full quota.

export const S = {
  map: null,
  basemap: 'topo',
  layers: {},          // overlay key -> boolean
  tracks: new Map(),   // id -> track
  selectedTrackId: null,
  pins: [],
};

const KEYS = {
  tracks: 'bcm.tracks.v1',
  trackStyles: 'bcm.track-styles.v1',
  settings: 'bcm.settings.v1',
  view: 'bcm.view.v1',
  pins: 'bcm.pins.v1',
  areas: 'bcm.offline-areas.v1',
};

function read(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

/** Returns false when the browser refused the write (quota or private mode). */
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { console.warn('[store]', key, e); return false; }
}

export const Store = {
  settings: () => read(KEYS.settings, null),
  saveSettings: () => write(KEYS.settings, { basemap: S.basemap, layers: S.layers }),
  view: () => read(KEYS.view, null),
  saveView: (v) => write(KEYS.view, v),
  pins: () => read(KEYS.pins, []),
  savePins: () => write(KEYS.pins, S.pins),
  areas: () => read(KEYS.areas, []),
  saveAreas: (a) => write(KEYS.areas, a),
  tracks: () => read(KEYS.tracks, []),
  trackStyles: () => read(KEYS.trackStyles, {}),

  /**
   * Dropped tracks persist whole; library tracks reload from gpx/ every visit, so only their style is kept.
   * Returns false if the dropped tracks did not fit in storage.
   */
  saveTracks() {
    const style = (t) => ({ color: t.color, visible: t.visible, lineWidth: t.lineWidth, opacity: t.opacity });
    const dropped = [], styles = {};
    for (const t of S.tracks.values()) {
      if (t.library) styles[`${t.source}#${t.part}`] = style(t);
      else dropped.push({ id: t.id, name: t.name, source: t.source, part: t.part, geojson: t.geojson,
        grouped: t.grouped, waypointsOnly: t.waypointsOnly, ...style(t) });
    }
    write(KEYS.trackStyles, styles);
    return write(KEYS.tracks, dropped);
  },
};
