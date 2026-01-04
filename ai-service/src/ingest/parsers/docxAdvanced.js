/**
 * Advanced DOCX Parser - Heading, Section, Page, Table aware
 * "Vay be" dedirtecek altyapı
 */

import fs from "node:fs";
import mammoth from "mammoth";

export async function extractDocxStructured(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const buffer = fs.readFileSync(filePath);
  const htmlResult = await mammoth.convertToHtml({ buffer });
  const html = htmlResult.value;
  const textResult = await mammoth.extractRawText({ buffer });
  const rawText = textResult.value;
  const structure = parseHtmlStructure(html);
  const estimatedPages = Math.ceil(rawText.length / 3000);

  return {
    html,
    rawText,
    structure,
    stats: {
      totalChars: rawText.length,
      estimatedPages,
      sectionCount: structure.sections.length,
      paragraphCount: structure.paragraphs.length,
      tableCount: structure.tables.length,
    },
  };
}

function parseHtmlStructure(html) {
  const sections = [];
  const paragraphs = [];
  const tables = [];

  const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
  let match;
  let sectionIndex = 0;

  while ((match = headingRegex.exec(html)) !== null) {
    sections.push({
      index: sectionIndex++,
      level: parseInt(match[1]),
      title: stripHtml(match[2]),
      position: match.index,
    });
  }

  const paraRegex = /<p[^>]*>(.*?)<\/p>/gi;
  let paraIndex = 0;

  while ((match = paraRegex.exec(html)) !== null) {
    const text = stripHtml(match[1]).trim();
    if (text.length > 20) {
      let belongsToSection = null;
      for (let i = sections.length - 1; i >= 0; i--) {
        if (sections[i].position < match.index) {
          belongsToSection = sections[i];
          break;
        }
      }
      paragraphs.push({
        index: paraIndex++,
        text,
        sectionTitle: belongsToSection?.title || null,
        sectionLevel: belongsToSection?.level || null,
        position: match.index,
      });
    }
  }

  const tableRegex = /<table[^>]*>(.*?)<\/table>/gis;
  let tableIndex = 0;

  while ((match = tableRegex.exec(html)) !== null) {
    const rows = extractTableRows(match[1]);
    if (rows.length > 0) {
      let belongsToSection = null;
      for (let i = sections.length - 1; i >= 0; i--) {
        if (sections[i].position < match.index) {
          belongsToSection = sections[i];
          break;
        }
      }
      tables.push({
        index: tableIndex++,
        rows,
        rowCount: rows.length,
        sectionTitle: belongsToSection?.title || null,
        position: match.index,
      });
    }
  }

  return { sections, paragraphs, tables };
}

function extractTableRows(tableHtml) {
  const rows = [];
  const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
  let match;

  while ((match = rowRegex.exec(tableHtml)) !== null) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>(.*?)<\/t[dh]>/gis;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      cells.push(stripHtml(cellMatch[1]).trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function extractDocxMetadata(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const buffer = fs.readFileSync(filePath);
    const textResult = await mammoth.extractRawText({ buffer });
    const rawText = textResult.value;
    return {
      charCount: rawText.length,
      wordCount: rawText.split(/\s+/).filter(Boolean).length,
      lineCount: rawText.split("\n").filter(Boolean).length,
      estimatedPages: Math.ceil(rawText.length / 3000),
    };
  } catch (e) {
    return null;
  }
}
