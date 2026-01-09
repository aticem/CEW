/**
 * Documents Route
 * @module routes/documents
 * 
 * Handles document listing and management endpoints.
 * GET /api/documents - List all indexed documents
 */

import { Router, Request, Response, NextFunction } from 'express';
import { DocumentMetadata } from '../types';
import { getAllDocuments, getDocumentEntry, removeFromIndex, DocumentRegistryEntry } from '../ingest/indexer';
import { logger } from '../services/loggerService';

const router = Router();

// ============================================================================
// Types
// ============================================================================

/**
 * Document list response
 */
interface DocumentListResponse {
  success: boolean;
  data: {
    documents: DocumentInfo[];
    total: number;
  };
  timestamp: string;
}

/**
 * Document info (subset of metadata for listing)
 */
interface DocumentInfo {
  id: string;
  filename: string;
  filePath: string;
  chunkCount: number;
  indexedAt: string;
  category?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert registry entry to document info
 */
function toDocumentInfo(entry: DocumentRegistryEntry): DocumentInfo {
  return {
    id: entry.id,
    filename: entry.filename,
    filePath: entry.filePath,
    chunkCount: entry.chunkCount,
    indexedAt: entry.indexedAt,
    category: entry.metadata?.category as string | undefined,
  };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/documents
 * 
 * List all indexed documents.
 * 
 * @example
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "documents": [
 *       {
 *         "id": "doc_abc123",
 *         "filename": "QAQC_Checklist.pdf",
 *         "chunkCount": 15,
 *         "indexedAt": "2024-01-15T10:30:00Z"
 *       }
 *     ],
 *     "total": 1
 *   }
 * }
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = getAllDocuments();
    const documents = entries.map(toDocumentInfo);

    const response: DocumentListResponse = {
      success: true,
      data: {
        documents,
        total: documents.length,
      },
      timestamp: new Date().toISOString(),
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/documents/:id
 * 
 * Get details for a specific document.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const entry = getDocumentEntry(id);

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Document with id '${id}' not found`,
        },
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: {
        ...toDocumentInfo(entry),
        chunkIds: entry.chunkIds,
        contentHash: entry.contentHash,
        metadata: entry.metadata,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/documents/:id
 * 
 * Remove a document from the index.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Check if document exists
    const entry = getDocumentEntry(id);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Document with id '${id}' not found`,
        },
        timestamp: new Date().toISOString(),
      });
    }

    logger.info('Deleting document from index', { 
      documentId: id,
      filename: entry.filename,
    });

    await removeFromIndex(id);

    logger.info('Document deleted successfully', { documentId: id });

    return res.json({
      success: true,
      data: {
        deleted: true,
        documentId: id,
        filename: entry.filename,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/documents/search
 * 
 * Search documents by filename or category.
 */
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, category } = req.query;
    
    let entries = getAllDocuments();

    // Filter by search query
    if (q && typeof q === 'string') {
      const searchLower = q.toLowerCase();
      entries = entries.filter(entry => 
        entry.filename.toLowerCase().includes(searchLower) ||
        entry.filePath.toLowerCase().includes(searchLower)
      );
    }

    // Filter by category
    if (category && typeof category === 'string') {
      entries = entries.filter(entry => 
        entry.metadata?.category === category
      );
    }

    const documents = entries.map(toDocumentInfo);

    return res.json({
      success: true,
      data: {
        documents,
        total: documents.length,
        query: q || null,
        category: category || null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
