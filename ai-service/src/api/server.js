/**
 * Express API Server for CEW AI Service
 */

import express from "express";
import cors from "cors";
import { chunkStore } from "../store/chunkStore.js";
import { routeQuery } from "../query/queryRouter.js";
import { generateAnswer } from "../llm/llmClient.js";
import { runIngest } from "./ingestHandler.js";
import { tryAnswerDocMetaQuestion } from "../query/docMetaHandler.js";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "cew-ai-service",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get store statistics
 */
app.get("/api/stats", (req, res) => {
  const stats = chunkStore.getStats();
  res.json(stats);
});

/**
 * Manual ingest trigger
 * POST /api/ingest
 */
app.post("/api/ingest", async (req, res) => {
  try {
    const result = await runIngest();
    res.json({
      success: true,
      message: "Ingest completed",
      stats: result,
    });
  } catch (error) {
    console.error("Ingest error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Query endpoint - Main AI question answering
 * POST /api/query
 * Body: { question: string, scope?: string }
 */
app.post("/api/query", async (req, res) => {
  const { question, scope } = req.body;

  if (!question || typeof question !== "string") {
    return res.status(400).json({
      success: false,
      error: "Question is required",
    });
  }

  try {
    // Önce metadata sorularını kontrol et (kaç sayfa, bölümler vs.)
    const metaAnswer = await tryAnswerDocMetaQuestion(question);
    if (metaAnswer) {
      return res.json({
        success: true,
        question,
        routeType: "DOC_META",
        answer: metaAnswer.answer,
        sources: metaAnswer.sources,
        guardResult: { passed: true, flags: metaAnswer.flags || ["DOC_META"] },
        blocked: false,
      });
    }

    // Route the question
    const routeResult = routeQuery({
      question,
      scope,
      maxResults: 10,
    });

    // Generate answer using LLM
    const llmResult = await generateAnswer({
      question,
      chunks: routeResult.evidence.docChunks,
      routeType: routeResult.routeType,
    });

    res.json({
      success: true,
      question,
      routeType: routeResult.routeType,
      answer: llmResult.answer,
      sources: llmResult.sources.map((s) => ({
        docName: s.docName,
        page: s.page,
        sheetName: s.sheetName,
        folder: s.folder,
        score: s.score,
      })),
      guardResult: {
        passed: llmResult.guardResult.passed,
        flags: llmResult.guardResult.flags,
      },
      blocked: llmResult.blocked,
    });
  } catch (error) {
    console.error("Query error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Search documents endpoint
 * GET /api/search?q=query&type=PDF_TEXT&folder=Manuals&limit=10
 */
app.get("/api/search", (req, res) => {
  const { q, type, folder, limit = 10 } = req.query;

  if (!q) {
    return res.status(400).json({
      success: false,
      error: "Query parameter 'q' is required",
    });
  }

  const results = chunkStore.search(q, {
    maxResults: parseInt(limit, 10),
    docType: type || null,
    folder: folder || null,
  });

  res.json({
    success: true,
    query: q,
    count: results.length,
    results: results.map((r) => ({
      docName: r.docName,
      docType: r.docType,
      folder: r.folder,
      page: r.page,
      sheetName: r.sheetName,
      score: r.score,
      text: r.text.slice(0, 300) + (r.text.length > 300 ? "..." : ""),
    })),
  });
});

/**
 * List all documents
 * GET /api/documents
 */
app.get("/api/documents", (req, res) => {
  const allChunks = chunkStore.getAllChunks();

  // Group by document
  const docs = new Map();
  for (const chunk of allChunks) {
    if (!docs.has(chunk.docId)) {
      docs.set(chunk.docId, {
        docId: chunk.docId,
        docName: chunk.docName,
        docType: chunk.docType,
        folder: chunk.folder,
        chunkCount: 0,
        flags: new Set(),
      });
    }
    const doc = docs.get(chunk.docId);
    doc.chunkCount++;
    if (chunk.flags) {
      chunk.flags.forEach((f) => doc.flags.add(f));
    }
  }

  const documents = Array.from(docs.values()).map((d) => ({
    ...d,
    flags: Array.from(d.flags),
  }));

  res.json({
    success: true,
    count: documents.length,
    documents,
  });
});

/**
 * Get chunks for a specific document
 * GET /api/documents/:docId/chunks
 */
app.get("/api/documents/:docId/chunks", (req, res) => {
  const { docId } = req.params;
  const chunks = chunkStore.getChunksByDoc(docId);

  res.json({
    success: true,
    docId,
    count: chunks.length,
    chunks: chunks.map((c) => ({
      chunkId: c.chunkId,
      page: c.page,
      sheetName: c.sheetName,
      sectionTitle: c.sectionTitle,
      text: c.text.slice(0, 500) + (c.text.length > 500 ? "..." : ""),
      flags: c.flags,
    })),
  });
});

/**
 * Clear all data (dev/testing only)
 * DELETE /api/data
 */
app.delete("/api/data", (req, res) => {
  chunkStore.clear();
  res.json({
    success: true,
    message: "All data cleared",
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
  });
});

/**
 * Error handler
 */
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

export default app;
