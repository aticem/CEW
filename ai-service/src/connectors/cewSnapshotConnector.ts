/**
 * CEW Snapshot Connector
 * @module connectors/cewSnapshotConnector
 * 
 * Provides access to CEW module counter snapshots for AI queries.
 * Reads from in-memory snapshot store (populated by frontend).
 */

import { getSnapshot, getAllSnapshots, hasSnapshots, ModuleSnapshot } from '../routes/cewSnapshot';
import { logger } from '../services/loggerService';

// ============================================================================
// Types
// ============================================================================

/**
 * Normalized snapshot for AI consumption
 */
export interface NormalizedSnapshot {
  /** Module identifier (uppercase) */
  moduleKey: string;
  /** Human-readable module name */
  moduleLabel: string;
  /** Work completed today (session) */
  today: number;
  /** Total work completed overall */
  total: number;
  /** Remaining work */
  remaining: number;
  /** Unit of measurement */
  unit: string;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Module keyword mapping for query matching
 */
interface ModuleKeywordMap {
  keywords: string[];
  moduleKeys: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Keyword to module mapping
 * Used to identify which module a user is asking about
 */
const MODULE_KEYWORDS: ModuleKeywordMap[] = [
  // DC Cable Pulling
  {
    keywords: ['dc', 'dc cable', 'dc kablo', 'dc çekme'],
    moduleKeys: ['DC'],
  },
  // LV Cable Pulling
  {
    keywords: ['lv', 'lv cable', 'lv kablo', 'lv çekme', 'alçak gerilim'],
    moduleKeys: ['LV'],
  },
  // MV Pulling
  {
    keywords: ['mv', 'mv cable', 'mv kablo', 'orta gerilim', 'mvf'],
    moduleKeys: ['MVF', 'MV'],
  },
  // MV+Fibre Trench
  {
    keywords: ['mv fibre', 'mv fiber', 'mvft', 'trench', 'hendek'],
    moduleKeys: ['MVFT'],
  },
  // Fibre
  {
    keywords: ['fibre', 'fiber', 'fib'],
    moduleKeys: ['FIB'],
  },
  // MC4 Installation
  {
    keywords: ['mc4', 'mc4 installation', 'mc4 montaj', 'konnektör'],
    moduleKeys: ['MC4', 'MC4_INST', 'MC4_TERM_PANEL', 'MC4_TERM_INV'],
  },
  // DC Termination & Testing
  {
    keywords: ['dc termination', 'dc terminasyon', 'dctt', 'dc test'],
    moduleKeys: ['DCTT', 'DCTT_TERM_PANEL', 'DCTT_TERM_INV'],
  },
  // MV Termination
  {
    keywords: ['mv termination', 'mv terminasyon', 'mvt'],
    moduleKeys: ['MVT', 'MVT_TERM'],
  },
  // LV Termination & Testing
  {
    keywords: ['lv termination', 'lv terminasyon', 'lvtt', 'lv test'],
    moduleKeys: ['LVTT', 'LVTT_TERM'],
  },
  // DC Cable Testing
  {
    keywords: ['dc cable test', 'dc kablo test', 'dcct', 'riso'],
    moduleKeys: ['DCCT'],
  },
  // Module Installation
  {
    keywords: ['module', 'modül', 'panel', 'mipt', 'module installation'],
    moduleKeys: ['MIPT'],
  },
  // Table Installation
  {
    keywords: ['table', 'masa', 'tip', 'table installation', 'masa montaj'],
    moduleKeys: ['TIP'],
  },
  // LV Box / INV Box
  {
    keywords: ['lv box', 'inv box', 'kutu', 'lvib', 'box installation'],
    moduleKeys: ['LVIB', 'LVIB_LV', 'LVIB_INV'],
  },
  // Parameter & Table Earthing
  {
    keywords: ['earthing', 'topraklama', 'ptep', 'parameter'],
    moduleKeys: ['PTEP', 'PTEP_TT', 'PTEP_PARAM'],
  },
  // DC/AC Trench
  {
    keywords: ['dc trench', 'ac trench', 'datp', 'dc ac hendek'],
    moduleKeys: ['DATP'],
  },
  // Punch List
  {
    keywords: ['punch', 'punch list', 'pl', 'eksik'],
    moduleKeys: ['PL'],
  },
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get snapshot for a specific module
 * 
 * @param moduleKey - Module identifier
 * @returns NormalizedSnapshot or undefined if not found
 */
export function getModuleSnapshot(moduleKey: string): NormalizedSnapshot | undefined {
  const snapshot = getSnapshot(moduleKey);
  
  if (!snapshot) {
    logger.debug('Snapshot not found', { moduleKey });
    return undefined;
  }

  return normalizeSnapshot(snapshot);
}

/**
 * Get all available module snapshots
 * 
 * @returns Array of NormalizedSnapshot
 */
export function getAllModuleSnapshots(): NormalizedSnapshot[] {
  const snapshots = getAllSnapshots();
  return snapshots.map(normalizeSnapshot);
}

/**
 * Check if any snapshots are available
 * 
 * @returns true if snapshots exist
 */
export function hasModuleSnapshots(): boolean {
  return hasSnapshots();
}

/**
 * Identify module(s) from user query
 * 
 * @param query - User query text
 * @returns Array of potential module keys
 */
export function identifyModuleFromQuery(query: string): string[] {
  const normalizedQuery = query.toLowerCase().trim();
  const matchedModules = new Set<string>();

  for (const mapping of MODULE_KEYWORDS) {
    for (const keyword of mapping.keywords) {
      if (normalizedQuery.includes(keyword)) {
        mapping.moduleKeys.forEach(key => matchedModules.add(key));
      }
    }
  }

  // If no specific module found, check for generic terms
  if (matchedModules.size === 0) {
    // Try to find any matching snapshot based on label
    const allSnapshots = getAllSnapshots();
    for (const snapshot of allSnapshots) {
      const label = snapshot.moduleLabel.toLowerCase();
      if (normalizedQuery.split(' ').some(word => 
        word.length > 2 && label.includes(word)
      )) {
        matchedModules.add(snapshot.moduleKey);
      }
    }
  }

  return Array.from(matchedModules);
}

/**
 * Get snapshot for module identified from query
 * 
 * @param query - User query text
 * @returns Object with snapshot and matched module info
 */
export function getSnapshotFromQuery(query: string): {
  snapshot: NormalizedSnapshot | undefined;
  matchedModules: string[];
  isAmbiguous: boolean;
} {
  const matchedModules = identifyModuleFromQuery(query);
  
  if (matchedModules.length === 0) {
    return {
      snapshot: undefined,
      matchedModules: [],
      isAmbiguous: false,
    };
  }

  // Try to find snapshot for first matched module
  for (const moduleKey of matchedModules) {
    const snapshot = getModuleSnapshot(moduleKey);
    if (snapshot) {
      return {
        snapshot,
        matchedModules,
        isAmbiguous: matchedModules.length > 1,
      };
    }
  }

  return {
    snapshot: undefined,
    matchedModules,
    isAmbiguous: matchedModules.length > 1,
  };
}

// ============================================================================
// Statistics Functions
// ============================================================================

/**
 * Get statistics summary for a module
 * 
 * @param moduleKey - Module identifier
 * @returns Statistics object or undefined
 */
export function getModuleStats(moduleKey: string): {
  total: number;
  today: number;
  remaining: number;
  unit: string;
  progress: number;
} | undefined {
  const snapshot = getModuleSnapshot(moduleKey);
  
  if (!snapshot) {
    return undefined;
  }

  const progress = snapshot.total > 0 
    ? Math.round((snapshot.total / (snapshot.total + snapshot.remaining)) * 100) 
    : 0;

  return {
    total: snapshot.total,
    today: snapshot.today,
    remaining: snapshot.remaining,
    unit: snapshot.unit,
    progress,
  };
}

/**
 * Get overall statistics across all modules
 * 
 * @returns Summary statistics
 */
export function getOverallStats(): {
  moduleCount: number;
  modules: Array<{
    moduleKey: string;
    moduleLabel: string;
    progress: number;
    unit: string;
  }>;
  lastUpdate: string | null;
} {
  const snapshots = getAllModuleSnapshots();
  
  if (snapshots.length === 0) {
    return {
      moduleCount: 0,
      modules: [],
      lastUpdate: null,
    };
  }

  const modules = snapshots.map(s => ({
    moduleKey: s.moduleKey,
    moduleLabel: s.moduleLabel,
    progress: s.total > 0 
      ? Math.round((s.total / (s.total + s.remaining)) * 100) 
      : 0,
    unit: s.unit,
  }));

  // Find most recent update
  const lastUpdate = snapshots.reduce((latest, s) => {
    return !latest || s.timestamp > latest ? s.timestamp : latest;
  }, null as string | null);

  return {
    moduleCount: snapshots.length,
    modules,
    lastUpdate,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize snapshot to consistent format
 */
function normalizeSnapshot(snapshot: ModuleSnapshot): NormalizedSnapshot {
  return {
    moduleKey: snapshot.moduleKey,
    moduleLabel: snapshot.moduleLabel,
    today: Math.max(0, snapshot.today),
    total: Math.max(0, snapshot.total),
    remaining: Math.max(0, snapshot.remaining),
    unit: snapshot.unit || '',
    timestamp: snapshot.timestamp,
  };
}

// ============================================================================
// Exports
// ============================================================================

export default {
  getModuleSnapshot,
  getAllModuleSnapshots,
  hasModuleSnapshots,
  identifyModuleFromQuery,
  getSnapshotFromQuery,
  getModuleStats,
  getOverallStats,
};
