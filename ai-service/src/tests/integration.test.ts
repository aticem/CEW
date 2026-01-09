/**
 * CEW AI Service - Integration Test
 * 
 * Simple integration test to verify the full pipeline works:
 * Document → Ingest → Query → Response
 * 
 * Run: npx ts-node src/tests/integration.test.ts
 */

import path from 'path';
import fs from 'fs';

// Load environment
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { loadDocument } from '../ingest/documentLoader';
import { chunkDocument } from '../ingest/chunker';
import { classifyQuery } from '../query/queryClassifier';
import { validateInput, detectLanguage } from '../services/policyService';
import { logger } from '../services/loggerService';

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_DOCUMENT_PATH = path.resolve(__dirname, '../../documents/SAMPLE_README.txt');
const TEST_QUERIES = [
  { query: 'MC4 connector nedir?', expectedLang: 'tr' },
  { query: 'What are the ITP requirements?', expectedLang: 'en' },
  { query: 'QA/QC checklist', expectedLang: 'en' },
];

// ============================================================================
// Test Utilities
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

const results: TestResult[] = [];

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn())
    .then(() => {
      results.push({ name, passed: true });
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      results.push({ name, passed: false, error: err.message });
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
    });
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// ============================================================================
// Tests
// ============================================================================

async function runTests(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           CEW AI Service - Integration Tests                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // --------------------------------------------------------------------------
  // Test 1: Document exists
  // --------------------------------------------------------------------------
  console.log('📄 Document Loading Tests');
  
  await test('Sample document exists', () => {
    assert(fs.existsSync(TEST_DOCUMENT_PATH), `Document not found: ${TEST_DOCUMENT_PATH}`);
  });

  // --------------------------------------------------------------------------
  // Test 2: Document loading
  // --------------------------------------------------------------------------
  let loadedDocument: Awaited<ReturnType<typeof loadDocument>> | null = null;
  
  await test('Document loads successfully', async () => {
    loadedDocument = await loadDocument(TEST_DOCUMENT_PATH);
    assert(loadedDocument !== null, 'Document should not be null');
    assert(loadedDocument.content.length > 0, 'Document content should not be empty');
  });

  await test('Document has metadata', async () => {
    assert(loadedDocument !== null, 'Document not loaded');
    assert(loadedDocument!.metadata.filename === 'SAMPLE_README.txt', 'Filename should match');
    assert(loadedDocument!.metadata.fileType === 'txt', 'File type should be txt');
  });

  // --------------------------------------------------------------------------
  // Test 3: Document chunking
  // --------------------------------------------------------------------------
  console.log('');
  console.log('✂️  Chunking Tests');

  let chunks: ReturnType<typeof chunkDocument>['chunks'] = [];

  await test('Document chunks successfully', () => {
    assert(loadedDocument !== null, 'Document not loaded');
    const result = chunkDocument(loadedDocument!);
    chunks = result.chunks;
    assert(chunks.length > 0, 'Should create at least one chunk');
  });

  await test('Chunks have required fields', () => {
    assert(chunks.length > 0, 'No chunks to test');
    const firstChunk = chunks[0];
    assert(typeof firstChunk.content === 'string', 'Chunk should have content');
    assert(typeof firstChunk.chunkIndex === 'number', 'Chunk should have index');
    assert(firstChunk.content.length > 0, 'Chunk content should not be empty');
  });

  await test('Chunks contain expected content', () => {
    const allContent = chunks.map(c => c.content).join(' ');
    assert(allContent.includes('MC4'), 'Chunks should contain MC4 content');
    assert(allContent.includes('ITP'), 'Chunks should contain ITP content');
  });

  // --------------------------------------------------------------------------
  // Test 4: Query classification
  // --------------------------------------------------------------------------
  console.log('');
  console.log('🔍 Query Classification Tests');

  for (const { query, expectedLang } of TEST_QUERIES) {
    await test(`Classifies: "${query.substring(0, 30)}..."`, () => {
      const classification = classifyQuery(query);
      assert(classification.type !== undefined, 'Should have a type');
      assert(classification.confidence > 0, 'Should have confidence > 0');
      assert(Array.isArray(classification.keywords), 'Should have keywords array');
    });
  }

  // --------------------------------------------------------------------------
  // Test 5: Language detection
  // --------------------------------------------------------------------------
  console.log('');
  console.log('🌐 Language Detection Tests');

  await test('Detects Turkish', () => {
    const lang = detectLanguage('MC4 connector nedir?');
    assert(lang === 'tr', `Expected 'tr', got '${lang}'`);
  });

  await test('Detects English', () => {
    const lang = detectLanguage('What are the ITP requirements?');
    assert(lang === 'en', `Expected 'en', got '${lang}'`);
  });

  // --------------------------------------------------------------------------
  // Test 6: Input validation
  // --------------------------------------------------------------------------
  console.log('');
  console.log('✅ Input Validation Tests');

  await test('Validates normal input', () => {
    const result = validateInput('What is MC4 connector?');
    assert(result.valid, 'Normal input should be valid');
  });

  await test('Rejects empty input', () => {
    const result = validateInput('');
    assert(!result.valid, 'Empty input should be invalid');
  });

  await test('Rejects too short input', () => {
    const result = validateInput('hi');
    assert(!result.valid, 'Too short input should be invalid');
  });

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log('');
  console.log(`📊 Results: ${passed}/${total} passed`);
  
  if (failed > 0) {
    console.log('');
    console.log('❌ Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
  }

  console.log('');
  
  if (failed === 0) {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                 All Tests Passed! ✅                         ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    process.exit(0);
  } else {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                 Some Tests Failed ❌                         ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    process.exit(1);
  }
}

// ============================================================================
// Run Tests
// ============================================================================

// Suppress logger output during tests
logger.silent = true;

runTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
