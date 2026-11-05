// Terrain from the Terrarium DEM the map already uses for 3D and hillshade:
//   1. A `bcm-dem://<mode>/{z}/{x}/{y}` MapLibre protocol that paints slope or aspect tiles in the browser.
//      This replaced the USGS 3DEP ImageServer, which took 15-18 s per tile and often returned 504.
//   2. elevationAt(lng, lat) for the position readout, pins and the cursor.
// DEM tiles go through the service worker, so a saved offline area keeps slope, aspect and elevation working.

import { CFG } from './config.js';
import { paintDem, metersPerPixel, tileToLat, lngLatToTile, terrariumElevation } from './core.js';

const SIZE = 256;
const cache = new Map(); // "z/x/y" -> Promise<Uint8ClampedArray>, small LRU

function demUrl(z, x, y) {
  return CFG.terrainTiles.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return c;
}

/** RGBA pixels of one DEM tile, decoded once and kept in a small LRU. */
function demPixels(z, x, y, signal) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key); cache.set(key, hit);
    return hit;
  }
  const p = (async () => {
    const r = await fetch(demUrl(z, x, y), { signal });
    if (!r.ok) throw new Error(`DEM tile HTTP ${r.status}`);
    const bmp = await createImageBitmap(await r.blob());
    const ctx = canvas().getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, SIZE, SIZE).data;
  })();
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  while (cache.size > 32) cache.delete(cache.keys().next().value);
  return p;
}

async function loadDemTile(params, abort) {
  const [, mode, z, x, y] = params.url.match(/^bcm-dem:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)/).map((v, i) => (i > 1 ? Number(v) : v));
  const rgba = await demPixels(z, x, y, abort.signal);
  const lat = tileToLat(y + 0.5, z);
  const out = paintDem(mode, rgba, SIZE, metersPerPixel(z, lat));
  const c = canvas();
  c.getContext('2d').putImageData(new ImageData(out, SIZE, SIZE), 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return { data: await blob.arrayBuffer() };
}

export function registerDemProtocol() {
  maplibregl.addProtocol('bcm-dem', loadDemTile);
}

/** Tile template for a DEM-derived raster overlay. */
export const demTiles = (mode) => [`bcm-dem://${mode}/{z}/{x}/{y}`];

/** Ground elevation in meters at a point from the z14 DEM (about 7 m pixels in Colorado), or null. */
export async function elevationAt(lng, lat) {
  const z = CFG.terrainMaxZoom;
  const [fx, fy] = lngLatToTile(lng, lat, z);
  const tx = Math.floor(fx), ty = Math.floor(fy);
  try {
    const rgba = await demPixels(z, tx, ty);
    const px = Math.min(SIZE - 1, Math.floor((fx - tx) * SIZE)), py = Math.min(SIZE - 1, Math.floor((fy - ty) * SIZE));
    const i = (py * SIZE + px) * 4;
    return terrariumElevation(rgba[i], rgba[i + 1], rgba[i + 2]);
  } catch {
    return null;
  }
}
