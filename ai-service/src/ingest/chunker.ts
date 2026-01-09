import { v4 as uuidv4 } from 'uuid';
import { DocumentChunk, ChunkMetadata, ParsedDocument } from '../types';
import { config } from '../config';
import { logger } from '../services/logger';

interface ContentSegment {
  content: string;
  pageNumber?: number;
  sheetName?: string;
  startOffset: number;
}

interface ChunkingStats {
  documentsProcessed: number;
  totalChunks: number;
  averageChunkSize: number;
  minChunkSize: number;
  maxChunkSize: number;
}

export function chunkDocument(document: ParsedDocument): DocumentChunk[] {
  const startTime = Date.now();
  const chunks: DocumentChunk[] = [];
  const documentId = document.metadata.id;
  const segments = extractContentSegments(document);

  if (segments.length === 0) {
    logger.warn('Document has no content to chunk', { documentId, filename: document.metadata.filename });
    return [];
  }

  let globalChunkIndex = 0;
  for (const segment of segments) {
    const segmentChunks = chunkSegment(segment, documentId, globalChunkIndex, config.maxChunkSize, config.chunkOverlap);
    chunks.push(...segmentChunks);
    globalChunkIndex += segmentChunks.length;
  }

  const processingTime = Date.now() - startTime;
  logger.info('Document chunked', {
    documentId,
    filename: document.metadata.filename,
    totalChunks: chunks.length,
    avgChunkSize: chunks.length > 0 ? Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length) : 0,
    processingTimeMs: processingTime,
  });

  return chunks;
}

export function chunkAllDocuments(documents: ParsedDocument[]): DocumentChunk[] {
  const startTime = Date.now();
  const allChunks: DocumentChunk[] = [];

  if (documents.length === 0) {
    logger.warn('No documents provided for chunking');
    return [];
  }

  for (const document of documents) {
    const documentChunks = chunkDocument(document);
    allChunks.push(...documentChunks);
  }

  const stats = calculateStats(documents.length, allChunks);
  logChunkingStats(stats, Date.now() - startTime);
  return allChunks;
}

function extractContentSegments(document: ParsedDocument): ContentSegment[] {
  const segments: ContentSegment[] = [];
  if (document.chunks && document.chunks.length > 0) {
    let cumulativeOffset = 0;
    for (const chunk of document.chunks) {
      if (chunk.content && chunk.content.trim().length > 0) {
        segments.push({
          content: chunk.content,
          pageNumber: chunk.metadata.pageNumber,
          sheetName: chunk.metadata.sheetName,
          startOffset: cumulativeOffset,
        });
        cumulativeOffset += chunk.content.length + 1;
      }
    }
  }
  return segments;
}

function chunkSegment(segment: ContentSegment, documentId: string, startChunkIndex: number, maxChunkSize: number, chunkOverlap: number): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const { content, pageNumber, sheetName, startOffset } = segment;
  const cleanedContent = cleanText(content);

  if (cleanedContent.length === 0) return chunks;

  if (cleanedContent.length <= maxChunkSize) {
    chunks.push(createChunk(documentId, cleanedContent, startChunkIndex, startOffset, startOffset + cleanedContent.length, pageNumber, sheetName));
    return chunks;
  }

  const paragraphs = splitByParagraphs(cleanedContent);
  let currentChunkText = '';
  let currentChunkStart = startOffset;
  let chunkIndex = startChunkIndex;

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];

    if (paragraph.length > maxChunkSize) {
      if (currentChunkText.length > 0) {
        chunks.push(createChunk(documentId, currentChunkText.trim(), chunkIndex++, currentChunkStart, currentChunkStart + currentChunkText.length, pageNumber, sheetName));
        currentChunkStart += currentChunkText.length + 2;
        currentChunkText = '';
      }
      const sentenceChunks = splitBySentences(paragraph, maxChunkSize, chunkOverlap);
      for (const sentenceChunk of sentenceChunks) {
        chunks.push(createChunk(documentId, sentenceChunk.text, chunkIndex++, currentChunkStart + sentenceChunk.start, currentChunkStart + sentenceChunk.end, pageNumber, sheetName));
      }
      currentChunkStart += paragraph.length + 2;
      continue;
    }

    const separator = currentChunkText.length > 0 ? '

' : '';
    const wouldBeLength = currentChunkText.length + separator.length + paragraph.length;

    if (wouldBeLength <= maxChunkSize) {
      currentChunkText += separator + paragraph;
    } else {
      if (currentChunkText.length > 0) {
        chunks.push(createChunk(documentId, currentChunkText.trim(), chunkIndex++, currentChunkStart, currentChunkStart + currentChunkText.length, pageNumber, sheetName));
        if (chunkOverlap > 0 && currentChunkText.length > chunkOverlap) {
          const overlapText = getOverlapText(currentChunkText, chunkOverlap);
          currentChunkStart = currentChunkStart + currentChunkText.length - overlapText.length;
          currentChunkText = overlapText + '

' + paragraph;
        } else {
          currentChunkStart += currentChunkText.length + 2;
          currentChunkText = paragraph;
        }
      } else {
        currentChunkText = paragraph;
      }
    }
  }

  if (currentChunkText.trim().length > 0) {
    chunks.push(createChunk(documentId, currentChunkText.trim(), chunkIndex, currentChunkStart, currentChunkStart + currentChunkText.length, pageNumber, sheetName));
  }

  return chunks;
}

function splitByParagraphs(text: string): string[] {
  return text.split(/
s*
/).map(p => p.trim()).filter(p => p.length > 0);
}

function splitBySentences(text: string, maxChunkSize: number, chunkOverlap: number): Array<{ text: string; start: number; end: number }> {
  const result: Array<{ text: string; start: number; end: number }> = [];
  const sentencePattern = /(?<=[.!?])s+(?=[A-Z])|(?<=[.!?])s*$/g;
  const sentences = text.split(sentencePattern).filter(s => s.trim().length > 0);
  let currentText = '';
  let currentStart = 0;

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (trimmedSentence.length > maxChunkSize) {
      if (currentText.length > 0) {
        result.push({ text: currentText.trim(), start: currentStart, end: currentStart + currentText.length });
        currentStart += currentText.length + 1;
        currentText = '';
      }
      const wordChunks = splitByWords(trimmedSentence, maxChunkSize, chunkOverlap);
      for (const wordChunk of wordChunks) {
        result.push({ text: wordChunk, start: currentStart, end: currentStart + wordChunk.length });
        currentStart += wordChunk.length - chunkOverlap;
      }
      continue;
    }
    const separator = currentText.length > 0 ? ' ' : '';
    const wouldBeLength = currentText.length + separator.length + trimmedSentence.length;
    if (wouldBeLength <= maxChunkSize) {
      currentText += separator + trimmedSentence;
    } else {
      if (currentText.length > 0) {
        result.push({ text: currentText.trim(), start: currentStart, end: currentStart + currentText.length });
        if (chunkOverlap > 0) {
          const overlapText = getOverlapText(currentText, chunkOverlap);
          currentStart = currentStart + currentText.length - overlapText.length;
          currentText = overlapText + ' ' + trimmedSentence;
        } else {
          currentStart += currentText.length + 1;
          currentText = trimmedSentence;
        }
      } else {
        currentText = trimmedSentence;
      }
    }
  }
  if (currentText.trim().length > 0) {
    result.push({ text: currentText.trim(), start: currentStart, end: currentStart + currentText.length });
  }
  return result;
}

function splitByWords(text: string, maxChunkSize: number, chunkOverlap: number): string[] {
  const chunks: string[] = [];
  const words = text.split(/s+/);
  let currentChunk = '';

  for (const word of words) {
    const separator = currentChunk.length > 0 ? ' ' : '';
    const wouldBeLength = currentChunk.length + separator.length + word.length;
    if (wouldBeLength <= maxChunkSize) {
      currentChunk += separator + word;
    } else {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        if (chunkOverlap > 0) {
          const overlapText = getOverlapText(currentChunk, chunkOverlap);
          currentChunk = overlapText + ' ' + word;
        } else {
          currentChunk = word;
        }
      } else {
        currentChunk = word.substring(0, maxChunkSize);
      }
    }
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);
  return chunks;
}

function getOverlapText(text: string, overlapSize: number): string {
  if (text.length <= overlapSize) return text;
  let overlap = text.slice(-overlapSize);
  const firstSpace = overlap.indexOf(' ');
  if (firstSpace > 0 && firstSpace < overlapSize / 2) {
    overlap = overlap.slice(firstSpace + 1);
  }
  return overlap.trim();
}

function createChunk(documentId: string, content: string, chunkIndex: number, startOffset: number, endOffset: number, pageNumber?: number, sheetName?: string): DocumentChunk {
  const metadata: ChunkMetadata = { chunkIndex, startOffset, endOffset };
  if (pageNumber !== undefined) metadata.pageNumber = pageNumber;
  if (sheetName !== undefined) metadata.sheetName = sheetName;
  const headers = extractHeaders(content);
  if (headers.length > 0) metadata.headers = headers;
  return { id: uuidv4(), documentId, content, metadata, embedding: [] };
}

function cleanText(text: string): string {
  return text
    .replace(/
/g, '
')
    .replace(//g, '
')
    .replace(/	/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/
{3,}/g, '

')
    .trim();
}

function extractHeaders(content: string): string[] {
  const headers: string[] = [];
  const lines = content.split('
').slice(0, 5);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length < 100 && (trimmed === trimmed.toUpperCase() || trimmed.endsWith(':') || /^#+s/.test(trimmed) || /^[A-Z][^.!?]*$/.test(trimmed))) {
      const cleanHeader = trimmed.replace(/^#+s*/, '').replace(/:$/, '');
      headers.push(cleanHeader);
    }
  }
  return headers;
}

function calculateStats(documentsCount: number, chunks: DocumentChunk[]): ChunkingStats {
  if (chunks.length === 0) {
    return { documentsProcessed: documentsCount, totalChunks: 0, averageChunkSize: 0, minChunkSize: 0, maxChunkSize: 0 };
  }
  const sizes = chunks.map(c => c.content.length);
  const totalSize = sizes.reduce((sum, size) => sum + size, 0);
  return {
    documentsProcessed: documentsCount,
    totalChunks: chunks.length,
    averageChunkSize: Math.round(totalSize / chunks.length),
    minChunkSize: Math.min(...sizes),
    maxChunkSize: Math.max(...sizes),
  };
}

function logChunkingStats(stats: ChunkingStats, processingTimeMs: number): void {
  logger.info('Chunking completed', {
    documentsProcessed: stats.documentsProcessed,
    totalChunks: stats.totalChunks,
    averageChunkSize: stats.averageChunkSize,
    minChunkSize: stats.minChunkSize,
    maxChunkSize: stats.maxChunkSize,
    processingTimeMs,
  });
}

export default { chunkDocument, chunkAllDocuments };
