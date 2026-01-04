/**
 * Enhanced DOCX Chunker - Section + Page aware
 */

import fs from "node:fs";
import { extractDocxStructured, extractDocxMetadata } from "./docxAdvanced.js";

export async function chunkDocxTextReal(file) {
  const localPath = file.localPath || "sample/Technical Description_Rev01.docx";

  if (!fs.existsSync(localPath)) {
    return [];
  }

  const structured = await extractDocxStructured(localPath);
  if (!structured) return [];

  const metadata = await extractDocxMetadata(localPath);
  const { structure, stats } = structured;

  const chunks = [];
  let chunkIndex = 0;
  const charsPerPage = 3000;
  let runningCharCount = 0;

  // 1) Doküman özet chunk'ı
  chunks.push({
    chunkId: `${file.id}::docx::summary`,
    docId: file.id,
    docName: file.name,
    docType: "DOCX_TEXT",
    folder: file.path,
    page: 0,
    section: "__DOCUMENT_SUMMARY__",
    sectionLevel: 0,
    text: `Doküman: ${file.name}. Tahmini ${stats.estimatedPages} sayfa, ${stats.sectionCount} bölüm, ${stats.paragraphCount} paragraf, ${stats.tableCount} tablo içeriyor.`,
    source: { kind: "local-file", path: localPath },
    metadata: { ...stats, ...metadata },
    flags: ["DOC_SUMMARY"],
  });

  // 2) İçindekiler chunk'ı
  if (structure.sections.length > 0) {
    const tocText = structure.sections
      .map((s) => `${"  ".repeat(s.level - 1)}${s.level}. ${s.title}`)
      .join("\n");

    chunks.push({
      chunkId: `${file.id}::docx::toc`,
      docId: file.id,
      docName: file.name,
      docType: "DOCX_TEXT",
      folder: file.path,
      page: 0,
      section: "__TABLE_OF_CONTENTS__",
      sectionLevel: 0,
      text: `İçindekiler:\n${tocText}`,
      source: { kind: "local-file", path: localPath },
      flags: ["TOC"],
    });
  }

  // 3) Paragrafları section-aware chunk'la
  for (const para of structure.paragraphs) {
    if (para.text.length < 40) continue;

    const estimatedPage = Math.floor(runningCharCount / charsPerPage) + 1;
    runningCharCount += para.text.length;

    chunks.push({
      chunkId: `${file.id}::docx::p${chunkIndex++}`,
      docId: file.id,
      docName: file.name,
      docType: "DOCX_TEXT",
      folder: file.path,
      page: estimatedPage,
      section: para.sectionTitle || "Giriş",
      sectionLevel: para.sectionLevel || 1,
      text: para.text,
      source: { kind: "local-file", path: localPath },
    });
  }

  // 4) Tabloları chunk'la
  for (const table of structure.tables) {
    const tableText = table.rows.map((row) => row.join(" | ")).join("\n");
    if (tableText.length < 20) continue;

    const estimatedPage = Math.floor(runningCharCount / charsPerPage) + 1;
    runningCharCount += tableText.length;

    chunks.push({
      chunkId: `${file.id}::docx::table_${table.index}`,
      docId: file.id,
      docName: file.name,
      docType: "DOCX_TEXT",
      folder: file.path,
      page: estimatedPage,
      section: table.sectionTitle || "Tablolar",
      sectionLevel: 2,
      text: `[TABLO ${table.index + 1}]\n${tableText}`,
      source: { kind: "local-file", path: localPath },
      flags: ["TABLE"],
    });
  }

  return chunks;
}
