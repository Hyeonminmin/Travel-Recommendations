import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createKmaWeather, latestBase, toGrid } from "../src/providers/kma.js";
import { createMockProviders } from "../src/providers/mock.js";

const jeju = DESTINATIONS[0];
const tokyo = DESTINATIONS.find((d) => !d.domestic)!;
const mock = createMockProviders().weather;
const now = () => new Date("2026-11-25T23:26:00Z"); // KST 11/26 08:26 → 0800 발표
const row = (category: string, fcstDate: string, v: number) => ({ category, fcstDate, fcstValue: String(v) });
const body = (rows: unknown[]) => JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: rows } } } });
const rows = [row("TMP", "20261127", 10), row("TMP", "20261127", 14), row("TMP", "20261128", 12), row("POP", "20261127", 20), row("POP", "20261128", 60), row("TMP", "20261130", 99)];
const q = (s: string, e: string) => ({ origin: "ICN", startDate: s, endDate: e, travelers: 1 });

describe("KMA weather", () => {
  it("격자 변환: 서울(37.5665,126.978)=60,127 / 제주(33.5,126.53)=53,38", () => {
    expect(toGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
    expect(toGrid(33.5, 126.53)).toEqual({ nx: 53, ny: 38 });
  });
  it("가장 최근 발표 시각(KST, 10분 지연)", () => {
    expect(latestBase(now())).toEqual({ date: "20261126", time: "0800" });
    expect(latestBase(new Date("2026-11-25T17:05:00Z"))).toEqual({ date: "20261125", time: "2300" }); // KST 02:05 → 전날 23시
  });
  it("기간 내 예보만 평균 (TMP/POP)", async () => {
    const f = (async () => new Response(body(rows))) as unknown as typeof fetch;
    const r = await createKmaWeather("k", mock, f, now).forecast(jeju, q("2026-11-27", "2026-11-28"));
    expect(r.value).toEqual({ avgTempC: 12, rainProb: 0.4 });
    expect(r.source).toContain("2/2");
    expect(r.estimated).toBe(false);
  });
  it("예보가 기간 절반 미만이면 fallback, 해외/오류도 fallback", async () => {
    const f = (async () => new Response(body(rows))) as unknown as typeof fetch;
    expect((await createKmaWeather("k", mock, f, now).forecast(jeju, q("2026-12-20", "2026-12-24"))).source).toContain("mock");
    expect((await createKmaWeather("k", mock, f, now).forecast(tokyo, q("2026-11-27", "2026-11-28"))).source).toContain("mock");
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect((await createKmaWeather("k", mock, boom, now).forecast(jeju, q("2026-11-27", "2026-11-28"))).source).toContain("mock");
  });
});
