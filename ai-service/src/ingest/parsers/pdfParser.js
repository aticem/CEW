import pdfParse from 'pdf-parse';
import logger from '../../utils/logger.js';

/**
 * Parse PDF document
 * Extracts text content and classifies document type
 */
export async function parsePDFDocument(buffer, metadata) {
  try {
    logger.info('Parsing PDF document', { docName: metadata.doc_name });

    // Extract text from PDF
    const data = await pdfParse(buffer);

    // Check if text is extractable
    const hasText = data.text.trim().length > 50;

    if (!hasText) {
      logger.warn('PDF appears to be scanned (no text)', { docName: metadata.doc_name });
      return {
        type: 'SCANNED_PDF',
        status: 'OCR_REQUIRED',
        text: '',
        pages: [],
        totalPages: data.numpages,
        message: 'This PDF requires OCR processing (not supported in MVP)',
      };
    }

    // Split text into pages (rough estimation)
    // Note: pdf-parse doesn't provide per-page text natively
    // We'll work with the full text and add page markers
    const pages = estimatePages(data.text, data.numpages);

    // Classify PDF type
    const pdfType = classifyPDF(pages);

    logger.info('PDF document parsed successfully', {
      docName: metadata.doc_name,
      type: pdfType,
      totalPages: data.numpages,
      textLength: data.text.length,
    });

    return {
      type: pdfType,
      status: 'SUCCESS',
      text: data.text,
      pages,
      totalPages: data.numpages,
      info: data.info,
      metadata: data.metadata,
    };
  } catch (error) {
    logger.error('Error parsing PDF document', {
      docName: metadata.doc_name,
      error: error.message,
      stack: error.stack,
    });

    return {
      type: 'PDF_UNKNOWN',
      status: 'ERROR',
      error: error.message,
      text: '',
      pages: [],
      totalPages: 0,
    };
  }
}

/**
 * Estimate page divisions in PDF text
 * Since pdf-parse doesn't provide per-page text, we estimate
 */
function estimatePages(text, numPages) {
  const pages = [];
  const lines = text.split('\n');
  const linesPerPage = Math.ceil(lines.length / numPages);

  for (let i = 0; i < numPages; i++) {
    const startLine = i * linesPerPage;
    const endLine = Math.min((i + 1) * linesPerPage, lines.length);
    const pageText = lines.slice(startLine, endLine).join('\n');

    pages.push({
      pageNumber: i + 1,
      text: pageText,
      hasText: pageText.trim().length > 0,
    });
  }

  return pages;
}

/**
 * Classify PDF document type
 * Based on text density and patterns
 */
function classifyPDF(pages) {
  const totalPages = pages.length;
  const textPages = pages.filter(p => p.text.length > 200).length;
  const textRatio = textPages / totalPages;

  // PDF_TEXT: >80% of pages have substantial text
  if (textRatio > 0.8) {
    return 'PDF_TEXT';
  }

  // PDF_DRAWING: 20-80% of pages have text (legends, titles, notes)
  if (textRatio > 0.2) {
    return 'PDF_DRAWING';
  }

  // SCANNED_PDF: <20% of pages have text
  return 'SCANNED_PDF';
}

/**
 * Detect section headings in PDF text
 * Uses heuristics to identify headings
 */
export function detectPDFHeadings(text) {
  const headings = [];
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // Skip very short or very long lines
    if (trimmed.length < 5 || trimmed.length > 150) {
      return;
    }

    // Heuristic 1: ALL CAPS lines
    if (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
      headings.push({
        lineNumber: index,
        text: trimmed,
        type: 'ALL_CAPS',
      });
      return;
    }

    // Heuristic 2: Numbered sections (1.0, 2.3.1, etc.)
    if (/^\d+(\.\d+)*\s+[A-Z]/.test(trimmed)) {
      headings.push({
        lineNumber: index,
        text: trimmed,
        type: 'NUMBERED',
      });
      return;
    }

    // Heuristic 3: Keywords (Section, Chapter, Appendix, Part)
    if (/^(Section|Chapter|Appendix|Part|Article)\s+\d+/i.test(trimmed)) {
      headings.push({
        lineNumber: index,
        text: trimmed,
        type: 'KEYWORD',
      });
    }
  });

  logger.debug('Detected headings in PDF', { count: headings.length });

  return headings;
}

export default {
  parsePDFDocument,
  detectPDFHeadings,
};
