/**
 * Test chat script
 * Usage: npm run test-chat "Your question here"
 */
import { vectorStore } from '../vector';
import { responseGenerator } from '../query/responseGenerator';
import { logger } from '../services/logger';

/**
 * Main test function
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.log(`
CEW AI Service - Test Chat Script

Usage:
  npm run test-chat "Your question here"

Examples:
  npm run test-chat "What is the project about?"
  npm run test-chat "Proje hakkında ne biliyorsun?"
  npm run test-chat "Hello"

This script tests the complete RAG pipeline without starting the HTTP server.
      `);
      process.exit(0);
    }

    const query = args.join(' ');
    
    console.log('\n=== CEW AI Assistant Test ===\n');
    console.log(`Query: "${query}"\n`);

    // Initialize vector store
    console.log('Initializing services...');
    await vectorStore.initialize();
    
    // Get stats
    const stats = await vectorStore.getStats();
    console.log(`Vector store: ${stats.uniqueDocuments} documents, ${stats.totalChunks} chunks\n`);

    if (stats.totalChunks === 0) {
      console.warn('⚠️  Warning: No documents in vector store. Ingest documents first using:');
      console.warn('   npm run ingest <path>\n');
    }

    // Generate response
    console.log('Processing query...\n');
    const startTime = Date.now();
    
    const response = await responseGenerator.generateResponse({
      query
    });

    const duration = Date.now() - startTime;

    // Display results
    console.log('=== Response ===\n');
    console.log(response.answer);
    console.log('\n=== Metadata ===');
    console.log(`Query Type: ${response.queryType}`);
    console.log(`Language: ${response.language}`);
    console.log(`Confidence: ${(response.confidence * 100).toFixed(1)}%`);
    console.log(`Processing Time: ${response.processingTime}ms (Total: ${duration}ms)`);
    
    if (response.tokenUsage) {
      console.log(`Token Usage: ${response.tokenUsage.total} (prompt: ${response.tokenUsage.prompt}, completion: ${response.tokenUsage.completion})`);
    }

    if (response.sources && response.sources.length > 0) {
      console.log('\n=== Sources ===');
      response.sources.forEach((source, idx) => {
        console.log(`${idx + 1}. ${source.filename}${source.pageNumber ? ` (Page ${source.pageNumber})` : ''}`);
        console.log(`   Relevance: ${(source.relevanceScore * 100).toFixed(1)}%`);
        console.log(`   Excerpt: ${source.excerpt.substring(0, 100)}...`);
      });
    }

    if (response.warnings && response.warnings.length > 0) {
      console.log('\n=== Warnings ===');
      response.warnings.forEach(warning => {
        console.log(`⚠️  ${warning}`);
      });
    }

    console.log('\n✓ Test completed successfully\n');
    process.exit(0);

  } catch (error) {
    logger.error('Test chat script failed', { error });
    console.error('\n✗ Test failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

// Run the script
main();
