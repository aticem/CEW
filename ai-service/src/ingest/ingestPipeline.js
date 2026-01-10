import { readdir, readFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import config from '../config/env.js';
import { parseWordDocument, detectWordHeadings } from './parsers/wordParser.js';
import { parsePDFDocument, detectPDFHeadings } from './parsers/pdfParser.js';
import { parseExcelDocument } from './parsers/excelParser.js';
import { chunkWordText, chunkPDFText } from './chunking/textChunker.js';
import { chunkExcel } from './chunking/excelChunker.js';
import { batchGenerateEmbeddings } from './embeddings/embeddingService.js';
import * as vectorDb from '../vector/vectorDbClient.js';

/**
 * Main ingest pipeline orchestrator
 * Processes all documents from the documents directory
 */
export async function ingestDocuments() {
  const startTime = Date.now();
  const stats = {
    filesProcessed: 0,
    filesSkipped: 0,
    filesError: 0,
    chunksCreated: 0,
    vectorsUpserted: 0,
  };

  try {
    logger.info('Starting document ingestion', {
      documentsPath: config.documentsPath,
    });

    // Initialize vector database
    await vectorDb.initialize();

    // Get list of files
    const files = await listDocuments(config.documentsPath);
    logger.info('Found documents', { count: files.length });

    // Process each file
    for (const file of files) {
      try {
        await ingestDocument(file);
        stats.filesProcessed++;
      } catch (error) {
        logger.error('Error ingesting document', {
          file: file.name,
          error: error.message,
        });
        stats.filesError++;
      }
    }

    // Get final stats
    const collectionInfo = await vectorDb.getCollectionInfo();
    stats.vectorsUpserted = collectionInfo.pointsCount || 0;

    const duration = Date.now() - startTime;
    logger.info('Document ingestion complete', {
      ...stats,
      durationMs: duration,
    });

    return {
      success: true,
      stats,
      durationMs: duration,
    };
  } catch (error) {
    logger.error('Error in ingest pipeline', {
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      error: error.message,
      stats,
    };
  }
}

/**
 * Ingest a single document
 */
export async function ingestDocument(file) {
  logger.info('Ingesting document', { file: file.name });

  // Read file buffer
  const buffer = await readFile(file.path);

  // Create document metadata
  const metadata = {
    doc_id: uuidv4(),
    doc_name: file.name,
    doc_type: getDocumentType(file.extension),
    doc_path: file.path,
  };

  // Parse document based on type
  let parseResult;
  let headings = [];
  let chunks = [];

  switch (file.extension) {
    case '.docx':
    case '.doc':
      parseResult = await parseWordDocument(buffer, metadata);
      if (parseResult.status === 'SUCCESS') {
        headings = detectWordHeadings(parseResult.paragraphs);
        chunks = chunkWordText(parseResult.paragraphs, headings);
      }
      break;

    case '.pdf':
      parseResult = await parsePDFDocument(buffer, metadata);
      if (parseResult.status === 'SUCCESS') {
        headings = detectPDFHeadings(parseResult.text);
        chunks = chunkPDFText(parseResult.pages, headings);
      }
      break;

    case '.xlsx':
    case '.xls':
      parseResult = await parseExcelDocument(buffer, metadata);
      if (parseResult.status === 'SUCCESS') {
        chunks = chunkExcel(parseResult.sheets);
      }
      break;

    default:
      throw new Error(`Unsupported file type: ${file.extension}`);
  }

  // Check parse status
  if (parseResult.status !== 'SUCCESS') {
    throw new Error(`Failed to parse document: ${parseResult.error || parseResult.status}`);
  }

  // Check if we have chunks
  if (chunks.length === 0) {
    logger.warn('No chunks created from document', { file: file.name });
    return {
      success: true,
      chunksCreated: 0,
      message: 'No content to index',
    };
  }

  logger.info('Document parsed and chunked', {
    file: file.name,
    chunks: chunks.length,
  });

  // Generate embeddings for chunks
  const texts = chunks.map(c => c.text);
  const embeddings = await batchGenerateEmbeddings(texts);

  // Create vectors for database
  const vectors = chunks.map((chunk, index) => ({
    id: `${metadata.doc_id}_chunk_${index}`,
    values: embeddings[index],
    metadata: {
      doc_id: metadata.doc_id,
      doc_name: metadata.doc_name,
      doc_type: metadata.doc_type,
      chunk_index: index,
      chunk_text: chunk.text,
      token_count: chunk.tokenCount,
      // Document-specific metadata
      page: chunk.pageNumber || null,
      section: chunk.section || null,
      sheet_name: chunk.sheetName || null,
      row_number: chunk.rowNumber || null,
      // Timestamps
      ingested_at: new Date().toISOString(),
    },
  }));

  // Upsert to vector database
  await vectorDb.upsert(vectors);

  logger.info('Document ingested successfully', {
    file: file.name,
    chunks: chunks.length,
    vectors: vectors.length,
  });

  return {
    success: true,
    chunksCreated: chunks.length,
    vectorsUpserted: vectors.length,
  };
}

/**
 * List all documents in the directory
 */
async function listDocuments(directoryPath) {
  const supportedExtensions = ['.pdf', '.docx', '.doc', '.xlsx', '.xls'];
  const files = [];

  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          files.push({
            name: entry.name,
            path: join(directoryPath, entry.name),
            extension: ext,
          });
        }
      }
    }
  } catch (error) {
    logger.error('Error listing documents', {
      directoryPath,
      error: error.message,
    });
    throw error;
  }

  return files;
}

/**
 * Get document type from extension
 */
function getDocumentType(extension) {
  const typeMap = {
    '.pdf': 'PDF',
    '.docx': 'WORD',
    '.doc': 'WORD',
    '.xlsx': 'EXCEL',
    '.xls': 'EXCEL',
  };

  return typeMap[extension] || 'UNKNOWN';
}

export default {
  ingestDocuments,
  ingestDocument,
};
