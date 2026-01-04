import { listMockDriveFiles } from "./ingest/mockDrive.js";
import { classifyFile } from "./ingest/classify.js";
import { ingestOneFile } from "./ingest/ingestOne.js";
import { keywordSearch } from "./query/keywordSearch.js";

async function main() {
  console.log("CEW AI Service — Mock Ingest (MVP skeleton)\n");

  const files = listMockDriveFiles();

  // 1) classify
  const classified = files.map((f) => ({
    ...f,
    classification: classifyFile(f),
  }));

  console.log("1) Classified files:");
  for (const f of classified) {
    console.log(
      `- ${f.name} → ${f.classification.docType}${
        f.classification.flags.length
          ? " (" + f.classification.flags.join(", ") + ")"
          : ""
      }`
    );
  }

  // 2) ingest (stub chunk generation)
  console.log("\n2) Ingest output (stub chunks):");
  const allChunks = [];
  for (const f of classified) {
    const chunks = await ingestOneFile(f);
    allChunks.push(...chunks);
  }

  console.log(`\n✅ Total chunks produced: ${allChunks.length}`);
  console.log("Sample chunk:");

  console.log(
    JSON.stringify(
      allChunks.find((c) => c.docType === "DOCX_TEXT"),
      null,
      2
    )
  );

  // 🔍 QUERY TEST
  const question = "design of structures";
  const results = keywordSearch(allChunks, question);

  console.log("\n3) Query results:");
  if (results.length === 0) {
    console.log("No matching chunks found.");
  }

  for (const r of results) {
    console.log(`- score=${r.score} | ${r.docName}`);
    console.log(`  \"${r.text.slice(0, 120)}...\"`);
  }
}

main().catch((err) => {
  console.error("❌ Ingest failed:", err);
  process.exit(1);
});
