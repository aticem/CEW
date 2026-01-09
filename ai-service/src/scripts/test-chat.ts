#!/usr/bin/env ts-node
/**
 * Chat API Test Script
 * 
 * Simple script to test the /api/chat endpoint with sample queries.
 * 
 * Usage:
 *   npx ts-node src/scripts/test-chat.ts
 *   npx ts-node src/scripts/test-chat.ts --url http://localhost:3001
 */

// ============================================================================
// Types
// ============================================================================

interface ChatResponse {
  success: boolean;
  message: string;
  conversationId: string;
  sources: Array<{
    type: string;
    filename: string;
    pageNumber?: number;
    excerpt: string;
    relevanceScore: number;
  }>;
  queryType: string;
  confidence: number;
  metrics?: {
    processingTimeMs: number;
    chunksRetrieved: number;
  };
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

interface TestQuery {
  name: string;
  message: string;
  expectedType?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_URL = 'http://localhost:3001';

function getServerUrl(): string {
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf('--url');
  if (urlIndex !== -1 && urlIndex + 1 < args.length) {
    return args[urlIndex + 1];
  }
  return DEFAULT_URL;
}

// ============================================================================
// Test Queries
// ============================================================================

const testQueries: TestQuery[] = [
  {
    name: 'Turkish Technical Query',
    message: 'MC4 connector nedir?',
    expectedType: 'document',
  },
  {
    name: 'English Technical Query',
    message: 'What are the ITP requirements?',
    expectedType: 'document',
  },
  {
    name: 'Turkish Greeting (should still work)',
    message: 'Merhaba nasılsın?',
    expectedType: 'document',
  },
  {
    name: 'English Procedure Query',
    message: 'How to install solar panels?',
    expectedType: 'document',
  },
  {
    name: 'Data Query (MVP message expected)',
    message: 'How many panels were installed today?',
    expectedType: 'data',
  },
];

// ============================================================================
// HTTP Client
// ============================================================================

async function sendChatRequest(
  url: string,
  message: string
): Promise<{ response: ChatResponse | null; error: string | null; timeMs: number }> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    const data = await response.json() as ChatResponse;
    const timeMs = Date.now() - startTime;

    return { response: data, error: null, timeMs };
  } catch (error) {
    const timeMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { response: null, error: errorMsg, timeMs };
  }
}

// ============================================================================
// Test Runner
// ============================================================================

async function runTests(): Promise<void> {
  const serverUrl = getServerUrl();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              CEW AI Service - Chat API Tests                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🌐 Server URL: ${serverUrl}`);
  console.log('');

  // First, check if server is running
  console.log('🔍 Checking server health...');
  
  try {
    const healthResponse = await fetch(`${serverUrl}/health`);
    const healthData = await healthResponse.json();
    
    if (healthData.status === 'ok' || healthData.status === 'degraded') {
      console.log('   ✅ Server is running');
      console.log(`   📊 Index: ${healthData.indexStats?.totalChunks || 0} chunks, ${healthData.indexStats?.totalDocuments || 0} documents`);
    } else {
      console.log('   ⚠️  Server status:', healthData.status);
    }
  } catch (error) {
    console.log('   ❌ Server is not reachable');
    console.log('');
    console.log('Make sure the server is running:');
    console.log('  cd ai-service');
    console.log('  npm run dev');
    console.log('');
    process.exit(1);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Run test queries
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testQueries.length; i++) {
    const query = testQueries[i];
    
    console.log(`📝 Test ${i + 1}/${testQueries.length}: ${query.name}`);
    console.log(`   Query: "${query.message}"`);
    
    const { response, error, timeMs } = await sendChatRequest(serverUrl, query.message);

    if (error) {
      console.log(`   ❌ Error: ${error}`);
      failed++;
      console.log('');
      continue;
    }

    if (!response) {
      console.log('   ❌ No response received');
      failed++;
      console.log('');
      continue;
    }

    // Log results
    console.log(`   ⏱️  Time: ${timeMs}ms`);
    console.log(`   📊 Type: ${response.queryType}`);
    console.log(`   🎯 Confidence: ${(response.confidence * 100).toFixed(0)}%`);
    console.log(`   📚 Sources: ${response.sources?.length || 0}`);

    if (response.success) {
      // Truncate long messages
      const messagePreview = response.message.length > 200 
        ? response.message.substring(0, 200) + '...' 
        : response.message;
      console.log(`   💬 Response: "${messagePreview}"`);
      
      // Show sources if any
      if (response.sources && response.sources.length > 0) {
        console.log('   📄 Source files:');
        for (const source of response.sources.slice(0, 3)) {
          console.log(`      - ${source.filename}${source.pageNumber ? ` (p.${source.pageNumber})` : ''} [${(source.relevanceScore * 100).toFixed(0)}%]`);
        }
      }
      
      passed++;
      console.log('   ✅ PASSED');
    } else {
      console.log(`   ❌ Error: ${response.error?.message || 'Unknown error'}`);
      failed++;
    }

    console.log('');

    // Small delay between requests
    await sleep(500);
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 Test Summary:');
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📝 Total:  ${testQueries.length}`);
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Main
// ============================================================================

runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
