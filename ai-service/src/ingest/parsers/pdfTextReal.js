import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

export async function extractPdfTextWithPages(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);

  // pdf-parse tüm text’i tek string verir
  // Sayfa ayrımı için basit heuristic kullanıyoruz
  const pages = data.text
    .split("\f") // page break
    .map((t, i) => ({
      page: i + 1,
      text: t.trim(),
    }))
    .filter((p) => p.text.length > 0);

  return pages;
}
