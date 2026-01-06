import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import "dotenv/config";

import { healthRoutes } from "./routes/health";
import { queryRoutes } from "./routes/query";
import { ingestRoutes } from "./routes/ingest";

async function start() {
  const app = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV === "development"
          ? { target: "pino-pretty" }
          : undefined,
    },
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(queryRoutes, { prefix: "/query" });
  await app.register(ingestRoutes, { prefix: "/ingest" });

  const port = Number(process.env.PORT || 8787);
  await app.listen({ port, host: "0.0.0.0" });

  app.log.info(`ai-service listening on :${port}`);
}

start().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
