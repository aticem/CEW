#!/usr/bin/env ts-node
/**
 * QAQC Document Ingestion Script
 * 
 * Ingests QAQC documents from CEW1/_root/public/QAQC into the vector store.
 * Uses the same ingestion pipeline but with QAQC-specific source marking.
 * 
 * Usage:
 *   npx ts-node src/scripts/ingest-qaqc.ts
 *   npx ts-node src/scripts/ingest-qaqc.ts --force
 */

import path from 'path';

// Load environment variables first
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { config } from '../config';
import { loadAllDocuments } from '../ingest/documentLoader';
import { chunkAllDocuments } from '../ingest/chunker';
import { embedChunks } from '../ingest/embedder';
import { initializeIndex, addToIndex, saveIndex, getIndexStats, registerDocumentMetadata } from '../ingest/indexer';
import { logger } from '../services/loggerService';
import { listQAQCFiles, getQAQCPath, isQAQCAvailable } from '../connectors/cewQAQCConnector';

// ============================================================================
// CLI Arguments
// ============================================================================

interface CliArgs {
  forceReindex: boolean;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  
  return {
    forceReindex: args.includes('--force') || args.includes('-f'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp(): void {
  console.log(`
CEW AI Service - QAQC Document Ingestion Script

Usage:
  npx ts-node src/scripts/ingest-qaqc.ts [options]

Options:
  --force, -f       Force add to existing index
  --help, -h        Show this help message

Note: This script adds QAQC documents to the existing index.
      Use the main ingest.ts --force to clear the entire index first if needed.

Source: ${config.paths.cewQAQC}
`);
}

// ============================================================================
// Main Ingestion Logic
// ============================================================================

async function runQAQCIngestion(args: CliArgs): Promise<void> {
  const startTime = Date.now();
  const qaqcPath = getQAQCPath();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        CEW AI Service - QAQC Document Ingestion              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log(`📁 QAQC Path:     ${qaqcPath}`);
  console.log(`🔄 Force Add:     ${args.forceReindex}`);
  console.log('');

  // Check if QAQC directory exists
  if (!isQAQCAvailable()) {
    console.error('❌ QAQC directory not found or not accessible');
    console.error(`   Expected path: ${qaqcPath}`);
    console.error('');
    console.error('Make sure:');
    console.error('  1. CEW frontend repository exists at ../CEW1/_root');
    console.error('  2. Or set CEW_QAQC_PATH in .env');
    process.exit(1);
  }

  try {
    // Step 1: Initialize index
    console.log('🔧 Initializing vector index...');
    await initializeIndex();
    console.log('   ✅ Index initialized');

    // Step 2: Discover QAQC files
    console.log('');
    console.log('🔍 Discovering QAQC documents...');
    
    const qaqcFiles = listQAQCFiles();
    
    if (qaqcFiles.length === 0) {
      console.log('   ⚠️  No QAQC documents found');
      return;
    }

    console.log(`   ✅ Found ${qaqcFiles.length} QAQC documents`);
    console.log('');
    console.log('   📊 By category:');
    
    const categoryStats: Record<string, number> = {};
    for (const file of qaqcFiles) {
      categoryStats[file.category] = (categoryStats[file.category] || 0) + 1;
    }
    for (const [cat, count] of Object.entries(categoryStats)) {
      console.log(`      - ${cat}: ${count} files`);
    }

    // Step 3: Load documents
    console.log('');
    console.log('📄 Loading documents...');
    
    const documents = await loadAllDocuments(qaqcPath, {
      recursive: true,
      category: 'cew_qaqc',
    });

    if (documents.length === 0) {
      console.log('   ⚠️  No documents could be loaded');
      return;
    }

    console.log(`   ✅ Loaded ${documents.length} documents`);

    // Step 4: Update logical paths for QAQC documents
    // The logicalPath should be "QAQC/..." for proper source identification
    for (const doc of documents) {
      // Find matching QAQC file info
      const matchingFile = qaqcFiles.find(f => 
        path.resolve(doc.metadata.filePath) === path.resolve(f.absolutePath)
      );
      
      if (matchingFile) {
        // Override filePath with logical path
        doc.metadata.filePath = matchingFile.logicalPath;
        doc.metadata.category = 'cew_qaqc';
      }
    }

    // Step 5: Chunk documents
    console.log('');
    console.log('✂️  Chunking documents...');
    
    const chunkedDocs = chunkAllDocuments(documents);
    const totalChunks = chunkedDocs.reduce((sum, doc) => sum + doc.chunks.length, 0);
    
    console.log(`   ✅ Created ${totalChunks} chunks`);

    // Step 6: Generate embeddings
    console.log('');
    console.log('🧠 Generating embeddings (this may take a while)...');
    
    const allChunks = chunkedDocs.flatMap(doc => doc.chunks);
    const embeddedChunks = await embedChunks(allChunks);
    
    const totalTokens = embeddedChunks.reduce((sum, c) => sum + (c.tokenCount || 0), 0);
    console.log(`   ✅ Generated embeddings (${totalTokens} tokens)`);

    // Step 7: Register document metadata and add chunks to index
    console.log('');
    console.log('💾 Adding to vector index...');
    
    // Register document metadata first
    for (const doc of chunkedDocs) {
      registerDocumentMetadata(doc.metadata.id, {
        filename: doc.metadata.filename,
        filePath: doc.metadata.filePath,
        fileType: doc.metadata.fileType,
        sizeBytes: doc.metadata.sizeBytes,
        pageCount: doc.metadata.pageCount,
        title: doc.metadata.title,
        category: doc.metadata.category,
        contentHash: doc.metadata.contentHash,
      });
    }
    
    // Add chunks to index
    await addToIndex(embeddedChunks);
    await saveIndex();
    
    console.log('   ✅ Chunks indexed and saved');

    // Final summary
    const stats = await getIndexStats();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║              QAQC Ingestion Complete                         ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  QAQC documents:      ${String(documents.length).padEnd(39)}║`);
    console.log(`║  Chunks created:      ${String(totalChunks).padEnd(39)}║`);
    console.log(`║  Tokens embedded:     ${String(totalTokens).padEnd(39)}║`);
    console.log(`║  Total in index:      ${String(stats.totalChunks).padEnd(39)}║`);
    console.log(`║  Duration:            ${(duration + 's').padEnd(39)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('QAQC documents are now searchable. Try:');
    console.log('  - "What is the DC cable checklist about?"');
    console.log('  - "ITP electrical dokümanı nedir?"');
    console.log('');

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('');
    console.error('❌ QAQC ingestion failed:', errorMsg);
    console.error('');
    
    if (error instanceof Error && error.stack) {
      logger.error('QAQC ingestion error', { error: errorMsg, stack: error.stack });
    }
    
    process.exit(1);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  await runQAQCIngestion(args);
  process.exit(0);
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
