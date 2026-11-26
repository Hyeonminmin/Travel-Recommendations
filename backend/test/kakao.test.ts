import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createKakaoPoi, densityFromCounts } from "../src/providers/kakao.js";
import { createMockProviders } from "../src/providers/mock.js";
import { poiScore, recommend } from "../src/scoring.js";

const mock = createMockProviders();
const dest = (id: string) => DESTINATIONS.find((d) => d.id === id)!;

type Call = { url: string; auth: string | null };
/** AT4 / FD6 별로 다른 응답을 돌려주는 가짜 fetch */
const fake = (at: { total: number; names: string[] }, fd: { total: number; names: string[] }, calls: Call[] = []) =>
  (async (u: string, init?: RequestInit) => {
    const url = new URL(u);
    calls.push({ url: u, auth: new Headers(init?.headers).get("Authorization") });
    const r = url.searchParams.get("category_group_code") === "AT4" ? at : fd;
    return new Response(JSON.stringify({ meta: { total_count: r.total }, documents: r.names.map((place_name) => ({ place_name })) }));
  }) as unknown as typeof fetch;

describe("densityFromCounts", () => {
  it("로그 스케일 0..1, 개수가 많을수록 높고 상한 1", () => {
    expect(densityFromCounts(0, 0)).toBe(0);
    expect(densityFromCounts(1000, 31_623)).toBe(1);
    expect(densityFromCounts(1_000_000, 10_000_000)).toBe(1);
    expect(densityFromCounts(365, 27_014)).toBeGreaterThan(densityFromCounts(138, 6_634));
  });
});

describe("카카오 POI Provider", () => {
  it("국내 목적지는 AT4/FD6 를 좌표·최대반경으로 조회하고 KakaoAK 헤더를 보낸다", async () => {
    const calls: Call[] = [];
    const f = fake({ total: 365, names: ["시청소소길", "화지산", "아시아드", "넷째"] }, { total: 27_014, names: ["돈가스", "떡집"] }, calls);
    const r = await createKakaoPoi("KEY", mock.poi, f).poi(dest("busan"));
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.auth === "KakaoAK KEY")).toBe(true);
    const u = new URL(calls[0].url);
    expect(u.searchParams.get("x")).toBe("129.07");
    expect(u.searchParams.get("y")).toBe("35.18");
    expect(u.searchParams.get("radius")).toBe("20000");
    expect(r.value).toMatchObject({ attractionCount: 365, restaurantCount: 27_014, attractions: ["시청소소길", "화지산", "아시아드"], restaurants: ["돈가스", "떡집"] });
    expect(r.value.density).toBe(densityFromCounts(365, 27_014));
    expect(r.estimated).toBe(false);
  });
  it("같은 목적지는 캐시해 재호출하지 않는다", async () => {
    const calls: Call[] = [];
    const p = createKakaoPoi("KEY", mock.poi, fake({ total: 10, names: [] }, { total: 10, names: [] }, calls));
    await p.poi(dest("jeju"));
    await p.poi(dest("jeju"));
    expect(calls).toHaveLength(2);
  });
  it("해외는 호출 없이 fallback", async () => {
    const calls: Call[] = [];
    const r = await createKakaoPoi("KEY", mock.poi, fake({ total: 1, names: [] }, { total: 1, names: [] }, calls)).poi(dest("tokyo"));
    expect(calls).toHaveLength(0);
    expect(r.source).toContain("mock");
    expect(r.value.density).toBe(dest("tokyo").poiDensity);
  });
  it("401/오류 응답/네트워크 실패는 fallback", async () => {
    const bad = [
      (async () => new Response(JSON.stringify({ errorType: "AccessDeniedError", message: "disabled OPEN_MAP_AND_LOCAL service" }), { status: 403 })) as unknown as typeof fetch,
      (async () => new Response(JSON.stringify({ unexpected: true }))) as unknown as typeof fetch,
      (async () => { throw new Error("network"); }) as unknown as typeof fetch,
    ];
    for (const f of bad) {
      const r = await createKakaoPoi("KEY", mock.poi, f).poi(dest("busan"));
      expect(r.source).toContain("mock");
    }
  });
  it("일시적 연결 오류는 1회 재시도", async () => {
    let n = 0;
    const ok = fake({ total: 5, names: ["a"] }, { total: 5, names: ["b"] });
    const f = (async (u: string, i?: RequestInit) => { if (n++ === 0) throw new Error("ECONNRESET"); return (ok as any)(u, i); }) as unknown as typeof fetch;
    const r = await createKakaoPoi("KEY", mock.poi, f).poi(dest("busan"));
    expect(r.source).toContain("카카오");
  });
});

describe("scoring 연동", () => {
  it("poiScore 는 밀도를 주입받고, 생략하면 기존 샘플값을 쓴다", () => {
    const d = dest("busan");
    expect(poiScore(d, [])).toBe(poiScore(d, [], d.poiDensity));
    expect(poiScore(d, [], 1)).toBeGreaterThan(poiScore(d, [], 0.2));
  });
  it("recommend: 실데이터 밀도·대표 장소가 점수/사유/places 에 반영, 해외는 샘플 유지", async () => {
    const base = { origin: "ICN", startDate: "2026-12-10", endDate: "2026-12-12", budgetKRW: 5_000_000, travelers: 1, scope: "both" as const, tags: [], weights: { cost: 0, weather: 0, event: 0, lodging: 0, poi: 1, logistics: 0 }, idealTempC: [18, 26] as [number, number] };
    const providers = { ...mock, poi: createKakaoPoi("KEY", mock.poi, fake({ total: 365, names: ["화지산"] }, { total: 27_014, names: ["돈가스"] })) };
    const { results } = await recommend(base, providers);
    const busan = results.find((r) => r.destinationId === "busan")!;
    const tokyo = results.find((r) => r.destinationId === "tokyo")!;
    expect(busan.places).toEqual({ attractions: ["화지산"], restaurants: ["돈가스"] });
    expect(busan.breakdown.find((b) => b.factor === "poi")!.reason).toContain("관광명소 365곳, 음식점 27,014곳");
    expect(busan.breakdown.find((b) => b.factor === "poi")!.score).toBeCloseTo(poiScore(dest("busan"), [], densityFromCounts(365, 27_014)), 5);
    expect(tokyo.places).toEqual({ attractions: [], restaurants: [] });
    expect(tokyo.breakdown.find((b) => b.factor === "poi")!.score).toBeCloseTo(poiScore(dest("tokyo"), []), 5);
  });
});
