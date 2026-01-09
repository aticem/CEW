/**
 * Document ingestion script
 * Usage: npm run ingest <filepath or directory>
 */
import { config } from '../config';
import { logger } from '../services/logger';
import { chromaVectorStore } from '../vector/chroma';
import { ingestPipeline } from '../ingest';
import fs from 'fs';
import path from 'path';

/**
 * Main ingestion function
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.log(`
CEW AI Service - Document Ingestion Script

Usage:
  npm run ingest <path>

Examples:
  npm run ingest /path/to/document.pdf
  npm run ingest /path/to/documents/directory

Supported formats: PDF, DOCX, XLSX, TXT
      `);
      process.exit(0);
    }

    const inputPath = path.resolve(args[0]);
    
    // Check if path exists
    if (!fs.existsSync(inputPath)) {
      logger.error(`Path does not exist: ${inputPath}`);
      process.exit(1);
    }

    logger.info('Starting document ingestion');
    logger.info(`Input path: ${inputPath}`);

    // Initialize vector store
    await chromaVectorStore.initialize();

    // Check if path is file or directory
    const stats = fs.statSync(inputPath);
    
    if (stats.isFile()) {
      // Ingest single file
      logger.info('Ingesting single document...');
      const result = await ingestPipeline.ingestDocument(inputPath);
      
      if (result.success) {
        console.log('\n✓ Document ingested successfully!');
        console.log(`  Document ID: ${result.documentId}`);
        console.log(`  Chunks created: ${result.chunksCreated}`);
        console.log(`  Processing time: ${result.processingTime}ms`);
        
        if (result.warnings && result.warnings.length > 0) {
          console.log(`  Warnings: ${result.warnings.join(', ')}`);
        }
      } else {
        console.error('\n✗ Document ingestion failed');
        console.error(`  Error: ${result.error}`);
        process.exit(1);
      }
      
    } else if (stats.isDirectory()) {
      // Ingest directory
      logger.info('Ingesting directory...');
      const results = await ingestPipeline.ingestDirectory(inputPath);
      
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      
      console.log('\n=== Ingestion Summary ===');
      console.log(`Total documents: ${results.length}`);
      console.log(`✓ Successful: ${successful.length}`);
      console.log(`✗ Failed: ${failed.length}`);
      console.log(`Total chunks: ${successful.reduce((sum, r) => sum + r.chunksCreated, 0)}`);
      
      if (successful.length > 0) {
        console.log('\nSuccessfully ingested:');
        successful.forEach(r => {
          console.log(`  ✓ ${r.metadata?.filename} (${r.chunksCreated} chunks)`);
        });
      }
      
      if (failed.length > 0) {
        console.log('\nFailed to ingest:');
        failed.forEach(r => {
          console.log(`  ✗ ${r.error}`);
        });
      }
    }

    // Get final stats
    const vectorStats = await chromaVectorStore.getStats();
    console.log('\n=== Vector Store Stats ===');
    console.log(`Total documents: ${vectorStats.uniqueDocuments}`);
    console.log(`Total chunks: ${vectorStats.totalChunks}`);
    
    logger.info('Ingestion complete');
    process.exit(0);

  } catch (error) {
    logger.error('Ingestion script failed', { error });
    console.error('\n✗ Ingestion failed:',error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

// Run the script
main();
