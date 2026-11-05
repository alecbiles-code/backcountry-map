// node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fmt, haversine, bearing, compass, trackStats, lineCoords, bounds, classifyWaypoint, parseCoords,
  lngLatToTile, tileToLat, tileRange, countTiles, metersPerPixel, terrariumElevation, slopeAspect, slopeColor,
  aspectClass, paintDem, pointInGeometry, dangerAt, pinsToGpx, M_PER_MI,
} from '../js/core.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} +/- ${tol}, got ${a}`);

test('distance is meters and formats as miles or feet, never meters labeled as miles', () => {
  const d = haversine([-106.0, 39.0], [-106.0, 40.0]); // one degree of latitude
  near(d, 111195, 50, 'one degree of latitude');
  assert.equal(fmt.dist(d), '69.09 mi');
  assert.equal(fmt.dist(100), '328 ft');
  assert.equal(fmt.mi(M_PER_MI * 3.25), '3.3');
  assert.equal(fmt.ft(1000), '3,281');
});

test('bearing is a true initial bearing, corrected for latitude', () => {
  near(bearing([-106, 39], [-106, 40]), 0, 0.01, 'due north');
  near(bearing([-106, 40], [-105, 40]), 89.68, 0.05, 'east at 40N curves slightly north');
  near(bearing([-106, 40], [-106, 39]), 180, 0.01, 'due south');
  // The old code used atan2 on raw degrees: a 1 deg lng / 1 deg lat step at 40N read 45 deg. The great-circle
  // initial bearing is 36.93 (a flat cos(lat) approximation gives about 37.3).
  near(bearing([-106, 40], [-105, 41]), 36.93, 0.05, 'NE step at 40N');
  assert.equal(compass(359), 'N');
  assert.equal(compass(225), 'SW');
});

test('track stats: smoothed gain with noise floor, and no fake elevation when the GPX has none', () => {
  const climb = Array.from({ length: 50 }, (_, i) => [-106 + i * 0.001, 39, 3000 + i * 10]);
  const s = trackStats(climb);
  assert.ok(s.hasEle);
  near(s.gain, 490, 40, 'gain');
  assert.equal(s.loss, 0);
  near(s.maxEle, 3490, 20, 'max');
  assert.equal(s.cumDist.length, 50);

  const flat2d = [[-106, 39], [-106.01, 39], [-106.02, 39]];
  const f = trackStats(flat2d);
  assert.equal(f.hasEle, false);
  assert.equal(f.maxEle, null);
  assert.equal(f.gain, 0);
  assert.ok(f.distance > 1500);

  const jitter = Array.from({ length: 40 }, (_, i) => [-106 + i * 0.0005, 39, 3000 + (i % 2 ? 0.4 : -0.4)]);
  assert.equal(trackStats(jitter).gain, 0, 'GPS jitter under the noise floor is not gain');
});

test('lineCoords flattens LineString and MultiLineString in order; bounds pads a point', () => {
  const fc = [
    { geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
    { geometry: { type: 'Point', coordinates: [5, 5] } },
    { geometry: { type: 'MultiLineString', coordinates: [[[2, 2]], [[3, 3]]] } },
  ];
  assert.deepEqual(lineCoords(fc), [[0, 0], [1, 1], [2, 2], [3, 3]]);
  assert.deepEqual(bounds([[1, 2]]), [[0.99, 1.99], [1.01, 2.01]]);
  assert.equal(bounds([]), null);
});

test('waypoint classes', () => {
  assert.equal(classifyWaypoint({ sym: 'Campground' }), 'generic'); // whole words only
  assert.equal(classifyWaypoint({ name: 'Lower camp' }), 'camp');
  assert.equal(classifyWaypoint({ name: 'Mount Elbert summit' }), 'peak');
  assert.equal(classifyWaypoint({ sym: 'Drinking Water' }), 'water');
  assert.equal(classifyWaypoint({ name: 'Trailhead parking' }), 'trailhead');
  assert.equal(classifyWaypoint({}), 'generic');
});

test('typed coordinates parse to [lng, lat]', () => {
  assert.deepEqual(parseCoords('39.6403, -106.3742'), [-106.3742, 39.6403]);
  assert.deepEqual(parseCoords('39.6403 -106.3742'), [-106.3742, 39.6403]);
  assert.deepEqual(parseCoords('39.6403N 106.3742W'), [-106.3742, 39.6403]);
  assert.deepEqual(parseCoords('39.64°, -106.37°'), [-106.37, 39.64]);
  assert.equal(parseCoords('Vail Pass'), null);
  assert.equal(parseCoords('95, 10'), null);
});

test('tile math round-trips and counts', () => {
  const [x, y] = lngLatToTile(-106.3742, 39.6403, 14);
  assert.equal(Math.floor(x), 3350);
  assert.equal(Math.floor(y), 6223);
  near(tileToLat(y, 14), 39.6403, 1e-6);
  const b = [[-106.40, 39.62], [-106.35, 39.66]];
  const r = tileRange(b, 14);
  assert.ok(r.x1 >= r.x0 && r.y1 >= r.y0);
  assert.equal(countTiles(b, 14, 14), (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1));
  assert.equal(countTiles(b, 0, 0), 1);
  near(metersPerPixel(14, 39.64), 7.37, 0.05);
});

function demTile(size, elevFn) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = elevFn(x, y) + 32768, i = (y * size + x) * 4;
    rgba[i] = Math.floor(v / 256); rgba[i + 1] = Math.floor(v % 256); rgba[i + 2] = Math.round((v % 1) * 256); rgba[i + 3] = 255;
  }
  return rgba;
}

test('terrarium decode and Horn slope/aspect on synthetic planes', () => {
  assert.equal(terrariumElevation(128, 0, 0), 0);
  assert.equal(terrariumElevation(140, 100, 128), 3172.5);
  const size = 16, m = 10;
  // Rises 10 m per 10 m pixel to the east: 45 degrees, faces west.
  const east = slopeAspect(demTile(size, (x) => 3000 + x * 10), size, m);
  const c = 8 * size + 8;
  near(east.slope[c], 45, 0.01, 'slope');
  near(east.aspect[c], 270, 0.01, 'aspect faces west');
  // Rises to the north (elevation grows as the row index falls): faces south.
  const north = slopeAspect(demTile(size, (x, y) => 3000 - y * 5), size, m);
  near(north.slope[c], 26.57, 0.01);
  near(north.aspect[c], 180, 0.01, 'aspect faces south');
  assert.equal(aspectClass(180).dir, 'S');
  assert.equal(aspectClass(350).dir, 'N');
});

test('slope classes and painting', () => {
  assert.equal(slopeColor(20), null);
  assert.deepEqual(slopeColor(27), [255, 228, 92]);
  assert.deepEqual(slopeColor(38), [242, 84, 45]);
  assert.deepEqual(slopeColor(70), [43, 58, 140]);
  const size = 8;
  const steep = paintDem('slope', demTile(size, (x) => x * 10), size, 10); // 45 deg
  assert.equal(steep[(4 * size + 4) * 4 + 3], 255, 'interior pixel painted');
  const flat = paintDem('aspect', demTile(size, () => 2000), size, 10);
  assert.equal(flat.reduce((a, v) => a + v, 0), 0, 'flat ground has no aspect color');
});

test('avalanche danger lookup respects the UTC bulletin window and holes', () => {
  const sq = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
  const features = [{
    geometry: { type: 'Polygon', coordinates: [sq(-107, 39, -106, 40), sq(-106.6, 39.4, -106.4, 39.6)] },
    properties: { center_id: 'CAIC', name: 'CAIC zone', danger: 'moderate', danger_level: 2,
      start_date: '2026-11-04T23:30:00', end_date: '2026-11-05T23:30:00', link: 'https://avalanche.state.co.us/' },
  }];
  const now = Date.parse('2026-11-05T12:00:00Z');
  assert.equal(dangerAt(features, -106.2, 39.2, now).level, 2);
  assert.equal(dangerAt(features, -106.5, 39.5, now), null, 'inside the hole');
  assert.equal(dangerAt(features, -105, 39.5, now), null, 'outside every zone');
  assert.equal(dangerAt(features, -106.2, 39.2, Date.parse('2026-11-06T00:00:00Z')).level, 0, 'expired bulletin');
  assert.ok(pointInGeometry([-106.9, 39.9], features[0].geometry));
});

test('pins export as escaped GPX waypoints', () => {
  const g = pinsToGpx([{ lat: 39.5, lng: -106.25, name: 'Camp <1> & "spring"', ts: Date.UTC(2026, 10, 5), ele: 3200 }]);
  assert.match(g, /<wpt lat="39.500000" lon="-106.250000">/);
  assert.match(g, /<name>Camp &lt;1&gt; &amp; &quot;spring&quot;<\/name>/);
  assert.match(g, /<ele>3200.0<\/ele>/);
  assert.match(g, /<time>2026-11-05T00:00:00.000Z<\/time>/);
});

test('GPX features split into sidebar entries per manifest mode', async () => {
  const { splitFeatures, pointCount } = await import('../js/core.js');
  const line = (name) => ({ geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name } });
  const pt = (name) => ({ geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name } });
  const fs = () => [line('Up'), line(''), pt('High camp'), { geometry: { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] }, properties: {} }];
  const split = splitFeatures(fs(), 'split', 'Trip');
  assert.deepEqual(split.map((e) => e.name), ['Up', 'Trip #2', 'Trip · waypoints']);
  assert.equal(split[2].waypointsOnly, true);
  assert.equal(split[2].features[0].properties._kind, 'camp');
  assert.equal(pointCount(split[2].features), 3);
  assert.equal(splitFeatures(fs(), 'grouped', 'Trip').length, 1);
  assert.deepEqual(splitFeatures(fs(), 'byType', 'Trip').map((e) => e.name), ['Trip · Lines', 'Trip · Points']);
  assert.deepEqual(splitFeatures([pt('a')], 'split', 'Pts').map((e) => e.name), ['Pts']);
  assert.deepEqual(splitFeatures([], 'split', 'x'), []);
});

test('several routes in one entry are summed, not joined end to end', async () => {
  const { entryStats } = await import('../js/core.js');
  const ln = (lng) => ({ geometry: { type: 'LineString', coordinates: [[lng, 39, 3000], [lng, 39.01, 3100]] } });
  const one = entryStats([ln(-106)]);
  const two = entryStats([ln(-106), ln(-100)]); // 500 km apart
  near(two.distance, one.distance * 2, 1, 'no jump between routes');
  near(two.gain, one.gain * 2, 1);
  assert.equal(two.maxEle > 3000, true);
  assert.equal(entryStats([]).distance, 0);
});
