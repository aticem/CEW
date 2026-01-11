#!/usr/bin/env node

/**
 * Document Ingestion Script
 * 
 * This script scans the documents/ folder, processes all supported files
 * (PDF, DOCX, XLSX, XLS), chunks them, generates embeddings, and stores them
 * in the vector database.
 * 
 * Usage:
 *   npm run ingest
 *   node scripts/ingest-documents.js
 *   node scripts/ingest-documents.js --file "path/to/specific/file.pdf"
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { IngestPipeline } from '../src/ingest/ingestPipeline.js';
import logger from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls'];

/**
 * Get all files from a directory recursively
 */
async function getAllFiles(dirPath, arrayOfFiles = []) {
  try {
    const files = await fs.readdir(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        arrayOfFiles = await getAllFiles(fullPath, arrayOfFiles);
      } else {
        const ext = path.extname(file).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          arrayOfFiles.push(fullPath);
        }
      }
    }

    return arrayOfFiles;
  } catch (error) {
    logger.error(`Error reading directory ${dirPath}:`, error);
    return arrayOfFiles;
  }
}

/**
 * Process a single file
 */
async function processFile(filePath, pipeline) {
  const fileName = path.basename(filePath);
  const startTime = Date.now();

  try {
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`Processing: ${fileName}`);
    logger.info(`Path: ${filePath}`);
    logger.info(`${'='.repeat(60)}`);

    const result = await pipeline.processDocument(filePath);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info(`✅ SUCCESS: ${fileName}`);
    logger.info(`   - Chunks created: ${result.chunksCreated}`);
    logger.info(`   - Embeddings generated: ${result.embeddingsGenerated}`);
    logger.info(`   - Vectors stored: ${result.vectorsStored}`);
    logger.info(`   - Duration: ${duration}s`);

    return { success: true, file: fileName, result };
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.error(`❌ FAILED: ${fileName}`);
    logger.error(`   - Error: ${error.message}`);
    logger.error(`   - Duration: ${duration}s`);

    return { success: false, file: fileName, error: error.message };
  }
}

/**
 * Main ingestion function
 */
async function main() {
  const args = process.argv.slice(2);
  const specificFile = args.find(arg => arg.startsWith('--file='))?.split('=')[1] ||
                       args[args.indexOf('--file') + 1];

  logger.info('\n');
  logger.info('╔════════════════════════════════════════════════════════════╗');
  logger.info('║          CEW AI ASSISTANT - DOCUMENT INGESTION            ║');
  logger.info('╚════════════════════════════════════════════════════════════╝');
  logger.info('\n');

  try {
    // Initialize the ingestion pipeline
    logger.info('🔧 Initializing ingestion pipeline...');
    const pipeline = new IngestPipeline();
    await pipeline.initialize();
    logger.info('✅ Pipeline initialized successfully\n');

    // Determine files to process
    let filesToProcess = [];
    const documentsDir = path.join(__dirname, '../documents');

    if (specificFile) {
      const filePath = path.isAbsolute(specificFile) 
        ? specificFile 
        : path.join(process.cwd(), specificFile);
      
      logger.info(`📄 Processing specific file: ${specificFile}\n`);
      filesToProcess = [filePath];
    } else {
      logger.info(`📁 Scanning documents directory: ${documentsDir}\n`);
      filesToProcess = await getAllFiles(documentsDir);
      
      if (filesToProcess.length === 0) {
        logger.warn('⚠️  No supported documents found in the documents/ folder');
        logger.info(`   Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')}`);
        logger.info('\n   Please add documents to the documents/ folder and try again.\n');
        process.exit(0);
      }

      logger.info(`📊 Found ${filesToProcess.length} document(s) to process:`);
      filesToProcess.forEach((file, idx) => {
        logger.info(`   ${idx + 1}. ${path.basename(file)}`);
      });
      logger.info('');
    }

    // Process all files
    const results = [];
    for (let i = 0; i < filesToProcess.length; i++) {
      const result = await processFile(filesToProcess[i], pipeline);
      results.push(result);
    }

    // Summary
    logger.info('\n');
    logger.info('╔════════════════════════════════════════════════════════════╗');
    logger.info('║                    INGESTION SUMMARY                       ║');
    logger.info('╚════════════════════════════════════════════════════════════╝');

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    logger.info(`\n📊 Total files processed: ${results.length}`);
    logger.info(`   ✅ Successful: ${successful}`);
    logger.info(`   ❌ Failed: ${failed}`);

    if (successful > 0) {
      const totalChunks = results
        .filter(r => r.success)
        .reduce((sum, r) => sum + r.result.chunksCreated, 0);
      const totalVectors = results
        .filter(r => r.success)
        .reduce((sum, r) => sum + r.result.vectorsStored, 0);

      logger.info(`\n📈 Statistics:`);
      logger.info(`   - Total chunks created: ${totalChunks}`);
      logger.info(`   - Total vectors stored: ${totalVectors}`);
    }

    if (failed > 0) {
      logger.info(`\n❌ Failed files:`);
      results
        .filter(r => !r.success)
        .forEach(r => {
          logger.info(`   - ${r.file}: ${r.error}`);
        });
    }

    logger.info('\n✨ Ingestion completed!\n');

    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    logger.error('\n❌ Fatal error during ingestion:', error);
    logger.error(error.stack);
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection:', error);
  process.exit(1);
});

// Run the script
main();
