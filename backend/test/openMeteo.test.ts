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

describe("open-meteo 요청 과다(429) 대응", () => {
  const archive = (t: number[], r: number[]) => JSON.stringify({ daily: { temperature_2m_mean: t, precipitation_sum: r } });
  const noSleep = { sleep: async () => {} };
  const far = q("2027-02-10", "2027-02-12");

  it("429 는 백오프 후 재시도해 평년값을 얻는다(첫 요청마다 429 를 받아도 성공)", async () => {
    const seen = new Set<string>();
    const waits: number[] = [];
    const f = (async (u: string) => {
      if (!seen.has(u)) { seen.add(u); return new Response("slow down", { status: 429 }); } // 각 URL 의 첫 요청은 429
      return new Response(archive([5, 7], [0, 3]));
    }) as unknown as typeof fetch;
    const r = await createOpenMeteoWeather(createMockProviders().weather, f, today, { sleep: async (ms) => { waits.push(ms); } }).forecast(jeju, far);
    expect(r.source).toContain("open-meteo");
    expect(r.value.avgTempC).toBe(6);
    expect(waits.length).toBe(3); // 연도 3개 × 429 1번
  });
  it("Retry-After 가 짧으면(≤3초) 그만큼 기다렸다가 재시도", async () => {
    const waits: number[] = [];
    let n = 0;
    const f = (async () => (n++ === 0 ? new Response("x", { status: 429, headers: { "retry-after": "2" } }) : new Response(archive([5, 7], [0, 3])))) as unknown as typeof fetch;
    const r = await createOpenMeteoWeather(createMockProviders().weather, f, today, { sleep: async (ms) => { waits.push(ms); } }).forecast(jeju, far);
    expect(r.source).toContain("open-meteo");
    expect(waits).toContain(2000);
  });
  it("Retry-After 가 길면(일일 한도 초과) 기다리지 않고 차단 — 그 시간 동안 호출 0회, 지나면 재개", async () => {
    let t = 1_000_000;
    let n = 0;
    const f = (async () => { n++; return new Response('{"reason":"Daily API request limit exceeded"}', { status: 429, headers: { "retry-after": "700" } }); }) as unknown as typeof fetch;
    const p = createOpenMeteoWeather(createMockProviders().weather, f, today, { sleep: async () => { throw new Error("기다리면 안 됨"); }, now: () => t });
    expect((await p.forecast(jeju, far)).source).toContain("mock");
    expect(n).toBe(1); // 한 번 맞고 바로 포기
    const before = n;
    await Promise.all(DESTINATIONS.map((d) => p.forecast(d, far)));
    expect(n).toBe(before); // 차단 중에는 어떤 목적지도 호출하지 않는다
    t += 701_000;
    await p.forecast(jeju, far);
    expect(n).toBeGreaterThan(before); // Retry-After 가 지나면 다시 시도
  });
  it("차단 시간은 최대 30분", async () => {
    let t = 1_000_000;
    let n = 0;
    const f = (async () => { n++; return new Response("x", { status: 429, headers: { "retry-after": "86400" } }); }) as unknown as typeof fetch;
    const p = createOpenMeteoWeather(createMockProviders().weather, f, today, { ...noSleep, now: () => t });
    await p.forecast(jeju, far);
    t += 31 * 60_000;
    await p.forecast(jeju, far);
    expect(n).toBe(2);
  });
  it("계속 429 면 3번 시도 후 fallback", async () => {
    let n = 0;
    const f = (async () => { n++; return new Response("x", { status: 429 }); }) as unknown as typeof fetch;
    const r = await createOpenMeteoWeather(createMockProviders().weather, f, today, noSleep).forecast(jeju, far);
    expect(r.source).toContain("mock");
    expect(n).toBe(3); // 첫 URL 에서 3번 시도 후 포기(나머지 연도는 호출하지 않음)
  });
  it("400 같은 재시도해도 소용없는 오류는 즉시 포기", async () => {
    let n = 0;
    const f = (async () => { n++; return new Response("bad", { status: 400 }); }) as unknown as typeof fetch;
    const r = await createOpenMeteoWeather(createMockProviders().weather, f, today, noSleep).forecast(jeju, far);
    expect(r.source).toContain("mock");
    expect(n).toBe(1);
  });
  it("같은 좌표·기간은 캐시해 재호출하지 않고, 하루가 지나면 다시 조회", async () => {
    let n = 0;
    let t = 1_000_000;
    const f = (async () => { n++; return new Response(archive([5, 7], [0, 3])); }) as unknown as typeof fetch;
    const p = createOpenMeteoWeather(createMockProviders().weather, f, today, { ...noSleep, now: () => t });
    await p.forecast(jeju, far);
    expect(n).toBe(3);
    await p.forecast(jeju, far);
    expect(n).toBe(3); // 캐시
    await p.forecast(DESTINATIONS[1], far);
    expect(n).toBe(6); // 다른 좌표는 별도
    t += 25 * 3_600_000;
    await p.forecast(jeju, far);
    expect(n).toBe(9); // 24시간 지나 재조회
  });
  it("동시 요청은 4개로 제한되고, 같은 URL 은 하나로 합쳐진다", async () => {
    let active = 0;
    let peak = 0;
    let n = 0;
    const f = (async () => {
      n++; active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return new Response(archive([5, 7], [0, 3]));
    }) as unknown as typeof fetch;
    const p = createOpenMeteoWeather(createMockProviders().weather, f, today, noSleep);
    // 목적지 10곳이 동시에 요청 + 같은 목적지 중복 요청
    await Promise.all([...DESTINATIONS, DESTINATIONS[0], DESTINATIONS[0]].map((d) => p.forecast(d, far)));
    expect(peak).toBeLessThanOrEqual(4);
    expect(n).toBe(DESTINATIONS.length * 3); // 중복 요청은 합쳐져 목적지당 3회뿐
  });
});

