import ExcelJS from 'exceljs';
import logger from '../../utils/logger.js';

/**
 * Parse Excel document (.xlsx, .xls)
 * Extracts sheets, headers, and rows
 */
export async function parseExcelDocument(buffer, metadata) {
  try {
    logger.info('Parsing Excel document', { docName: metadata.doc_name });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheets = [];

    workbook.eachSheet((worksheet, sheetId) => {
      logger.debug('Processing sheet', { sheetName: worksheet.name, sheetId });

      const rows = [];
      const headers = {};

      // Extract headers from first row
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        headers[colNumber] = cell.value ? String(cell.value) : `Column_${colNumber}`;
      });

      // Extract data rows
      worksheet.eachRow((row, rowNumber) => {
        // Skip header row
        if (rowNumber === 1) return;

        const rowData = {};
        let hasData = false;

        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const headerName = headers[colNumber] || `Column_${colNumber}`;
          const cellValue = cell.value;

          // Handle different cell types
          if (cellValue !== null && cellValue !== undefined) {
            // Handle dates
            if (cell.type === ExcelJS.ValueType.Date) {
              rowData[headerName] = cellValue.toISOString();
            }
            // Handle formulas
            else if (cell.type === ExcelJS.ValueType.Formula) {
              rowData[headerName] = cell.result || cell.value;
            }
            // Handle regular values
            else {
              rowData[headerName] = String(cellValue);
            }
            hasData = true;
          }
        });

        // Only add rows that have at least one cell with data
        if (hasData) {
          rows.push({
            rowNumber,
            data: rowData,
          });
        }
      });

      sheets.push({
        sheetName: worksheet.name,
        sheetId,
        headers: Object.values(headers),
        rows,
        rowCount: rows.length,
      });
    });

    const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);

    logger.info('Excel document parsed successfully', {
      docName: metadata.doc_name,
      sheets: sheets.length,
      totalRows,
    });

    return {
      type: 'EXCEL_BOM',
      status: 'SUCCESS',
      sheets,
      totalSheets: sheets.length,
      totalRows,
    };
  } catch (error) {
    logger.error('Error parsing Excel document', {
      docName: metadata.doc_name,
      error: error.message,
      stack: error.stack,
    });

    return {
      type: 'EXCEL_BOM',
      status: 'ERROR',
      error: error.message,
      sheets: [],
      totalSheets: 0,
      totalRows: 0,
    };
  }
}

/**
 * Format Excel row as natural language text
 * Converts structured data to readable text for embedding
 */
export function formatRowAsText(rowData, sheetName) {
  const parts = [];

  // Add sheet context
  parts.push(`Sheet: ${sheetName}`);

  // Add each field
  for (const [key, value] of Object.entries(rowData)) {
    if (value && value.toString().trim().length > 0) {
      parts.push(`${key}: ${value}`);
    }
  }

  return parts.join(', ');
}

export default {
  parseExcelDocument,
  formatRowAsText,
};
