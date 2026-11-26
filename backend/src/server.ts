import Fastify from "fastify";
import { DESTINATIONS } from "./data.js";
import { evaluateDestination, recommend } from "./scoring.js";
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

  /**
   * 목적지 상세. /recommend 와 같은 요청 본문을 받아 점수·가중치가 목록과 일치한다(scope 는 무시).
   * 예산을 넘는 목적지도 상세는 보여주고 withinBudget=false 로 표시한다.
   */
  app.post<{ Params: { id: string } }>("/destination/:id", async (req, reply) => {
    const dest = DESTINATIONS.find((d) => d.id === req.params.id);
    if (!dest) return reply.code(404).send({ error: "destination_not_found" });
    const parsed = recommendRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const r = parsed.data;
    if (r.endDate <= r.startDate) return reply.code(400).send({ error: "endDate must be after startDate" });

    const holidays = await providers.holiday.holidays({ origin: r.origin, startDate: r.startDate, endDate: r.endDate, travelers: r.travelers });
    const ev = await evaluateDestination(dest, r, providers, holidays);
    const meta = (s: { source: string; asOf: string; estimated: boolean }) => ({ source: s.source, asOf: s.asOf, estimated: s.estimated });
    return {
      destination: { id: dest.id, name: dest.name, country: dest.country, domestic: dest.domestic, tags: dest.tags, lat: dest.lat, lon: dest.lon },
      trip: { origin: r.origin, startDate: r.startDate, endDate: r.endDate, nights: ev.nights, rooms: ev.rooms, travelers: r.travelers, budgetKRW: r.budgetKRW },
      withinBudget: ev.withinBudget,
      recommendation: ev.recommendation,
      cost: ev.cost,
      weather: ev.sources.weather.value,
      events: ev.sources.event.value,
      holidays: ev.holidays,
      places: ev.recommendation.places,
      sources: {
        flight: meta(ev.sources.flight),
        lodging: meta(ev.sources.lodging),
        lodgingRating: meta(ev.sources.lodgingRating),
        weather: meta(ev.sources.weather),
        event: meta(ev.sources.event),
        holiday: meta(ev.sources.holiday),
        poi: meta(ev.sources.poi),
      },
      links: ev.recommendation.links,
    };
  });

  return app;
}
