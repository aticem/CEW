import fs from "node:fs";
import mammoth from "mammoth";

export async function extractDocxText(filePath) {
  const buffer = fs.readFileSync(filePath);

  const result = await mammoth.extractRawText({ buffer });

  return result.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
