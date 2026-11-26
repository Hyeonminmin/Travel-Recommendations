import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createMockProviders } from "../src/providers/mock.js";
import { createOpenMeteoWeather } from "../src/providers/openMeteo.js";

const jeju = DESTINATIONS[0];
const q = (s: string, e: string) => ({ origin: "ICN", startDate: s, endDate: e, travelers: 1 });
const ok = (daily: object) => (async () => new Response(JSON.stringify({ daily }), { status: 200 })) as unknown as typeof fetch;
const today = () => new Date("2026-11-25T00:00:00Z");

describe("open-meteo weather", () => {
  it("15일 이내는 예보 API 사용 (estimated=false)", async () => {
    let url = "";
    const f = (async (u: string) => { url = u; return new Response(JSON.stringify({ daily: { temperature_2m_mean: [10, 12], precipitation_probability_max: [20, 40] } })); }) as unknown as typeof fetch;
    const r = await createOpenMeteoWeather(createMockProviders().weather, f, today).forecast(jeju, q("2026-12-01", "2026-12-03"));
    expect(url).toContain("api.open-meteo.com/v1/forecast");
    expect(r.value).toEqual({ avgTempC: 11, rainProb: 0.3 });
    expect(r.estimated).toBe(false);
  });
  it("먼 날짜는 과거 3년 archive 평년값 (estimated=true)", async () => {
    const r = await createOpenMeteoWeather(createMockProviders().weather, ok({ temperature_2m_mean: [5, 7], precipitation_sum: [0, 3] }), today).forecast(jeju, q("2027-02-10", "2027-02-12"));
    expect(r.value.avgTempC).toBe(6);
    expect(r.value.rainProb).toBe(0.5);
    expect(r.estimated).toBe(true);
  });
  it("API 실패 시 fallback(mock) 으로 대체", async () => {
    const f = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    const r = await createOpenMeteoWeather(createMockProviders().weather, f, today).forecast(jeju, q("2026-12-20", "2026-12-24"));
    expect(r.source).toContain("mock");
  });
  it("일시적 연결 오류는 1회 재시도해 평년값을 얻는다", async () => {
    let n = 0;
    const f = (async () => { if (n++ === 0) throw new Error("ECONNRESET"); return new Response(JSON.stringify({ daily: { temperature_2m_mean: [5, 7], precipitation_sum: [0, 3] } })); }) as unknown as typeof fetch;
    const r = await createOpenMeteoWeather(createMockProviders().weather, f, today).forecast(jeju, q("2027-02-10", "2027-02-12"));
    expect(r.source).toContain("open-meteo");
    expect(r.value.avgTempC).toBe(6);
  });
});
