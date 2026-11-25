import Fastify from "fastify";
import { recommend } from "./scoring.js";
import { createMockProviders } from "./providers/mock.js";
import type { Providers } from "./providers/types.js";
import { z } from "zod";
import { DESTINATIONS } from "./data.js";
import { recommendRequestSchema } from "./types.js";

const detailQuery = z.object({
  origin: z.string().default("ICN"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  travelers: z.coerce.number().int().min(1).max(10).default(1),
});

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

  /** 결과 상세: 추천 목록에서 고른 목적지의 항목별 원자료(출처/기준시각 포함). */
  app.get<{ Params: { id: string } }>("/destination/:id", async (req, reply) => {
    const dest = DESTINATIONS.find((d) => d.id === req.params.id);
    if (!dest) return reply.code(404).send({ error: "not_found" });
    const parsed = detailQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const q = parsed.data;
    if (q.endDate <= q.startDate) return reply.code(400).send({ error: "endDate must be after startDate" });
    const [flight, lodgingPrice, lodgingRating, weather, events, holidays, places] = await Promise.all([
      providers.flight.roundTripPerPersonKRW(dest, q),
      providers.lodging.perNightKRW(dest, q),
      providers.lodging.rating(dest),
      providers.weather.forecast(dest, q),
      providers.event.events(dest, q),
      providers.holiday.holidays(q),
      providers.place.places(dest),
    ]);
    const { id, name, country, domestic, tags, lat, lon } = dest;
    return { destination: { id, name, country, domestic, tags, lat, lon }, flight, lodgingPerNight: lodgingPrice, lodgingRating, weather, events, holidays, places };
  });

  return app;
}
