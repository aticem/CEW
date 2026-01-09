/**
 * QAQC Snapshot API Route
 * @module routes/qaqcSnapshot
 * 
 * Receives and stores QAQC document status snapshots from CEW frontend.
 * In-memory storage only (no database).
 */

import { Router, Request, Response } from 'express';
import { logger } from '../services/loggerService';

// ============================================================================
// Types
// ============================================================================

/**
 * Category counts
 */
export interface QAQCCategoryCounts {
  total: number;
  done: number;
  open: number;
}

/**
 * QAQC snapshot payload from frontend
 */
export interface QAQCSnapshot {
  /** ISO timestamp */
  timestamp: string;
  /** Totals */
  totals: {
    overall: QAQCCategoryCounts;
    byCategory: {
      ITPs: QAQCCategoryCounts;
      Checklists: QAQCCategoryCounts;
      NCRs: QAQCCategoryCounts;
      ThirdParty: QAQCCategoryCounts;
      [key: string]: QAQCCategoryCounts;
    };
  };
}

// ============================================================================
// In-Memory Storage (Singleton)
// ============================================================================

let latestSnapshot: QAQCSnapshot | null = null;

// ============================================================================
// Router
// ============================================================================

const router = Router();

/**
 * POST /api/qaqc/snapshot
 * 
 * Receive and store QAQC snapshot from frontend.
 * Overwrites previous snapshot.
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Validate payload shape
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    if (!body.totals || !body.totals.overall || !body.totals.byCategory) {
      res.status(400).json({ error: 'Invalid snapshot shape - missing totals' });
      return;
    }

    // Validate overall counts
    const overall = body.totals.overall;
    if (typeof overall.total !== 'number' || typeof overall.done !== 'number') {
      res.status(400).json({ error: 'Invalid overall counts' });
      return;
    }

    // Store snapshot
    latestSnapshot = {
      timestamp: body.timestamp || new Date().toISOString(),
      totals: {
        overall: {
          total: Math.max(0, Number(overall.total) || 0),
          done: Math.max(0, Number(overall.done) || 0),
          open: Math.max(0, Number(overall.open) || 0),
        },
        byCategory: {},
      },
    };

    // Process each category
    for (const [key, value] of Object.entries(body.totals.byCategory)) {
      const cat = value as QAQCCategoryCounts;
      latestSnapshot.totals.byCategory[key] = {
        total: Math.max(0, Number(cat?.total) || 0),
        done: Math.max(0, Number(cat?.done) || 0),
        open: Math.max(0, Number(cat?.open) || 0),
      };
    }

    logger.info('Received QAQC snapshot', {
      overall: latestSnapshot.totals.overall,
      categories: Object.keys(latestSnapshot.totals.byCategory),
    });

    res.status(200).json({
      success: true,
      message: 'QAQC snapshot stored',
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to process QAQC snapshot', { error: errorMsg });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/qaqc/snapshot
 * 
 * Return the latest QAQC snapshot.
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    if (!latestSnapshot) {
      res.status(200).json({
        success: false,
        message: 'No QAQC snapshot available. Please open the QAQC screen in CEW to generate one.',
        snapshot: null,
      });
      return;
    }

    res.status(200).json({
      success: true,
      snapshot: latestSnapshot,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to retrieve QAQC snapshot', { error: errorMsg });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/qaqc/snapshot
 * 
 * Clear the stored snapshot (for testing).
 */
router.delete('/', (_req: Request, res: Response) => {
  try {
    latestSnapshot = null;
    res.status(200).json({
      success: true,
      message: 'QAQC snapshot cleared',
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to clear QAQC snapshot', { error: errorMsg });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// Exports for internal use
// ============================================================================

/**
 * Get the latest QAQC snapshot (for internal use by connectors)
 */
export function getQAQCSnapshot(): QAQCSnapshot | null {
  return latestSnapshot;
}

/**
 * Check if QAQC snapshot exists
 */
export function hasQAQCSnapshot(): boolean {
  return latestSnapshot !== null;
}

export default router;
