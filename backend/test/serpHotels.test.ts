import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createMockProviders } from "../src/providers/mock.js";
import { createSerpHotels, parseHotels } from "../src/providers/serpHotels.js";

const busan = DESTINATIONS.find((d) => d.id === "busan")!;
const q = { origin: "ICN", startDate: "2026-12-10", endDate: "2026-12-12", travelers: 2 };
const mock = createMockProviders().hotelQuote;
const props = [
  { name: "A호텔", overall_rating: 4.4, link: "https://x/a", rate_per_night: { extracted_lowest: 100000 } },
  { name: "B호텔", overall_rating: 4.0, rate_per_night: { extracted_lowest: 200000 } },
  { name: "가격없음" },
];
const ok = () => new Response(JSON.stringify({ properties: props }));

describe("SerpApi hotels", () => {
  it("파싱: 가격 없는 숙소 제외", () => expect(parseHotels({ properties: props }).map((h) => h.name)).toEqual(["A호텔", "B호텔"]));
  it("중앙값 계산 + 24h 캐시(두 번째 호출은 fetch 안 함)", async () => {
    let calls = 0, url = "";
    const f = (async (u: string) => { calls++; url = u; return ok(); }) as unknown as typeof fetch;
    const p = createSerpHotels("KEY", mock, f, () => 1000);
    const r = await p.quotes(busan, q);
    await p.quotes(busan, q);
    expect(calls).toBe(1);
    expect(url).toContain("engine=google_hotels");
    expect(url).toContain("check_in_date=2026-12-10");
    expect(r.value.medianPerNightKRW).toBe(150000);
    expect(r.estimated).toBe(false);
  });
  it("캐시 만료 후 재호출", async () => {
    let calls = 0, t = 0;
    const f = (async () => { calls++; return ok(); }) as unknown as typeof fetch;
    const p = createSerpHotels("K", mock, f, () => t, 1000);
    await p.quotes(busan, q); t = 2000; await p.quotes(busan, q);
    expect(calls).toBe(2);
  });
  it("오류/빈 결과는 mock fallback, 실패는 캐시하지 않음", async () => {
    let calls = 0;
    const bad = (async () => { calls++; return new Response("x", { status: 401 }); }) as unknown as typeof fetch;
    const p = createSerpHotels("K", mock, bad);
    expect((await p.quotes(busan, q)).source).toContain("mock");
    await p.quotes(busan, q);
    expect(calls).toBe(2);
    const empty = (async () => new Response(JSON.stringify({ properties: [] }))) as unknown as typeof fetch;
    expect((await createSerpHotels("K", mock, empty).quotes(busan, q)).source).toContain("mock");
  });
});
