import { extractPdfTextWithPages } from "./pdfTextReal.js";
import fs from "node:fs";

export async function chunkPdfTextReal(file) {
  // MVP: Local file mapping (mock). If not provided, try default sample.
  const localPath = file.localPath || "samples/C1_Installation_Manual.pdf";

  // If the file isn't available locally yet, don't crash the whole ingest.
  // Return no chunks for this file (other files can still be ingested).
  if (!fs.existsSync(localPath)) {
    return [];
  }

  const pages = await extractPdfTextWithPages(localPath);

  // If the file is present but no text is extractable, mark as OCR required.
  if (!pages.length) {
    return [
      {
        chunkId: `${file.id}::ocr_required`,
        docId: file.id,
        docName: file.name,
        docType: file.classification.docType,
        folder: file.path,
        page: 1,
        text: "No extractable text found (likely scanned PDF / no text layer). OCR required.",
        source: {
          kind: "local-file",
          path: localPath,
        },
        flags: ["OCR_REQUIRED"],
      },
    ];
  }

  const chunks = [];

  for (const p of pages) {
    // Çok uzun sayfaları kır
    const paragraphs = p.text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    for (let i = 0; i < paragraphs.length; i++) {
      const text = paragraphs[i];
      if (text.length < 40) continue; // çok kısa şeyleri at

      chunks.push({
        chunkId: `${file.id}::p${p.page}::para_${i}`,
        docId: file.id,
        docName: file.name,
        docType: file.classification.docType,
        folder: file.path,
        page: p.page,
        text,
        source: {
          kind: "local-file",
          path: localPath,
        },
      });
    }
  }

  return chunks;
}
