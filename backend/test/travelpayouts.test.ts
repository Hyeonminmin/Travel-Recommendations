import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createMockProviders } from "../src/providers/mock.js";
import { createTravelpayoutsFlight } from "../src/providers/travelpayouts.js";

const tokyo = DESTINATIONS.find((d) => d.id === "tokyo")!;
const jeju = DESTINATIONS.find((d) => d.id === "jeju")!;
const q = { origin: "ICN", startDate: "2026-12-20", endDate: "2026-12-24", travelers: 1 };
const mock = createMockProviders().flight;
const resp = (data: object[]) => (async () => new Response(JSON.stringify({ data }))) as unknown as typeof fetch;

describe("travelpayouts flight", () => {
  it("요청 날짜에 가장 가까운 왕복가를 고른다 (±1일 이내면 estimated=false)", async () => {
    const f = createTravelpayoutsFlight("t", mock, resp([
      { price: 200000, departure_at: "2026-12-02T10:00:00+09:00", return_at: "2026-12-09T10:00:00+09:00" },
      { price: 350000, departure_at: "2026-12-20T10:00:00+09:00", return_at: "2026-12-24T10:00:00+09:00" },
      { price: 300000, departure_at: "2026-12-21T10:00:00+09:00", return_at: "2026-12-24T10:00:00+09:00" },
    ]));
    const r = await f.roundTripPerPersonKRW(tokyo, q);
    expect(r.value).toBe(350000);
    expect(r.estimated).toBe(false);
  });
  it("날짜가 멀면 가장 가까운 항목을 estimated=true 로", async () => {
    const f = createTravelpayoutsFlight("t", mock, resp([{ price: 228888, departure_at: "2026-12-02T10:00:00+09:00", return_at: "2026-12-09T10:00:00+09:00" }]));
    const r = await f.roundTripPerPersonKRW(tokyo, q);
    expect(r.value).toBe(228888);
    expect(r.estimated).toBe(true);
  });
  it("편도(return_at 없음)는 무시, 결과 없으면 fallback", async () => {
    const f = createTravelpayoutsFlight("t", mock, resp([{ price: 99999, departure_at: "2026-12-20T10:00:00+09:00" }]));
    expect((await f.roundTripPerPersonKRW(tokyo, q)).source).toContain("mock");
  });
  it("국내선과 HTTP 오류는 fallback", async () => {
    const bad = (async () => new Response("x", { status: 401 })) as unknown as typeof fetch;
    expect((await createTravelpayoutsFlight("t", mock, bad).roundTripPerPersonKRW(tokyo, q)).source).toContain("mock");
    expect((await createTravelpayoutsFlight("t", mock, resp([])).roundTripPerPersonKRW(jeju, q)).source).toContain("mock");
  });
});
