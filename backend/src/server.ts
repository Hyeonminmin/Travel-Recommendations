import Fastify from "fastify";
import { recommend } from "./scoring.js";
import { createMockProviders } from "./providers/mock.js";
import type { Providers } from "./providers/types.js";
import { recommendRequestSchema } from "./types.js";

export function buildServer(opts: { providers?: Providers; apiToken?: string } = {}) {
  const app = Fastify({ logger: false });
  const providers = opts.providers ?? createMockProviders();

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    if (opts.apiToken && req.headers.authorization !== `Bearer ${opts.apiToken}`) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/recommend", async (req, reply) => {
    const parsed = recommendRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    if (parsed.data.endDate <= parsed.data.startDate) return reply.code(400).send({ error: "endDate must be after startDate" });
    return recommend(parsed.data, providers);
  });

  return app;
}
