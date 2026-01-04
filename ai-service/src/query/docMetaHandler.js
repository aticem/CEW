/**
 * Document Metadata Query Handler
 * "Kaç sayfa?", "Hangi bölümler var?", "X. sayfada ne var?" sorularını yakalar
 */

import { chunkStore } from "../store/chunkStore.js";

export async function tryAnswerDocMetaQuestion(question) {
  const q = normalize(question);

  const handlers = [
    { pattern: /(?:kaç|kac)\s*sayfa|how\s*many\s*pages|page\s*count/i, handler: handlePageCount },
    { pattern: /(?:kaç|kac)\s*(?:bölüm|bolum|section)|how\s*many\s*sections/i, handler: handleSectionCount },
    { pattern: /(?:b[öo]l[üu]m)(?:ler|leri)?\s*(?:neler|ne|listele|list)|icindekiler|içindekiler|table\s*of\s*contents/i, handler: handleListSections },
    { pattern: /(\d+)\.*\s*sayfa(?:da|s[ıi]nda|daki)?|page\s*(\d+)/i, handler: handleSpecificPage },
    { pattern: /özet|ozet|summary|genel\s*bilgi|overview/i, handler: handleDocSummary },
    { pattern: /tablo(?:lar)?|tables?/i, handler: handleTableInfo },
  ];

  for (const { pattern, handler } of handlers) {
    if (pattern.test(q)) {
      const result = await handler(q, question);
      if (result) return result;
    }
  }

  return null;
}

async function handlePageCount(q) {
  const doc = findTargetDoc(q);
  if (!doc) return null;

  const summary = getSummaryChunk(doc.docId);
  if (!summary?.metadata?.estimatedPages) {
    return {
      answer: `${doc.docName} için sayfa bilgisi bulunamadı.`,
      sources: [{ docName: doc.docName, folder: doc.folder, score: 0 }],
      flags: ["DOC_META"],
    };
  }

  return {
    answer: `📄 ${doc.docName}\n\n• Tahmini sayfa: ${summary.metadata.estimatedPages}\n• Kelime sayısı: ${summary.metadata.wordCount || "?"}\n• Karakter: ${summary.metadata.charCount || "?"}`,
    sources: [{ docName: doc.docName, folder: doc.folder, score: 0 }],
    flags: ["DOC_META"],
  };
}

async function handleSectionCount(q) {
  const doc = findTargetDoc(q);
  if (!doc) return null;

  const summary = getSummaryChunk(doc.docId);
  return {
    answer: `${doc.docName} toplam ${summary?.metadata?.sectionCount || "?"} bölüm içeriyor.`,
    sources: [{ docName: doc.docName, folder: doc.folder, score: 0 }],
    flags: ["DOC_META"],
  };
}

async function handleListSections(q) {
  const doc = findTargetDoc(q);
  if (!doc) return null;

  const tocChunk = getTocChunk(doc.docId);
  if (tocChunk) {
    return {
      answer: tocChunk.text,
      sources: [{ docName: doc.docName, folder: doc.folder, score: 0 }],
      flags: ["DOC_META", "TOC"],
    };
  }

  const sections = getUniqueSections(doc.docId);
  if (sections.length > 0) {
    return {
      answer: `${doc.docName} bölümleri:\n${sections.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
      sources: [{ docName: doc.docName, folder: doc.folder, score: 0 }],
      flags: ["DOC_META"],
    };
  }
  return null;
}

async function handleSpecificPage(q) {
  const doc = findTargetDoc(q);
  if (!doc) return null;

  const pageMatch = q.match(/(\d+)\.*\s*sayfa|page\s*(\d+)/i);
  const pageNum = parseInt(pageMatch?.[1] || pageMatch?.[2]);
  if (!pageNum || pageNum < 1) return null;

  const chunks = getChunksForPage(doc.docId, pageNum);

  if (chunks.length === 0) {
    const summary = getSummaryChunk(doc.docId);
    return {
      answer: `${doc.docName}'de ${pageNum}. sayfa için içerik bulunamadı (tahmini ${summary?.metadata?.estimatedPages || "?"} sayfa var).`,
      sources: [{ docName: doc.docName, folder: doc.folder, score: 0 }],
      flags: ["DOC_META"],
    };
  }

  const sections = [...new Set(chunks.map((c) => c.section).filter(Boolean))];
  const preview = chunks
    .slice(0, 3)
    .map((c) => `• ${c.text.slice(0, 150)}...`)
    .join("\n\n");

  return {
    answer: `📄 ${doc.docName} - Sayfa ${pageNum}\n\n📑 Bölüm: ${sections.join(", ") || "Belirtilmemiş"}\n\n${preview}`,
    sources: chunks.slice(0, 3).map((c) => ({
      docName: c.docName,
      folder: c.folder,
      page: c.page,
      section: c.section,
      score: 0,
    })),
    flags: ["DOC_META", "PAGE_SPECIFIC"],
  };
}

async function handleDocSummary(q) {
  const doc = findTargetDoc(q);
  if (!doc) return null;

  const summary = getSummaryChunk(doc.docId);
  if (!summary) return null;

  const toc = getTocChunk(doc.docId);
  const tocPreview = toc
    ? `\n\n📑 Bölümler:\n${toc.text.split("\n").slice(1, 6).join("\n")}${toc.text.split("\n").length > 6 ? "\n..." : ""}`
    : "";

  return {
    answer: `📄 ${doc.docName}\n\n${summary.text}${tocPreview}`,
    sources: [{ docName: doc.docName, folder: doc.folder, score: 0 }],
    flags: ["DOC_META", "SUMMARY"],
  };
}

async function handleTableInfo(q) {
  const doc = findTargetDoc(q);
  if (!doc) return null;

  const tableChunks = chunkStore
    .getAllChunks()
    .filter((c) => c.docId === doc.docId && c.flags?.includes("TABLE"));

  if (tableChunks.length === 0) {
    return {
      answer: `${doc.docName}'de tablo bulunamadı.`,
      sources: [{ docName: doc.docName, folder: doc.folder, score: 0 }],
      flags: ["DOC_META"],
    };
  }

  const tableList = tableChunks
    .map(
      (t, i) =>
        `${i + 1}. Sayfa ~${t.page}, Bölüm: ${t.section || "?"}\n   ${t.text.split("\n")[1]?.slice(0, 80) || ""}...`
    )
    .join("\n\n");

  return {
    answer: `📊 ${doc.docName} - ${tableChunks.length} Tablo\n\n${tableList}`,
    sources: tableChunks.slice(0, 3).map((c) => ({
      docName: c.docName,
      folder: c.folder,
      page: c.page,
      score: 0,
    })),
    flags: ["DOC_META", "TABLE_INFO"],
  };
}

// ========== HELPERS ==========

function normalize(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findTargetDoc(q) {
  const allChunks = chunkStore.getAllChunks();
  const docs = new Map();
  for (const c of allChunks) {
    if (!docs.has(c.docId)) {
      docs.set(c.docId, { docId: c.docId, docName: c.docName, folder: c.folder });
    }
  }
  const docList = Array.from(docs.values());

  for (const d of docList) {
    const name = normalize(d.docName.replace(/\.(docx|pdf|xlsx)$/i, ""));
    if (name && q.includes(name)) return d;
  }

  if (q.includes("technical") || q.includes("description")) {
    const td = docList.find((d) => normalize(d.docName).includes("technical"));
    if (td) return td;
  }

  if (docList.length === 1) return docList[0];
  return null;
}

function getSummaryChunk(docId) {
  return chunkStore
    .getAllChunks()
    .find((c) => c.docId === docId && c.flags?.includes("DOC_SUMMARY"));
}

function getTocChunk(docId) {
  return chunkStore
    .getAllChunks()
    .find((c) => c.docId === docId && c.flags?.includes("TOC"));
}

function getUniqueSections(docId) {
  const chunks = chunkStore
    .getAllChunks()
    .filter((c) => c.docId === docId && c.section && !c.section.startsWith("__"));
  return [...new Set(chunks.map((c) => c.section).filter(Boolean))];
}

function getChunksForPage(docId, pageNum) {
  return chunkStore
    .getAllChunks()
    .filter(
      (c) =>
        c.docId === docId &&
        c.page === pageNum &&
        !c.flags?.includes("DOC_SUMMARY") &&
        !c.flags?.includes("TOC")
    );
}

export default { tryAnswerDocMetaQuestion };
