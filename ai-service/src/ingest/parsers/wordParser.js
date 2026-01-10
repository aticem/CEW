import mammoth from 'mammoth';
import logger from '../../utils/logger.js';

/**
 * Parse Word document (.docx, .doc)
 * Extracts text content with paragraph structure
 */
export async function parseWordDocument(buffer, metadata) {
  try {
    logger.info('Parsing Word document', { docName: metadata.doc_name });

    // Extract raw text from Word document
    const result = await mammoth.extractRawText({ buffer });

    if (!result.value || result.value.trim().length === 0) {
      logger.warn('No text extracted from Word document', { docName: metadata.doc_name });
      return {
        type: 'WORD_DOC',
        status: 'EMPTY',
        text: '',
        paragraphs: [],
        wordCount: 0,
      };
    }

    // Split into paragraphs (separated by double newlines)
    const paragraphs = result.value
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    // Calculate word count
    const wordCount = result.value.split(/\s+/).filter(w => w.length > 0).length;

    logger.info('Word document parsed successfully', {
      docName: metadata.doc_name,
      paragraphs: paragraphs.length,
      wordCount,
    });

    return {
      type: 'WORD_DOC',
      status: 'SUCCESS',
      text: result.value,
      paragraphs,
      wordCount,
      messages: result.messages || [],
    };
  } catch (error) {
    logger.error('Error parsing Word document', {
      docName: metadata.doc_name,
      error: error.message,
      stack: error.stack,
    });

    return {
      type: 'WORD_DOC',
      status: 'ERROR',
      error: error.message,
      text: '',
      paragraphs: [],
      wordCount: 0,
    };
  }
}

/**
 * Detect section headings in Word document
 * Uses heuristics to identify headings
 */
export function detectWordHeadings(paragraphs) {
  const headings = [];

  paragraphs.forEach((paragraph, index) => {
    const trimmed = paragraph.trim();

    // Skip very short or very long lines
    if (trimmed.length < 5 || trimmed.length > 150) {
      return;
    }

    // Heuristic 1: ALL CAPS lines
    if (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
      headings.push({
        paragraphIndex: index,
        text: trimmed,
        type: 'ALL_CAPS',
      });
      return;
    }

    // Heuristic 2: Numbered sections (1.0, 2.3.1, etc.)
    if (/^\d+(\.\d+)*\s+[A-Z]/.test(trimmed)) {
      headings.push({
        paragraphIndex: index,
        text: trimmed,
        type: 'NUMBERED',
      });
      return;
    }

    // Heuristic 3: Keywords (Section, Chapter, Appendix, Part)
    if (/^(Section|Chapter|Appendix|Part|Article)\s+\d+/i.test(trimmed)) {
      headings.push({
        paragraphIndex: index,
        text: trimmed,
        type: 'KEYWORD',
      });
      return;
    }

    // Heuristic 4: Title case at start of line (if short enough)
    if (trimmed.length < 100 && /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(trimmed)) {
      headings.push({
        paragraphIndex: index,
        text: trimmed,
        type: 'TITLE_CASE',
      });
    }
  });

  logger.debug('Detected headings in Word document', { count: headings.length });

  return headings;
}

export default {
  parseWordDocument,
  detectWordHeadings,
};
