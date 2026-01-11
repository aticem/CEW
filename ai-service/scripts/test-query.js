#!/usr/bin/env node

/**
 * Query Testing Script
 * 
 * This script allows you to test the RAG query pipeline from the command line.
 * It's useful for testing the system without running the full API server.
 * 
 * Usage:
 *   npm run test-query
 *   node scripts/test-query.js "What is the project about?"
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { processQuery } from '../src/query/queryPipeline.js';
import logger from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

/**
 * Main query testing function
 */
async function main() {
  const args = process.argv.slice(2);
  const query = args.join(' ');

  logger.info('\n');
  logger.info('╔════════════════════════════════════════════════════════════╗');
  logger.info('║           CEW AI ASSISTANT - QUERY TESTING                ║');
  logger.info('╚════════════════════════════════════════════════════════════╝');
  logger.info('\n');

  if (!query || query.trim().length === 0) {
    logger.warn('⚠️  No query provided!\n');
    logger.info('Usage:');
    logger.info('  npm run test-query -- "Your question here"');
    logger.info('  node scripts/test-query.js "Your question here"\n');
    logger.info('Examples:');
    logger.info('  npm run test-query -- "What is the project timeline?"');
    logger.info('  node scripts/test-query.js "What are the technical specifications?"\n');
    process.exit(1);
  }

  try {
    logger.info(`🔍 Query: "${query}"\n`);

    // Execute the query using processQuery function
    logger.info('🤖 Processing query with BM25 keyword retrieval...\n');
    const startTime = Date.now();
    
    const result = await processQuery(query, { limit: 20 }); // Match validation limit
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Display results
    logger.info('╔════════════════════════════════════════════════════════════╗');
    logger.info('║                      QUERY RESULT                          ║');
    logger.info('╚════════════════════════════════════════════════════════════╝\n');

    if (!result.success) {
      logger.error(`❌ Query failed: ${result.error}\n`);
      process.exit(1);
    }

    logger.info(`💬 Answer:\n${result.answer}\n`);

    if (result.sources && result.sources.length > 0) {
      logger.info(`📚 Sources (${result.sources.length}):`);
      result.sources.forEach((source, idx) => {
        logger.info(`\n   ${idx + 1}. ${source.docName || 'Unknown'}`);
        logger.info(`      Score: ${source.relevanceScore?.toFixed(4) || 'N/A'}`);
        logger.info(`      Section: ${source.section || 'N/A'}`);
        logger.info(`      Type: ${source.docType || 'N/A'}`);
      });
      logger.info('');
    } else {
      logger.info('📚 Sources: None found\n');
    }

    logger.info(`⏱️  Query duration: ${duration}s`);
    logger.info(`🔢 Chunks retrieved: ${result.metadata?.chunksRetrieved || 'N/A'}`);
    logger.info(`🔢 Tokens used: ${result.metadata?.tokensUsed || 'N/A'}\n`);

    logger.info('✨ Query completed!\n');

    process.exit(0);

  } catch (error) {
    logger.error('\n❌ Error during query:', error);
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
