#!/usr/bin/env ts-node
/**
 * Document Ingestion Script
 * 
 * Standalone script to run the document ingestion pipeline.
 * 
 * Usage:
 *   npx ts-node src/scripts/ingest.ts
 *   npx ts-node src/scripts/ingest.ts --force
 *   npx ts-node src/scripts/ingest.ts --dir ./custom/path
 */

import path from 'path';

// Load environment variables first
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { config } from '../config';
import { loadAllDocuments } from '../ingest/documentLoader';
import { chunkAllDocuments } from '../ingest/chunker';
import { embedChunks } from '../ingest/embedder';
import { initializeIndex, addToIndex, saveIndex, getIndexStats, resetIndex, registerDocumentMetadata } from '../ingest/indexer';
import { logger } from '../services/loggerService';

// ============================================================================
// CLI Arguments
// ============================================================================

interface CliArgs {
  forceReindex: boolean;
  directory: string;
  category: string;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  
  return {
    forceReindex: args.includes('--force') || args.includes('-f'),
    directory: getArgValue(args, '--dir') || config.paths.documents,
    category: getArgValue(args, '--category') || 'local_documents',
    help: args.includes('--help') || args.includes('-h'),
  };
}

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return undefined;
}

function printHelp(): void {
  console.log(`
CEW AI Service - Document Ingestion Script

Usage:
  npx ts-node src/scripts/ingest.ts [options]

Options:
  --force, -f       Force reindex (clear existing index)
  --dir <path>      Directory to ingest (default: ./documents)
  --category <name> Category for documents (default: local_documents)
  --help, -h        Show this help message

Examples:
  npx ts-node src/scripts/ingest.ts
  npx ts-node src/scripts/ingest.ts --force
  npx ts-node src/scripts/ingest.ts --dir ../CEW1/_root/public/QAQC --category qaqc
`);
}

// ============================================================================
// Main Ingestion Logic
// ============================================================================

async function runIngestion(args: CliArgs): Promise<void> {
  const startTime = Date.now();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           CEW AI Service - Document Ingestion                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log(`📁 Directory:    ${args.directory}`);
  console.log(`📂 Category:     ${args.category}`);
  console.log(`🔄 Force Reindex: ${args.forceReindex}`);
  console.log('');

  try {
    // Step 1: Initialize index
    console.log('🔧 Initializing vector index...');
    
    if (args.forceReindex) {
      console.log('   ⚠️  Force reindex - clearing existing index and data');
      // First initialize to get access to clearAllData
      await initializeIndex();
      await resetIndex(true); // Clear all persisted data
    }
    
    await initializeIndex();
    console.log('   ✅ Index initialized');

    // Step 2: Load documents
    console.log('');
    console.log('📄 Loading documents...');
    
    const documents = await loadAllDocuments(args.directory, {
      recursive: true,
      category: args.category,
    });

    if (documents.length === 0) {
      console.log('   ⚠️  No documents found in directory');
      console.log('');
      console.log('Make sure your documents directory contains supported files:');
      console.log('  - PDF (.pdf)');
      console.log('  - Word (.docx)');
      console.log('  - Excel (.xlsx)');
      console.log('  - Text (.txt)');
      console.log('');
      return;
    }

    console.log(`   ✅ Loaded ${documents.length} documents`);
    
    // List documents
    for (const doc of documents) {
      console.log(`      - ${doc.metadata.filename}`);
    }

    // Step 3: Chunk documents
    console.log('');
    console.log('✂️  Chunking documents...');
    
    const chunkedDocs = chunkAllDocuments(documents);
    const totalChunks = chunkedDocs.reduce((sum, doc) => sum + doc.chunks.length, 0);
    
    console.log(`   ✅ Created ${totalChunks} chunks`);

    // Step 4: Generate embeddings
    console.log('');
    console.log('🧠 Generating embeddings (this may take a while)...');
    
    const allChunks = chunkedDocs.flatMap(doc => doc.chunks);
    const embeddedChunks = await embedChunks(allChunks);
    
    const totalTokens = embeddedChunks.reduce((sum, c) => sum + (c.tokenCount || 0), 0);
    console.log(`   ✅ Generated embeddings (${totalTokens} tokens)`);

    // Step 5: Register document metadata and add chunks to index
    console.log('');
    console.log('💾 Adding to vector index...');
    
    // Register document metadata first (so retriever can find filenames)
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
    
    // Now add chunks to index
    await addToIndex(embeddedChunks);
    await saveIndex();
    
    console.log('   ✅ Chunks indexed and saved');

    // Final summary
    const stats = await getIndexStats();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    Ingestion Complete                        ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Documents processed: ${String(documents.length).padEnd(39)}║`);
    console.log(`║  Chunks created:      ${String(totalChunks).padEnd(39)}║`);
    console.log(`║  Tokens embedded:     ${String(totalTokens).padEnd(39)}║`);
    console.log(`║  Total in index:      ${String(stats.totalChunks).padEnd(39)}║`);
    console.log(`║  Duration:            ${(duration + 's').padEnd(39)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('');
    console.error('❌ Ingestion failed:', errorMsg);
    console.error('');
    
    if (error instanceof Error && error.stack) {
      logger.error('Ingestion error', { error: errorMsg, stack: error.stack });
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

  await runIngestion(args);
  process.exit(0);
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
