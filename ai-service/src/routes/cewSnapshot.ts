/**
 * CEW Snapshot API Route
 * @module routes/cewSnapshot
 * 
 * Receives and stores module counter snapshots from CEW frontend.
 * In-memory storage only (no database).
 */

import { Router, Request, Response } from 'express';
import { logger } from '../services/loggerService';

// ============================================================================
// Types
// ============================================================================

/**
 * Module counter snapshot from CEW frontend
 */
export interface ModuleSnapshot {
  /** Module identifier (e.g., "DC", "LV", "MC4") */
  moduleKey: string;
  /** Human-readable module name */
  moduleLabel: string;
  /** Work completed today (this session) */
  today: number;
  /** Total work completed overall */
  total: number;
  /** Remaining work */
  remaining: number;
  /** Unit of measurement (e.g., "m", "pcs", "boxes") */
  unit: string;
  /** ISO timestamp of snapshot */
  timestamp: string;
}

// ============================================================================
// In-Memory Storage
// ============================================================================

/**
 * In-memory snapshot store
 * Key: moduleKey
 * Value: Latest snapshot for that module
 */
const snapshotStore = new Map<string, ModuleSnapshot>();

// ============================================================================
// Router
// ============================================================================

const router = Router();

/**
 * POST /api/cew/snapshot
 * 
 * Receive and store a module counter snapshot from CEW frontend.
 * Overwrites previous snapshot for the same moduleKey.
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Validate required fields
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    if (!body.moduleKey || typeof body.moduleKey !== 'string') {
      res.status(400).json({ error: 'Missing or invalid moduleKey' });
      return;
    }

    // Normalize and validate snapshot data
    const snapshot: ModuleSnapshot = {
      moduleKey: String(body.moduleKey).toUpperCase(),
      moduleLabel: String(body.moduleLabel || body.moduleKey || ''),
      today: Math.max(0, Number(body.today) || 0),
      total: Math.max(0, Number(body.total) || 0),
      remaining: Math.max(0, Number(body.remaining) || 0),
      unit: String(body.unit || ''),
      timestamp: body.timestamp || new Date().toISOString(),
    };

    // Store snapshot (overwrites previous)
    snapshotStore.set(snapshot.moduleKey, snapshot);

    logger.info('Received CEW snapshot', {
      moduleKey: snapshot.moduleKey,
      today: snapshot.today,
      total: snapshot.total,
      remaining: snapshot.remaining,
      unit: snapshot.unit,
    });

    res.status(200).json({
      success: true,
      message: 'Snapshot stored',
      moduleKey: snapshot.moduleKey,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to process snapshot', { error: errorMsg });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/cew/snapshot
 * 
 * Return all latest module snapshots.
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const snapshots = Array.from(snapshotStore.values());
    
    res.status(200).json({
      success: true,
      count: snapshots.length,
      snapshots,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to retrieve snapshots', { error: errorMsg });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/cew/snapshot/:moduleKey
 * 
 * Return snapshot for a specific module.
 */
router.get('/:moduleKey', (req: Request, res: Response) => {
  try {
    const moduleKey = String(req.params.moduleKey || '').toUpperCase();
    
    if (!moduleKey) {
      res.status(400).json({ error: 'Missing moduleKey' });
      return;
    }

    const snapshot = snapshotStore.get(moduleKey);
    
    if (!snapshot) {
      res.status(404).json({
        success: false,
        error: 'Snapshot not found',
        moduleKey,
      });
      return;
    }

    res.status(200).json({
      success: true,
      snapshot,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to retrieve snapshot', { error: errorMsg });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/cew/snapshot/:moduleKey
 * 
 * Delete snapshot for a specific module (for testing).
 */
router.delete('/:moduleKey', (req: Request, res: Response) => {
  try {
    const moduleKey = String(req.params.moduleKey || '').toUpperCase();
    
    if (!moduleKey) {
      res.status(400).json({ error: 'Missing moduleKey' });
      return;
    }

    const deleted = snapshotStore.delete(moduleKey);
    
    res.status(200).json({
      success: true,
      deleted,
      moduleKey,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to delete snapshot', { error: errorMsg });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/cew/snapshot
 * 
 * Clear all snapshots (for testing).
 */
router.delete('/', (_req: Request, res: Response) => {
  try {
    const count = snapshotStore.size;
    snapshotStore.clear();
    
    res.status(200).json({
      success: true,
      message: 'All snapshots cleared',
      clearedCount: count,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to clear snapshots', { error: errorMsg });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// Exports
// ============================================================================

/**
 * Get snapshot by moduleKey (for internal use by connectors)
 */
export function getSnapshot(moduleKey: string): ModuleSnapshot | undefined {
  return snapshotStore.get(moduleKey.toUpperCase());
}

/**
 * Get all snapshots (for internal use by connectors)
 */
export function getAllSnapshots(): ModuleSnapshot[] {
  return Array.from(snapshotStore.values());
}

/**
 * Check if any snapshots exist
 */
export function hasSnapshots(): boolean {
  return snapshotStore.size > 0;
}

export default router;
