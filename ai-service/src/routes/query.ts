import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { askClaude } from "../llm/claude";
import { getOrCreateCollection } from "../vector/chroma";

const BodySchema = z.object({
  question: z.string().min(3),
  topK: z.number().int().min(1).max(12).optional().default(6),
});

export const queryRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (req, reply) => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: parsed.error.flatten() });
    }

    const { question, topK } = parsed.data;

    // 1) Retrieve from Chroma (docs RAG)
    const collection = await getOrCreateCollection();

    const res = await collection.query({
      queryTexts: [question],
      nResults: topK,
    });

    const docs = res.documents?.[0] ?? [];
    const metas = res.metadatas?.[0] ?? [];

    // Guardrail: retrieval empty => NO LLM call
    if (!docs.length) {
      return {
        ok: true,
        answer: "Information not found in uploaded documents.",
        sources: [],
      };
    }

    // Build source list (Drive links etc.)
    const sources = metas.map((m: any, i: number) => ({
      doc_name: m?.doc_name ?? "unknown",
      drive_link: m?.drive_link ?? null,
      page: m?.page ?? null,
      section: m?.section ?? null,
      chunk_id: m?.chunk_id ?? i,
    }));

    // 2) Ask Claude with strict system prompt
    const system = `
You are CEW AI Assistant for solar farm projects.
Rules:
- Answer ONLY using the provided SOURCES.
- If SOURCES do not contain the answer, reply exactly: "Information not found in uploaded documents."
- Do NOT guess. Do NOT use general knowledge.
- English question => English answer.
- Always include a "Sources:" section with the document names and links you used.
`.trim();

    const user = `
Question:
${question}

SOURCES (verbatim excerpts):
${docs.map((d, i) => `\n[${i + 1}] ${d}`).join("\n")}
`.trim();

    const out = await askClaude({ system, user, maxTokens: 900 });

    return {
      ok: true,
      answer: out.text,
      sources,
      model: out.model,
    };
  });
};
