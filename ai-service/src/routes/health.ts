import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => {
    return { ok: true, service: "ai-service", ts: new Date().toISOString() };
  });
};
