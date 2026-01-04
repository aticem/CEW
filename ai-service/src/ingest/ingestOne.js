import { chunkPdfTextReal } from "./parsers/pdfTextRealChunker.js";
import { chunkDocxTextReal } from "./parsers/docxTextChunker.js";
import { chunkExcelStub } from "./parsers/excelStub.js";
import { chunkDrawingStub } from "./parsers/drawingStub.js";

export async function ingestOneFile(file) {
  const { docType } = file.classification;

  if (docType === "PDF_TEXT" || docType === "LEGEND") {
    return chunkPdfTextReal(file);
  }
  if (docType === "DOCX_TEXT") {
    return chunkDocxTextReal(file);
  }
  if (docType === "EXCEL_BOM") {
    return chunkExcelStub(file);
  }
  if (docType === "PDF_DRAWING") {
    return chunkDrawingStub(file);
  }

  return [];
}
