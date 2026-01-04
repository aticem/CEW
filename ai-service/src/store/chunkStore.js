/**
 * ChunkStore - In-memory chunk storage for MVP
 * Stores document chunks and provides search/retrieval
 */

class ChunkStore {
  constructor() {
    this.chunks = new Map(); // chunkId -> chunk
    this.docIndex = new Map(); // docId -> Set<chunkId>
    this.metadata = {
      lastIngestAt: null,
      totalChunks: 0,
      docCount: 0,
    };
  }

  /**
   * Add chunks to the store (replaces existing chunks for the same doc)
   * @param {Array} chunks - Array of chunk objects
   */
  addChunks(chunks) {
    for (const chunk of chunks) {
      const { chunkId, docId } = chunk;

      // Track which chunks belong to which doc
      if (!this.docIndex.has(docId)) {
        this.docIndex.set(docId, new Set());
      }
      this.docIndex.get(docId).add(chunkId);

      // Store the chunk
      this.chunks.set(chunkId, chunk);
    }

    this._updateMetadata();
  }

  /**
   * Remove all chunks for a document
   * @param {string} docId
   */
  removeDocument(docId) {
    const chunkIds = this.docIndex.get(docId);
    if (chunkIds) {
      for (const id of chunkIds) {
        this.chunks.delete(id);
      }
      this.docIndex.delete(docId);
    }
    this._updateMetadata();
  }

  /**
   * Get all chunks
   * @returns {Array}
   */
  getAllChunks() {
    return Array.from(this.chunks.values());
  }

  /**
   * Get chunks by document ID
   * @param {string} docId
   * @returns {Array}
   */
  getChunksByDoc(docId) {
    const chunkIds = this.docIndex.get(docId);
    if (!chunkIds) return [];
    return Array.from(chunkIds).map((id) => this.chunks.get(id));
  }

  /**
   * Get chunks by document type
   * @param {string} docType - PDF_TEXT, EXCEL_BOM, etc.
   * @returns {Array}
   */
  getChunksByType(docType) {
    return this.getAllChunks().filter((c) => c.docType === docType);
  }

  /**
   * Get chunks by folder/discipline
   * @param {string} folder - folder path or discipline
   * @returns {Array}
   */
  getChunksByFolder(folder) {
    const f = folder.toLowerCase();
    return this.getAllChunks().filter(
      (c) => c.folder && c.folder.toLowerCase().includes(f)
    );
  }

  /**
   * Search chunks by text content (simple keyword search)
   * @param {string} query
   * @param {Object} options
   * @returns {Array}
   */
  search(query, options = {}) {
    const { maxResults = 10, docType = null, folder = null } = options;

    let candidates = this.getAllChunks();

    // Filter by docType if specified
    if (docType) {
      candidates = candidates.filter((c) => c.docType === docType);
    }

    // Filter by folder if specified
    if (folder) {
      const f = folder.toLowerCase();
      candidates = candidates.filter(
        (c) => c.folder && c.folder.toLowerCase().includes(f)
      );
    }

    // Simple keyword scoring
    const qTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const scored = candidates.map((chunk) => {
      const text = (chunk.text || "").toLowerCase();
      let score = 0;
      for (const term of qTerms) {
        if (text.includes(term)) score += 1;
      }
      return { chunk, score };
    });

    return scored
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((r) => ({ score: r.score, ...r.chunk }));
  }

  /**
   * Get store statistics
   * @returns {Object}
   */
  getStats() {
    const byType = {};
    const byFolder = {};

    for (const chunk of this.chunks.values()) {
      // Count by type
      byType[chunk.docType] = (byType[chunk.docType] || 0) + 1;

      // Count by folder
      const folder = chunk.folder || "unknown";
      byFolder[folder] = (byFolder[folder] || 0) + 1;
    }

    return {
      ...this.metadata,
      byType,
      byFolder,
    };
  }

  /**
   * Clear all data
   */
  clear() {
    this.chunks.clear();
    this.docIndex.clear();
    this._updateMetadata();
  }

  /**
   * Export store to JSON (for persistence)
   * @returns {Object}
   */
  toJSON() {
    return {
      chunks: Array.from(this.chunks.entries()),
      metadata: this.metadata,
    };
  }

  /**
   * Import store from JSON
   * @param {Object} data
   */
  fromJSON(data) {
    this.clear();
    if (data.chunks) {
      for (const [id, chunk] of data.chunks) {
        this.chunks.set(id, chunk);
        if (!this.docIndex.has(chunk.docId)) {
          this.docIndex.set(chunk.docId, new Set());
        }
        this.docIndex.get(chunk.docId).add(id);
      }
    }
    this._updateMetadata();
  }

  _updateMetadata() {
    this.metadata.lastIngestAt = new Date().toISOString();
    this.metadata.totalChunks = this.chunks.size;
    this.metadata.docCount = this.docIndex.size;
  }
}

// Singleton instance
export const chunkStore = new ChunkStore();
export default ChunkStore;
