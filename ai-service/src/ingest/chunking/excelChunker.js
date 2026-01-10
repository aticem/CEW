import logger from '../../utils/logger.js';
import { formatRowAsText } from '../parsers/excelParser.js';

/**
 * Chunk Excel document
 * Each row becomes a separate chunk (for BOM/BOQ documents)
 */
export function chunkExcel(sheets) {
  const chunks = [];
  let globalChunkIndex = 0;

  for (const sheet of sheets) {
    logger.debug('Chunking Excel sheet', {
      sheetName: sheet.sheetName,
      rows: sheet.rows.length,
    });

    for (const row of sheet.rows) {
      // Format row as natural language text
      const text = formatRowAsText(row.data, sheet.sheetName);

      // Skip empty rows
      if (text.trim().length === 0) {
        continue;
      }

      chunks.push({
        text,
        sheetName: sheet.sheetName,
        sheetId: sheet.sheetId,
        rowNumber: row.rowNumber,
        rawData: row.data,
        chunkIndex: globalChunkIndex++,
        tokenCount: text.split(/\s+/).length,
      });
    }
  }

  logger.info('Excel document chunked', {
    sheets: sheets.length,
    chunks: chunks.length,
  });

  return chunks;
}

/**
 * Chunk Excel by sheet (alternative strategy)
 * Combines multiple rows into larger chunks
 */
export function chunkExcelBySheet(sheets, maxRowsPerChunk = 10) {
  const chunks = [];
  let globalChunkIndex = 0;

  for (const sheet of sheets) {
    logger.debug('Chunking Excel sheet by groups', {
      sheetName: sheet.sheetName,
      rows: sheet.rows.length,
      maxRowsPerChunk,
    });

    // Group rows into chunks
    for (let i = 0; i < sheet.rows.length; i += maxRowsPerChunk) {
      const rowGroup = sheet.rows.slice(i, i + maxRowsPerChunk);

      // Combine rows into single text
      const texts = rowGroup.map(row => formatRowAsText(row.data, sheet.sheetName));
      const combinedText = texts.join('\n');

      chunks.push({
        text: combinedText,
        sheetName: sheet.sheetName,
        sheetId: sheet.sheetId,
        startRow: rowGroup[0].rowNumber,
        endRow: rowGroup[rowGroup.length - 1].rowNumber,
        rowCount: rowGroup.length,
        chunkIndex: globalChunkIndex++,
        tokenCount: combinedText.split(/\s+/).length,
      });
    }
  }

  logger.info('Excel document chunked by sheet', {
    sheets: sheets.length,
    chunks: chunks.length,
  });

  return chunks;
}

export default {
  chunkExcel,
  chunkExcelBySheet,
};
