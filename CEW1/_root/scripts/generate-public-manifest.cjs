/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeReadDir(p) {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

function main() {
  const root = process.cwd();
  const publicDir = path.join(root, 'public');
  if (!isDirectory(publicDir)) {
    console.warn('[manifest] public/ not found; skipping');
    return;
  }

  const folders = {};
  for (const entry of safeReadDir(publicDir)) {
    const abs = path.join(publicDir, entry);
    if (!isDirectory(abs)) continue;

    const files = safeReadDir(abs);
    const geojson = files.filter((f) => String(f).toLowerCase().endsWith('.geojson'));
    if (geojson.length === 0) continue;

    folders[entry] = {
      geojson: geojson.sort((a, b) => a.localeCompare(b)),
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    folders,
  };

  const outPath = path.join(publicDir, 'cew_public_manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[manifest] wrote ${path.relative(root, outPath)} (${Object.keys(folders).length} folders)`);
}

main();
