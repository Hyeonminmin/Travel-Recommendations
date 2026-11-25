import { describe, expect, it } from "vitest";
import { costScore, logisticsScore, normalizeWeights, weatherScore, recommend, nightsBetween } from "../src/scoring.js";
import { createMockProviders } from "../src/providers/mock.js";
import { recommendRequestSchema } from "../src/types.js";
import { buildServer } from "../src/server.js";

const baseReq = () =>
  recommendRequestSchema.parse({ startDate: "2026-12-20", endDate: "2026-12-24", budgetKRW: 2_000_000, travelers: 2, tags: ["축제", "도시"] });

describe("factor scores", () => {
  it("cost: 40% 이하 1점, 100% 0점", () => {
    expect(costScore(400, 1000)).toBe(1);
    expect(costScore(1000, 1000)).toBe(0);
  });
  it("weather: 이상 범위 안 + 비 안 옴 = 1점", () => {
    expect(weatherScore(22, 0, [18, 26])).toBe(1);
    expect(weatherScore(35, 1, [18, 26])).toBeLessThan(0.1);
  });
  it("logistics: 가까울수록 높다", () => {
    expect(logisticsScore(1)).toBeGreaterThan(logisticsScore(6));
  });
  it("weights 정규화", () => {
    const w = normalizeWeights({ cost: 2, weather: 2, event: 0, lodging: 0, poi: 0, logistics: 0 });
    expect(w.cost).toBeCloseTo(0.5);
  });
  it("nights", () => expect(nightsBetween("2026-12-20", "2026-12-24")).toBe(4));
});

describe("recommend", () => {
  it("예산 초과 목적지는 제외되고 결과는 점수 내림차순", async () => {
    const { results, excluded } = await recommend({ ...baseReq(), budgetKRW: 1_500_000 }, createMockProviders());
    for (let i = 1; i < results.length; i++) expect(results[i - 1].totalScore).toBeGreaterThanOrEqual(results[i].totalScore);
    expect(excluded.length).toBeGreaterThan(0);
    expect(results.every((r) => r.estimatedTotalKRW <= 1_500_000)).toBe(true);
  });
  it("scope=domestic 이면 국내만", async () => {
    const { results } = await recommend({ ...baseReq(), scope: "domestic" }, createMockProviders());
    expect(results.every((r) => r.country === "KR")).toBe(true);
  });
  it("근거(breakdown) 가중치 합은 1", async () => {
    const { results } = await recommend(baseReq(), createMockProviders());
    const sum = results[0].breakdown.reduce((a, b) => a + b.weight, 0);
    expect(sum).toBeCloseTo(1);
  });
});

describe("POST /recommend", () => {
  it("토큰 없으면 401, 있으면 200", async () => {
    const app = buildServer({ apiToken: "t" });
    const body = { startDate: "2026-12-20", endDate: "2026-12-24", budgetKRW: 2000000 };
    expect((await app.inject({ method: "POST", url: "/recommend", payload: body })).statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/recommend", payload: body, headers: { authorization: "Bearer t" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().results.length).toBeGreaterThan(0);
  });
  it("잘못된 날짜는 400", async () => {
    const app = buildServer();
    const r = await app.inject({ method: "POST", url: "/recommend", payload: { startDate: "2026-12-24", endDate: "2026-12-20", budgetKRW: 1 } });
    expect(r.statusCode).toBe(400);
  });
});
