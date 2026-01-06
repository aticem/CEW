// Shared helpers for "select part of a LineString by box selection" (Leaflet).
// Designed to be reused across modules (MVF today, other line-based workflows later).

export function asLineStrings(latlngs) {
  const out = [];
  const walk = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    if (arr[0] && typeof arr[0].lat === 'number' && typeof arr[0].lng === 'number') {
      out.push(arr);
      return;
    }
    arr.forEach(walk);
  };
  walk(latlngs);
  return out;
}

export function mergeIntervals(arr) {
  const list = (arr || [])
    .filter((x) => Array.isArray(x) && x.length === 2 && Number.isFinite(x[0]) && Number.isFinite(x[1]))
    .map((x) => [Math.min(x[0], x[1]), Math.max(x[0], x[1])])
    .filter((x) => x[1] > x[0]);
  if (list.length === 0) return [];
  list.sort((a, b) => a[0] - b[0]);
  const out = [list[0]];
  for (let i = 1; i < list.length; i++) {
    const cur = list[i];
    const last = out[out.length - 1];
    if (cur[0] <= last[1] + 0.01) last[1] = Math.max(last[1], cur[1]);
    else out.push(cur);
  }
  return out;
}

export function subtractInterval([a0, b0], coveredMerged, minSliverMeters) {
  let cursor = a0;
  const out = [];
  for (const [a, b] of coveredMerged) {
    if (b <= cursor) continue;
    if (a >= b0) break;
    if (a > cursor) out.push([cursor, Math.min(a, b0)]);
    cursor = Math.max(cursor, b);
    if (cursor >= b0) break;
  }
  if (cursor < b0) out.push([cursor, b0]);
  return out.filter((x) => x[1] - x[0] > minSliverMeters);
}

function leafletLatLngBoundsToPixelBounds({ L, map, bounds }) {
  const nw = map.latLngToLayerPoint(bounds.getNorthWest());
  const se = map.latLngToLayerPoint(bounds.getSouthEast());
  const minX = Math.min(nw.x, se.x);
  const maxX = Math.max(nw.x, se.x);
  const minY = Math.min(nw.y, se.y);
  const maxY = Math.max(nw.y, se.y);
  return L.bounds(L.point(minX, minY), L.point(maxX, maxY));
}

function clipLatLngLineToPixelBox({ L, map, lineLatLngs, pixelBounds }) {
  const outSegments = [];
  let current = [];
  for (let i = 0; i < lineLatLngs.length - 1; i++) {
    const a = lineLatLngs[i];
    const b = lineLatLngs[i + 1];
    if (!a || !b) continue;
    const p1 = map.latLngToLayerPoint(a);
    const p2 = map.latLngToLayerPoint(b);
    const clipped = L.LineUtil?.clipSegment?.(p1, p2, pixelBounds);
    if (clipped && clipped.length === 2) {
      const llA = map.layerPointToLatLng(clipped[0]);
      const llB = map.layerPointToLatLng(clipped[1]);
      if (current.length === 0) current.push(llA);
      else {
        const last = current[current.length - 1];
        if (last && (Math.abs(last.lat - llA.lat) > 1e-9 || Math.abs(last.lng - llA.lng) > 1e-9)) {
          current.push(llA);
        }
      }
      current.push(llB);
    } else {
      if (current.length >= 2) outSegments.push(current);
      current = [];
    }
  }
  if (current.length >= 2) outSegments.push(current);
  return outSegments;
}

export function buildCumulativeMeters({ L, lineLatLngs }) {
  const segMeters = [];
  const cum = [0];
  for (let i = 0; i < lineLatLngs.length - 1; i++) {
    const a = lineLatLngs[i];
    const b = lineLatLngs[i + 1];
    const m = a && b ? L.latLng(a.lat, a.lng).distanceTo(L.latLng(b.lat, b.lng)) : 0;
    segMeters.push(m);
    cum.push(cum[cum.length - 1] + m);
  }
  return { segMeters, cum };
}

export function nearestAlongMeters({ map, lineLatLngs, cumData, targetLatLng }) {
  const pT = map.latLngToLayerPoint(targetLatLng);
  let best = { d2: Infinity, along: 0 };
  for (let i = 0; i < lineLatLngs.length - 1; i++) {
    const aLL = lineLatLngs[i];
    const bLL = lineLatLngs[i + 1];
    if (!aLL || !bLL) continue;
    const pA = map.latLngToLayerPoint(aLL);
    const pB = map.latLngToLayerPoint(bLL);
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((pT.x - pA.x) * dx + (pT.y - pA.y) * dy) / len2));
    const px = pA.x + dx * t;
    const py = pA.y + dy * t;
    const ddx = pT.x - px;
    const ddy = pT.y - py;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 < best.d2) {
      const segM = cumData.segMeters[i] || 0;
      best = { d2, along: (cumData.cum[i] || 0) + segM * t };
    }
  }
  return best.along;
}

export function sliceLineByMeters({ lineLatLngs, cumData, startM, endM }) {
  const a = Math.max(0, Math.min(startM, endM));
  const b = Math.max(0, Math.max(startM, endM));
  const out = [];
  if (!(b > a)) return out;
  for (let i = 0; i < lineLatLngs.length - 1; i++) {
    const segStart = cumData.cum[i] || 0;
    const segEnd = cumData.cum[i + 1] || 0;
    if (segEnd <= a) continue;
    if (segStart >= b) break;
    const aLL = lineLatLngs[i];
    const bLL = lineLatLngs[i + 1];
    const segM = cumData.segMeters[i] || 0;
    if (!aLL || !bLL || segM <= 1e-6) continue;
    const t0 = Math.max(0, Math.min(1, (a - segStart) / segM));
    const t1 = Math.max(0, Math.min(1, (b - segStart) / segM));
    const lerp = (u) => [aLL.lat + (bLL.lat - aLL.lat) * u, aLL.lng + (bLL.lng - aLL.lng) * u];
    const p0 = lerp(t0);
    const p1 = lerp(t1);
    if (out.length === 0) out.push(p0);
    else {
      const last = out[out.length - 1];
      if (Math.abs(last[0] - p0[0]) > 1e-9 || Math.abs(last[1] - p0[1]) > 1e-9) out.push(p0);
    }
    out.push(p1);
  }
  return out;
}

/**
 * Compute merged meter-intervals along a line that lie within a selection box.
 */
export function computeIntervalsInBox({
  L,
  map,
  bounds, // L.LatLngBounds
  lineLatLngs,
  minMeters = 0.5,
}) {
  if (!map || !bounds || !Array.isArray(lineLatLngs) || lineLatLngs.length < 2) return [];
  const pixelBounds = leafletLatLngBoundsToPixelBounds({ L, map, bounds });
  const cumData = buildCumulativeMeters({ L, lineLatLngs });
  const intervals = [];
  const clippedPieces = clipLatLngLineToPixelBox({ L, map, lineLatLngs, pixelBounds });
  clippedPieces.forEach((pieceLL) => {
    if (!pieceLL || pieceLL.length < 2) return;
    const a = nearestAlongMeters({ map, lineLatLngs, cumData, targetLatLng: pieceLL[0] });
    const b = nearestAlongMeters({ map, lineLatLngs, cumData, targetLatLng: pieceLL[pieceLL.length - 1] });
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi - lo >= minMeters) intervals.push([lo, hi]);
  });
  return mergeIntervals(intervals);
}

/**
 * Compute NEW (not-yet-covered) line parts inside a box for a single polyline.
 * Returns new parts + updated coveredIntervals for this (fid,lineIndex).
 */
export function computeNewPartsForBox({
  L,
  map,
  bounds, // L.LatLngBounds (selection box)
  fid,
  lineIndex,
  lineLatLngs,
  coveredIntervals = [], // merged intervals in meters along line
  committedPartIds = new Set(), // Set<string>
  idSuffix = '', // optional suffix appended to generated part IDs (e.g. ":seg:SS03-CSS")
  minMeters = 0.5,
  minSliverMeters = 0.2,
}) {
  if (!map || !bounds || !Array.isArray(lineLatLngs) || lineLatLngs.length < 2) {
    return { parts: [], coveredIntervals };
  }

  const pixelBounds = leafletLatLngBoundsToPixelBounds({ L, map, bounds });
  const cumData = buildCumulativeMeters({ L, lineLatLngs });
  let covered = mergeIntervals(coveredIntervals);
  const parts = [];

  const clippedPieces = clipLatLngLineToPixelBox({ L, map, lineLatLngs, pixelBounds });
  clippedPieces.forEach((pieceLL) => {
    if (!pieceLL || pieceLL.length < 2) return;
    const startAlong = nearestAlongMeters({ map, lineLatLngs, cumData, targetLatLng: pieceLL[0] });
    const endAlong = nearestAlongMeters({ map, lineLatLngs, cumData, targetLatLng: pieceLL[pieceLL.length - 1] });
    const lo = Math.min(startAlong, endAlong);
    const hi = Math.max(startAlong, endAlong);
    if (!(hi - lo > minMeters)) return;

    const newIntervals = subtractInterval([lo, hi], covered, minSliverMeters);
    if (newIntervals.length === 0) return;

    covered = mergeIntervals([...covered, ...newIntervals]);

    newIntervals.forEach(([a, b]) => {
      const meters = Math.max(0, b - a);
      if (meters < minMeters) return;
      const id = `${fid}:${lineIndex}:${a.toFixed(2)}-${b.toFixed(2)}${idSuffix || ''}`;
      if (committedPartIds.has(id)) return;
      const coords = sliceLineByMeters({ lineLatLngs, cumData, startM: a, endM: b });
      if (!coords || coords.length < 2) return;
      parts.push({
        id,
        fid: String(fid),
        lineIndex,
        startM: a,
        endM: b,
        coords,
        meters,
      });
    });
  });

  return { parts, coveredIntervals: covered };
}


