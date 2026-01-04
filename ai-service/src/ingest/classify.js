function ext(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function classifyFile(file) {
  const e = ext(file.name);
  const flags = [];

  // Folder hints
  const p = (file.path || "").toLowerCase();
  const isDrawingsFolder = p.includes("/drawings");
  const isLegendsFolder = p.includes("/legends");
  const isManualsFolder = p.includes("/manuals");
  const isSpecsFolder = p.includes("/spec");
  const isQAQCFolder = p.includes("/qaqc");
  const isBOMFolder = p.includes("/bom") || p.includes("/boq");

  let docType = "UNSUPPORTED";

  if (e === "pdf") {
    // MVP heuristic:
    // - Drawings klasörü → PDF_DRAWING
    // - Legends klasörü → LEGEND
    // - Diğerleri → PDF_TEXT varsay (sonra gerçek text-check yapacağız)
    if (isDrawingsFolder) docType = "PDF_DRAWING";
    else if (isLegendsFolder) docType = "LEGEND";
    else docType = "PDF_TEXT";

    // MVP: scanned detection yok (ileride eklenecek)
  } else if (e === "xlsx" || e === "xls") {
    docType = "EXCEL_BOM";
    if (!isBOMFolder) flags.push("EXCEL_OUTSIDE_BOM_FOLDER");
  } else if (e === "docx") {
    docType = "DOCX_TEXT";
  }

  // discipline hint (optional)
  let discipline = "unknown";
  if (isQAQCFolder) discipline = "qaqc";
  else if (isManualsFolder) discipline = "manual";
  else if (isSpecsFolder) discipline = "spec";
  else if (isDrawingsFolder) discipline = "drawing";
  else if (isBOMFolder) discipline = "bom";

  // MVP rule: Drawings are limited support
  if (docType === "PDF_DRAWING") flags.push("LIMITED_SUPPORT_NO_OCR");

  return { docType, discipline, flags };
}
