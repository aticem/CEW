import logger from '../../utils/logger.js';
import config from '../../config/env.js';

/**
 * Chunk text into semantic segments with overlap
 * Uses token-based chunking with configurable size and overlap
 */
export function chunkText(text, options = {}) {
  const {
    chunkSize = config.chunking.chunkSize,
    chunkOverlap = config.chunking.chunkOverlap,
    minChunkSize = config.chunking.minChunkSize,
  } = options;

  // Simple word-based tokenization (approximation)
  const words = text.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0) {
    return [];
  }

  const chunks = [];
  let currentIndex = 0;

  while (currentIndex < words.length) {
    const chunkWords = words.slice(currentIndex, currentIndex + chunkSize);
    const chunkText = chunkWords.join(' ');

    // Only add chunk if it meets minimum size
    if (chunkWords.length >= minChunkSize || currentIndex + chunkWords.length >= words.length) {
      chunks.push({
        text: chunkText,
        tokenCount: chunkWords.length,
        startIndex: currentIndex,
        endIndex: currentIndex + chunkWords.length,
      });
    }

    // Move to next chunk with overlap
    currentIndex += chunkSize - chunkOverlap;

    // Ensure we make progress
    if (currentIndex <= currentIndex - chunkSize + chunkOverlap) {
      currentIndex++;
    }
  }

  logger.debug('Text chunked', {
    totalWords: words.length,
    chunks: chunks.length,
    chunkSize,
    chunkOverlap,
  });

  return chunks;
}

/**
 * Chunk PDF text with page and section information
 */
export function chunkPDFText(pages, headings = [], options = {}) {
  const chunks = [];
  let currentSection = 'Introduction';
  let globalChunkIndex = 0;

  for (const page of pages) {
    if (!page.text || page.text.trim().length === 0) {
      continue;
    }

    // Update current section if heading found on this page
    const pageHeading = headings.find(h => {
      // Match by line number or page number
      return h.pageNumber === page.pageNumber;
    });

    if (pageHeading) {
      currentSection = pageHeading.text;
    }

    // Chunk the page text
    const pageChunks = chunkText(page.text, options);

    // Add page and section metadata to each chunk
    for (const chunk of pageChunks) {
      chunks.push({
        ...chunk,
        pageNumber: page.pageNumber,
        section: currentSection,
        chunkIndex: globalChunkIndex++,
      });
    }
  }

  logger.info('PDF text chunked', {
    pages: pages.length,
    chunks: chunks.length,
  });

  return chunks;
}

/**
 * Chunk Word document with paragraph structure
 */
export function chunkWordText(paragraphs, headings = [], options = {}) {
  const chunks = [];
  let currentSection = 'Introduction';
  let globalChunkIndex = 0;

  // Combine paragraphs into continuous text, tracking sections
  const fullText = paragraphs.join('\n\n');

  // Update sections based on headings
  const textChunks = chunkText(fullText, options);

  for (const chunk of textChunks) {
    // Try to determine section based on chunk content
    for (const heading of headings) {
      if (chunk.text.includes(heading.text)) {
        currentSection = heading.text;
        break;
      }
    }

    chunks.push({
      ...chunk,
      section: currentSection,
      chunkIndex: globalChunkIndex++,
    });
  }

  logger.info('Word document chunked', {
    paragraphs: paragraphs.length,
    chunks: chunks.length,
  });

  return chunks;
}

/**
 * Chunk by semantic boundaries (paragraphs, sentences)
 * More advanced chunking strategy
 */
export function chunkBySemantic(text, options = {}) {
  const {
    chunkSize = config.chunking.chunkSize,
    chunkOverlap = config.chunking.chunkOverlap,
  } = options;

  // Split by paragraphs first
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

  const chunks = [];
  let currentChunk = [];
  let currentTokenCount = 0;

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(w => w.length > 0);
    const paragraphTokenCount = words.length;

    // If adding this paragraph exceeds chunk size, save current chunk
    if (currentTokenCount + paragraphTokenCount > chunkSize && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.join('\n\n'),
        tokenCount: currentTokenCount,
      });

      // Add overlap: keep last paragraph
      if (currentChunk.length > 0) {
        const overlapText = currentChunk[currentChunk.length - 1];
        const overlapWords = overlapText.split(/\s+/).filter(w => w.length > 0);
        currentChunk = overlapWords.length <= chunkOverlap ? [overlapText] : [];
        currentTokenCount = overlapWords.length <= chunkOverlap ? overlapWords.length : 0;
      } else {
        currentChunk = [];
        currentTokenCount = 0;
      }
    }

    // Add paragraph to current chunk
    currentChunk.push(paragraph);
    currentTokenCount += paragraphTokenCount;
  }

  // Add remaining chunk
  if (currentChunk.length > 0) {
    chunks.push({
      text: currentChunk.join('\n\n'),
      tokenCount: currentTokenCount,
    });
  }

  logger.debug('Semantic chunking complete', {
    paragraphs: paragraphs.length,
    chunks: chunks.length,
  });

  return chunks;
}

export default {
  chunkText,
  chunkPDFText,
  chunkWordText,
  chunkBySemantic,
};
