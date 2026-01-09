/**
 * CEW Snapshot Export Utility
 * 
 * Sends lightweight counter snapshots to AI backend after each submit.
 * This is READ-ONLY export - no changes to CEW data flow.
 * 
 * @module utils/snapshotExport
 */

// AI Service base URL - can be configured via environment or constant
const AI_SERVICE_URL = 'http://localhost:3001';

/**
 * Send a module counter snapshot to the AI backend
 * 
 * This function:
 * - Fires AFTER submit (non-blocking)
 * - Fails silently (console.warn only)
 * - Does NOT modify CEW state
 * 
 * @param {Object} snapshot - Module counter snapshot
 * @param {string} snapshot.moduleKey - Module identifier (e.g., "DC", "LV", "MC4")
 * @param {string} snapshot.moduleLabel - Human-readable module name
 * @param {number} snapshot.today - Work completed today
 * @param {number} snapshot.total - Total work completed overall
 * @param {number} snapshot.remaining - Remaining work
 * @param {string} snapshot.unit - Unit of measurement (e.g., "m", "pcs", "boxes")
 */
export async function sendSnapshot(snapshot) {
  // Validate required fields
  if (!snapshot || !snapshot.moduleKey) {
    console.warn('[CEW Snapshot] Invalid snapshot - missing moduleKey');
    return;
  }

  // Add timestamp if not present
  const payload = {
    moduleKey: String(snapshot.moduleKey || ''),
    moduleLabel: String(snapshot.moduleLabel || snapshot.moduleKey || ''),
    today: Number(snapshot.today) || 0,
    total: Number(snapshot.total) || 0,
    remaining: Number(snapshot.remaining) || 0,
    unit: String(snapshot.unit || ''),
    timestamp: snapshot.timestamp || new Date().toISOString(),
  };

  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/cew/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(`[CEW Snapshot] Failed to send snapshot: ${response.status}`);
      return;
    }

    console.log(`[CEW Snapshot] Sent snapshot for ${payload.moduleKey}:`, {
      today: payload.today,
      total: payload.total,
      remaining: payload.remaining,
      unit: payload.unit,
    });
  } catch (error) {
    // Fail silently - never block UI
    console.warn('[CEW Snapshot] Failed to send snapshot:', error.message);
  }
}

/**
 * Create snapshot object from CEW module state
 * 
 * @param {Object} params - Module state parameters
 * @param {string} params.moduleKey - Module identifier
 * @param {string} params.moduleLabel - Module display name
 * @param {number} params.completedToday - Work completed today (session)
 * @param {number} params.completedTotal - Total completed work
 * @param {number} params.overallTotal - Overall planned work
 * @param {string} params.unit - Unit of measurement
 * @returns {Object} Snapshot object ready to send
 */
export function createSnapshot({
  moduleKey,
  moduleLabel,
  completedToday = 0,
  completedTotal = 0,
  overallTotal = 0,
  unit = '',
}) {
  return {
    moduleKey,
    moduleLabel,
    today: Math.max(0, Number(completedToday) || 0),
    total: Math.max(0, Number(completedTotal) || 0),
    remaining: Math.max(0, (Number(overallTotal) || 0) - (Number(completedTotal) || 0)),
    unit: String(unit || ''),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Helper to send snapshot after a successful submit
 * Call this at the end of each module's submit handler.
 * 
 * @param {Object} moduleState - Current module counter state
 */
export function sendSnapshotAfterSubmit(moduleState) {
  // Use setTimeout to ensure this runs after UI updates
  setTimeout(() => {
    const snapshot = createSnapshot(moduleState);
    sendSnapshot(snapshot);
  }, 100);
}

export default {
  sendSnapshot,
  createSnapshot,
  sendSnapshotAfterSubmit,
};
