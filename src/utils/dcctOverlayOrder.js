// Small pure helper so we can test DCCT overlay ordering without Leaflet.

/**
 * Returns ids ordered so that bringToFrontId (if present) is last.
 * This mirrors the in-module DCCT overlay ordering (last rendered = top).
 *
 * @param {Record<string, unknown> | null | undefined} labelsById
 * @param {string | null | undefined} bringToFrontId
 */
export function getOrderedOverlayIds(labelsById, bringToFrontId) {
  const ids = Object.keys(labelsById || {});
  if (!bringToFrontId) return ids;
  const idx = ids.indexOf(bringToFrontId);
  if (idx < 0) return ids;
  const next = ids.slice();
  next.splice(idx, 1);
  next.push(bringToFrontId);
  return next;
}
