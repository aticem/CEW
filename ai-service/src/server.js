/**
 * CEW AI Service - Main Server Entry Point
 */

import app from "./api/server.js";
import { runIngest } from "./api/ingestHandler.js";

const PORT = process.env.PORT || 3001;

async function startServer() {
  console.log("🚀 CEW AI Service Starting...\n");

  // Run initial ingest on startup
  console.log("📚 Running initial document ingest...\n");
  try {
    await runIngest();
  } catch (error) {
    console.error("⚠️ Initial ingest failed:", error.message);
    console.log("   Server will start anyway. Run POST /api/ingest to retry.\n");
  }

  // Start the server
  app.listen(PORT, () => {
    console.log(`\n🌐 Server running on http://localhost:${PORT}`);
    console.log("\nAvailable endpoints:");
    console.log("  GET  /health          - Health check");
    console.log("  GET  /api/stats       - Store statistics");
    console.log("  POST /api/ingest      - Trigger document ingest");
    console.log("  POST /api/query       - Ask a question");
    console.log("  GET  /api/search      - Search documents");
    console.log("  GET  /api/documents   - List all documents");
    console.log("");
  });
}

startServer().catch((err) => {
  console.error("❌ Failed to start server:", err);
  process.exit(1);
});
