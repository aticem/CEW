import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import "dotenv/config";

import { healthRoutes } from "./routes/health.js";
import { queryRoutes } from "./routes/query.js";

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

const port = Number(process.env.PORT || 8787);
await app.listen({ port, host: "0.0.0.0" });

app.log.info(`ai-service listening on :${port}`);
