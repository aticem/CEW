/**
 * Ingest Handler - Orchestrates the document ingestion process
 */

import { listMockDriveFiles } from "../ingest/mockDrive.js";
import { classifyFile } from "../ingest/classify.js";
import { ingestOneFile } from "../ingest/ingestOne.js";
import { chunkStore } from "../store/chunkStore.js";

/**
 * Run the full ingest pipeline
 * @returns {Promise<Object>} Ingest statistics
 */
export async function runIngest() {
  console.log("🔄 Starting ingest...");
  const startTime = Date.now();

  // 1. Get file list from Drive (mock for MVP)
  const files = listMockDriveFiles();
  console.log(`📁 Found ${files.length} files`);

  // 2. Classify each file
  const classified = files.map((f) => ({
    ...f,
    classification: classifyFile(f),
  }));

  // Log classifications
  for (const f of classified) {
    console.log(
      `  - ${f.name} → ${f.classification.docType}${
        f.classification.flags.length
          ? " (" + f.classification.flags.join(", ") + ")"
          : ""
      }`
    );
  }

  // 3. Ingest each file
  const results = {
    total: files.length,
    success: 0,
    failed: 0,
    skipped: 0,
    chunks: 0,
    byType: {},
    errors: [],
  };

  for (const f of classified) {
    try {
      // Skip unsupported types
      if (f.classification.docType === "UNSUPPORTED") {
        results.skipped++;
        continue;
      }

      const chunks = await ingestOneFile(f);

      if (chunks.length > 0) {
        // Add chunks to store
        chunkStore.addChunks(chunks);
        results.success++;
        results.chunks += chunks.length;

        // Track by type
        const type = f.classification.docType;
        results.byType[type] = (results.byType[type] || 0) + chunks.length;
      } else {
        results.skipped++;
      }
    } catch (error) {
      console.error(`❌ Failed to ingest ${f.name}:`, error.message);
      results.failed++;
      results.errors.push({
        file: f.name,
        error: error.message,
      });
    }
  }

  const duration = Date.now() - startTime;
  results.durationMs = duration;

  console.log(`\n✅ Ingest complete in ${duration}ms`);
  console.log(`   - Success: ${results.success}`);
  console.log(`   - Failed: ${results.failed}`);
  console.log(`   - Skipped: ${results.skipped}`);
  console.log(`   - Total chunks: ${results.chunks}`);

  return results;
}

/**
 * Ingest a single file by ID (for incremental updates)
 * @param {string} fileId
 * @returns {Promise<Object>}
 */
export async function ingestSingleFile(fileId) {
  const files = listMockDriveFiles();
  const file = files.find((f) => f.id === fileId);

  if (!file) {
    throw new Error(`File not found: ${fileId}`);
  }

  const classified = {
    ...file,
    classification: classifyFile(file),
  };

  // Remove existing chunks for this document
  chunkStore.removeDocument(fileId);

  // Ingest the file
  const chunks = await ingestOneFile(classified);

  if (chunks.length > 0) {
    chunkStore.addChunks(chunks);
  }

  return {
    fileId,
    fileName: file.name,
    docType: classified.classification.docType,
    chunksCreated: chunks.length,
  };
}

/**
 * Get ingest status
 * @returns {Object}
 */
export function getIngestStatus() {
  const stats = chunkStore.getStats();
  return {
    lastIngestAt: stats.lastIngestAt,
    totalChunks: stats.totalChunks,
    docCount: stats.docCount,
    byType: stats.byType,
    byFolder: stats.byFolder,
  };
}

export default {
  runIngest,
  ingestSingleFile,
  getIngestStatus,
};
