/**
 * QAQC Snapshot Export Utility
 * 
 * Exports QAQC document status counts to AI backend.
 * Uses EXACT same counting rules as metadataStorage.js:
 * - NCRs: status === 'closed' => done
 * - Others: status === 'completed' => done
 * 
 * @module utils/qaqcSnapshotExport
 */

// AI Service base URL
const AI_SERVICE_URL = 'http://localhost:3001';

// localStorage key (must match metadataStorage.js)
const STORAGE_KEY = 'cew-qaqc-metadata';

// Debounce timer to prevent spam
let debounceTimer = null;
const DEBOUNCE_MS = 2000;

/**
 * Read QAQC metadata from localStorage
 * @returns {Object|null} Parsed metadata or null
 */
function readMetadata() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch (e) {
    console.warn('[QAQC Snapshot] Failed to read metadata:', e.message);
    return null;
  }
}

/**
 * Count documents in a tree node recursively
 * Uses EXACT same logic as metadataStorage.js:calculateStats
 * 
 * @param {Object} node - Tree node
 * @param {boolean} isNCR - Whether this is an NCR category
 * @param {Object} publicFileStatuses - Status map for public files
 * @returns {{ total: number, done: number }}
 */
function countDocs(node, isNCR = false, publicFileStatuses = {}) {
  let total = 0;
  let done = 0;

  if (node.type === 'document' || node.type === 'doc-slot') {
    if (node.fileId) {
      total++;
      
      // Exact same rule as metadataStorage.js
      const isDone = isNCR 
        ? node.status === 'closed'
        : node.status === 'completed';
      
      if (isDone) {
        done++;
      }
    } else if (node.type === 'doc-slot' && node.required) {
      // Required slot without file counts as incomplete
      total++;
    }
  }

  if (node.children) {
    for (const child of Object.values(node.children)) {
      const childCounts = countDocs(child, isNCR, publicFileStatuses);
      total += childCounts.total;
      done += childCounts.done;
    }
  }

  return { total, done };
}

/**
 * Count public files for a category
 * 
 * @param {string} categoryKey 
 * @param {Object} publicFiles - Public files manifest
 * @param {Object} publicFileStatuses - Status map
 * @param {boolean} isNCR
 * @returns {{ total: number, done: number }}
 */
function countPublicFiles(categoryKey, publicFiles, publicFileStatuses, isNCR = false) {
  let total = 0;
  let done = 0;

  const categoryFiles = publicFiles[categoryKey];
  if (!categoryFiles) return { total, done };

  for (const [nodeKey, files] of Object.entries(categoryFiles)) {
    for (const file of files) {
      const statusKey = `${categoryKey}-${nodeKey}-${file.name}`;
      const status = publicFileStatuses[statusKey] || 'incomplete';
      
      total++;
      
      // Same rule: NCRs use 'closed', others use 'completed'
      const isDone = isNCR 
        ? status === 'closed' 
        : status === 'completed';
      
      if (isDone) {
        done++;
      }
    }
  }

  return { total, done };
}

/**
 * Get public files manifest
 * Must match QAQCModule.jsx publicFiles definition
 */
function getPublicFilesManifest() {
  return {
    'ITPs': {
      'itp-civil': [{ name: 'civil.docx' }],
      'itp-electrical': [{ name: 'electrical.docx' }],
      'itp-mechanical': [{ name: 'mechanical.docx' }],
    },
    'Checklists': {
      'cl-dc-cable': [
        { name: 'civil - Copy.docx' },
        { name: 'electrical - Copy.docx' },
        { name: 'mechanical - Copy.docx' },
        { name: '277-007-D-C-40327 Rev 03 Trenches crossing layout.pdf' },
        { name: 'bill of m 227-005-L-E-00010 Rev07.xlsx' },
      ],
      'cl-earthing-foc': [
        { name: 'civil.docx' },
        { name: 'electrical.docx' },
        { name: 'mechanical.docx' },
      ],
      'cl-inverter-lv': [
        { name: 'civil - Copy (2).docx' },
        { name: 'civil - Copy - Copy.docx' },
        { name: 'electrical - Copy (2).docx' },
        { name: 'electrical - Copy - Copy.docx' },
        { name: 'mechanical - Copy (2).docx' },
        { name: 'mechanical - Copy - Copy.docx' },
      ],
      'cl-module-installation': [
        { name: 'civil - Copy (2).docx' },
        { name: 'civil - Copy - Copy.docx' },
        { name: 'electrical - Copy (2).docx' },
        { name: 'electrical - Copy - Copy.docx' },
        { name: 'mechanical - Copy (2).docx' },
        { name: 'mechanical - Copy - Copy.docx' },
      ],
      'cl-mounting-structure': [
        { name: 'civil - Copy.docx' },
        { name: 'civil.docx' },
        { name: 'electrical - Copy.docx' },
        { name: 'mechanical - Copy.docx' },
        { name: 'mechanical.docx' },
      ],
    },
    'NCRs': {
      'NCRs': [
        { name: 'civil - Copy - Copy.docx' },
        { name: 'electrical - Copy (2).docx' },
        { name: 'mechanical - Copy (2).docx' },
      ],
    },
    'ThirdParty': {
      'tp-dnv': [
        { name: 'electrical - Copy (2).docx' },
        { name: 'mechanical - Copy (2).docx' },
        { name: 'mechanical - Copy - Copy.docx' },
        { name: 'mechanical - Copy.docx' },
      ],
      'tp-cea': [
        { name: 'civil - Copy (2).docx' },
        { name: 'civil - Copy - Copy.docx' },
        { name: 'civil - Copy.docx' },
        { name: 'civil.docx' },
        { name: 'electrical - Copy - Copy.docx' },
      ],
    },
  };
}

/**
 * Build QAQC snapshot payload
 * @returns {Object} QAQCSnapshotPayload
 */
export function buildQAQCSnapshot() {
  const metadata = readMetadata();
  const publicFiles = getPublicFilesManifest();
  const publicFileStatuses = metadata?.publicFileStatuses || {};

  // Initialize category counts
  const byCategory = {
    ITPs: { total: 0, done: 0, open: 0 },
    Checklists: { total: 0, done: 0, open: 0 },
    NCRs: { total: 0, done: 0, open: 0 },
    ThirdParty: { total: 0, done: 0, open: 0 },
  };

  // Main categories to process
  const categoryKeys = ['ITPs', 'Checklists', 'NCRs', 'ThirdParty'];

  for (const key of categoryKeys) {
    const isNCR = key === 'NCRs';
    
    // Count documents from metadata tree (uploaded files)
    if (metadata?.tree?.[key]) {
      const treeCounts = countDocs(metadata.tree[key], isNCR, publicFileStatuses);
      byCategory[key].total += treeCounts.total;
      byCategory[key].done += treeCounts.done;
    }

    // Count public files
    const publicCounts = countPublicFiles(key, publicFiles, publicFileStatuses, isNCR);
    byCategory[key].total += publicCounts.total;
    byCategory[key].done += publicCounts.done;

    // Calculate open (total - done)
    byCategory[key].open = byCategory[key].total - byCategory[key].done;
  }

  // Calculate overall totals
  const overall = {
    total: 0,
    done: 0,
    open: 0,
  };

  for (const cat of Object.values(byCategory)) {
    overall.total += cat.total;
    overall.done += cat.done;
    overall.open += cat.open;
  }

  return {
    timestamp: new Date().toISOString(),
    totals: {
      overall,
      byCategory,
    },
  };
}

/**
 * Send QAQC snapshot to AI backend
 * Fire-and-forget, non-blocking
 * 
 * @param {Object} snapshot - QAQCSnapshotPayload
 */
async function sendSnapshot(snapshot) {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/qaqc/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      console.warn(`[QAQC Snapshot] Failed to send: ${response.status}`);
      return;
    }

    console.log(
      `[QAQC Snapshot] Exported: overall total=${snapshot.totals.overall.total} ` +
      `done=${snapshot.totals.overall.done} open=${snapshot.totals.overall.open}`
    );
  } catch (error) {
    console.warn('[QAQC Snapshot] Failed to send:', error.message);
  }
}

/**
 * Export QAQC snapshot (debounced)
 * Call this after any QAQC status change.
 */
export function exportQAQCSnapshot() {
  // Clear existing timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Debounce to prevent spam
  debounceTimer = setTimeout(() => {
    const snapshot = buildQAQCSnapshot();
    sendSnapshot(snapshot);
  }, DEBOUNCE_MS);
}

/**
 * Export QAQC snapshot immediately (no debounce)
 * Use for initial load or explicit refresh.
 */
export function exportQAQCSnapshotNow() {
  const snapshot = buildQAQCSnapshot();
  sendSnapshot(snapshot);
}

export default {
  buildQAQCSnapshot,
  exportQAQCSnapshot,
  exportQAQCSnapshotNow,
};
