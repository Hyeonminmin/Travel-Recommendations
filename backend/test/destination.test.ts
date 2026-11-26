import { describe, expect, it } from "vitest";
import { createMockProviders } from "../src/providers/mock.js";
import { recommend } from "../src/scoring.js";
import { buildServer } from "../src/server.js";
import { recommendRequestSchema } from "../src/types.js";

const body = { startDate: "2026-12-20", endDate: "2026-12-24", budgetKRW: 3_000_000, travelers: 2, tags: ["미식"] };
const post = (app: ReturnType<typeof buildServer>, id: string, payload: object = body, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: `/destination/${id}`, payload, headers });

describe("POST /destination/:id", () => {
  it("상세: 비용 내역·날씨·행사·출처를 담고 합계가 일치한다", async () => {
    const r = await post(buildServer(), "busan");
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.destination).toMatchObject({ id: "busan", name: "부산", domestic: true });
    expect(j.trip).toMatchObject({ nights: 4, rooms: 1, travelers: 2 });
    const c = j.cost;
    expect(c.flightTotalKRW + c.lodgingTotalKRW + c.localSpendKRW).toBe(c.totalKRW);
    expect(c.flightTotalKRW).toBe(c.flightPerPersonKRW * 2);
    expect(j.weather).toHaveProperty("avgTempC");
    expect(j.sources.flight).toMatchObject({ source: expect.any(String), estimated: expect.any(Boolean) });
    expect(Object.keys(j.sources).sort()).toEqual(["event", "flight", "holiday", "lodging", "lodgingRating", "poi", "weather"]);
    expect(j.links.length).toBeGreaterThan(0);
  });
  it("/recommend 목록의 점수·총비용과 동일하다", async () => {
    const list = (await recommend(recommendRequestSchema.parse(body), createMockProviders())).results;
    const j = (await post(buildServer(), "busan")).json();
    const item = list.find((x) => x.destinationId === "busan")!;
    expect(j.recommendation.totalScore).toBe(item.totalScore);
    expect(j.recommendation.estimatedTotalKRW).toBe(item.estimatedTotalKRW);
  });
  it("예산 초과 목적지도 상세는 반환하되 withinBudget=false", async () => {
    const j = (await post(buildServer(), "bangkok", { ...body, budgetKRW: 500_000 })).json();
    expect(j.withinBudget).toBe(false);
    expect(j.cost.totalKRW).toBeGreaterThan(500_000);
  });
  it("해외는 공휴일 미적용(holidays 빈 배열)", async () => {
    const j = (await post(buildServer(), "tokyo", { ...body, startDate: "2026-12-24", endDate: "2026-12-27" })).json();
    expect(j.holidays).toEqual([]);
  });
  it("없는 id 는 404, 잘못된 본문은 400, 토큰 없으면 401", async () => {
    expect((await post(buildServer(), "atlantis")).statusCode).toBe(404);
    expect((await post(buildServer(), "busan", { startDate: "2026-12-24", endDate: "2026-12-20", budgetKRW: 1 })).statusCode).toBe(400);
    expect((await post(buildServer(), "busan", { foo: 1 })).statusCode).toBe(400);
    const guarded = buildServer({ apiToken: "t" });
    expect((await post(guarded, "busan")).statusCode).toBe(401);
    expect((await post(guarded, "busan", body, { authorization: "Bearer t" })).statusCode).toBe(200);
  });
});
