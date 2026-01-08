import { v4 as uuidv4 } from 'uuid';
import { DocumentChunk, ChunkMetadata } from '../types';
import { config } from '../config';
import { logger } from '../services/logger';
import { LoadedDocument, PageContent } from './documentLoader';

export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  preserveParagraphs?: boolean;
  preserveSentences?: boolean;
}

class Chunker {
  private defaultOptions: Required<ChunkingOptions> = {
    chunkSize: config.documents.maxChunkSize,
    chunkOverlap: config.documents.chunkOverlap,
    preserveParagraphs: true,
    preserveSentences: true,
  };

  chunk(document: LoadedDocument, options?: ChunkingOptions): DocumentChunk[] {
    const opts = { ...this.defaultOptions, ...options };
    const chunks: DocumentChunk[] = [];

    if (document.pages && document.pages.length > 0) {
      // Process page by page for better metadata
      document.pages.forEach((page) => {
        const pageChunks = this.chunkText(
          page.content,
          document.metadata.id,
          opts,
          page.pageNumber
        );
        chunks.push(...pageChunks);
      });
    } else {
      // Process entire document
      const contentChunks = this.chunkText(
        document.content,
        document.metadata.id,
        opts
      );
      chunks.push(...contentChunks);
    }

    logger.info('Document chunked', {
      documentId: document.metadata.id,
      filename: document.metadata.filename,
      totalChunks: chunks.length,
      avgChunkSize: Math.round(
        chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length
      ),
    });

    return chunks;
  }

  private chunkText(
    text: string,
    documentId: string,
    options: Required<ChunkingOptions>,
    pageNumber?: number
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const { chunkSize, chunkOverlap, preserveParagraphs, preserveSentences } =
      options;

    // Clean and normalize text
    const cleanedText = this.cleanText(text);

    if (cleanedText.length === 0) {
      return chunks;
    }

    // Split into segments based on preservation rules
    let segments: string[];

    if (preserveParagraphs) {
      segments = this.splitByParagraphs(cleanedText);
    } else if (preserveSentences) {
      segments = this.splitBySentences(cleanedText);
    } else {
      segments = [cleanedText];
    }

    // Build chunks from segments
    let currentChunk = '';
    let currentStart = 0;
    let chunkIndex = 0;

    for (const segment of segments) {
      if (currentChunk.length + segment.length <= chunkSize) {
        currentChunk += (currentChunk ? '\n' : '') + segment;
      } else {
        // Save current chunk if it has content
        if (currentChunk.length > 0) {
          chunks.push(
            this.createChunk(
              documentId,
              currentChunk,
              chunkIndex,
              currentStart,
              pageNumber
            )
          );
          chunkIndex++;

          // Handle overlap
          if (chunkOverlap > 0 && currentChunk.length > chunkOverlap) {
            currentChunk = currentChunk.slice(-chunkOverlap);
            currentStart = currentStart + currentChunk.length - chunkOverlap;
          } else {
            currentChunk = '';
            currentStart = currentStart + currentChunk.length;
          }
        }

        // Handle segment larger than chunk size
        if (segment.length > chunkSize) {
          const subChunks = this.splitLargeSegment(segment, chunkSize, chunkOverlap);
          subChunks.forEach((subChunk, subIndex) => {
            chunks.push(
              this.createChunk(
                documentId,
                subChunk,
                chunkIndex,
                currentStart,
                pageNumber
              )
            );
            chunkIndex++;
            currentStart += subChunk.length - chunkOverlap;
          });
          currentChunk = '';
        } else {
          currentChunk = segment;
        }
      }
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      chunks.push(
        this.createChunk(
          documentId,
          currentChunk,
          chunkIndex,
          currentStart,
          pageNumber
        )
      );
    }

    return chunks;
  }

  private createChunk(
    documentId: string,
    content: string,
    chunkIndex: number,
    startChar: number,
    pageNumber?: number
  ): DocumentChunk {
    const metadata: ChunkMetadata = {
      chunkIndex,
      startChar,
      endChar: startChar + content.length,
    };

    if (pageNumber !== undefined) {
      metadata.pageNumber = pageNumber;
    }

    // Extract headers if present
    const headers = this.extractHeaders(content);
    if (headers.length > 0) {
      metadata.headers = headers;
    }

    return {
      id: uuidv4(),
      documentId,
      content,
      metadata,
    };
  }

  private cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\t/g, ' ') // Replace tabs with spaces
      .replace(/ +/g, ' ') // Collapse multiple spaces
      .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
      .trim();
  }

  private splitByParagraphs(text: string): string[] {
    return text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  private splitBySentences(text: string): string[] {
    // Simple sentence splitting - can be improved with NLP library
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private splitLargeSegment(
    segment: string,
    chunkSize: number,
    overlap: number
  ): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < segment.length) {
      const end = Math.min(start + chunkSize, segment.length);
      let chunk = segment.slice(start, end);

      // Try to break at word boundary
      if (end < segment.length) {
        const lastSpace = chunk.lastIndexOf(' ');
        if (lastSpace > chunkSize * 0.8) {
          chunk = chunk.slice(0, lastSpace);
        }
      }

      chunks.push(chunk.trim());
      start = start + chunk.length - overlap;
    }

    return chunks;
  }

  private extractHeaders(content: string): string[] {
    const headers: string[] = [];
    const lines = content.split('\n');

    for (const line of lines.slice(0, 5)) {
      // Check first 5 lines
      const trimmed = line.trim();
      // Heuristics for headers: short, possibly uppercase, ends with colon
      if (
        trimmed.length > 0 &&
        trimmed.length < 100 &&
        (trimmed === trimmed.toUpperCase() ||
          trimmed.endsWith(':') ||
          /^#+\s/.test(trimmed) ||
          /^[A-Z][^.!?]*$/.test(trimmed))
      ) {
        headers.push(trimmed.replace(/^#+\s*/, '').replace(/:$/, ''));
      }
    }

    return headers;
  }
}

export const chunker = new Chunker();
