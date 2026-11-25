import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createKmaWeather, latestBase, toGrid } from "../src/providers/kma.js";
import { latestTmFc, parseMid } from "../src/providers/kmaMid.js";
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
    expect(r.source).toBe("기상청 예보(단기2일/2일)");
    expect(r.estimated).toBe(false);
  });
  it("예보가 하나도 없으면(먼 날짜)·해외·오류는 fallback", async () => {
    const f = (async () => new Response(body(rows))) as unknown as typeof fetch;
    expect((await createKmaWeather("k", mock, f, now).forecast(jeju, q("2026-12-20", "2026-12-24"))).source).toContain("mock");
    expect((await createKmaWeather("k", mock, f, now).forecast(tokyo, q("2026-11-27", "2026-11-28"))).source).toContain("mock");
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect((await createKmaWeather("k", mock, boom, now).forecast(jeju, q("2026-11-27", "2026-11-28"))).source).toContain("mock");
  });
  it("일부만 예보로 덮이면 나머지 날은 과거 평년값과 일수 비율로 섞음", async () => {
    const f = (async () => new Response(body(rows.slice(0, 5)))) as unknown as typeof fetch; // 11/27,28 만 존재
    const r = await createKmaWeather("k", mock, f, now).forecast(jeju, q("2026-11-27", "2026-11-30")); // 4일 중 2일(+중기는 실패)
    const hist = (await mock.forecast(jeju, q("2026-11-27", "2026-11-30"))).value;
    expect(r.source).toContain("단기2일/4일");
    expect(r.source).toContain("mock");
    expect(r.value.avgTempC).toBeCloseTo(0.5 * 12 + 0.5 * hist.avgTempC, 1);
    expect(r.estimated).toBe(true);
  });
  it("단기가 못 덮는 날은 중기예보로 채움", async () => {
    const ta = { taMin5: 4, taMax5: 10, taMin6: 6, taMax6: 12 };
    const land = { rnSt5Am: 10, rnSt5Pm: 30, rnSt6Am: 50, rnSt6Pm: 70 };
    const mid = (op: string) => JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: [op.includes("Ta") ? ta : land] } } } });
    const f = (async (u: string) => new Response(u.includes("MidFcst") ? mid(u) : body([]))) as unknown as typeof fetch;
    const r = await createKmaWeather("k", mock, f, now).forecast(jeju, q("2026-12-01", "2026-12-02")); // 발표일 11/26 → 5일후=12/01
    expect(r.value).toEqual({ avgTempC: 8, rainProb: 0.4 });
    expect(r.source).toBe("기상청 예보(중기2일/2일)");
    expect(r.estimated).toBe(false);
  });
  it("중기예보 파싱/발표시각", () => {
    expect(parseMid({ taMin4: 2, taMax4: 8, taMin8: 1, taMax8: 5 }, { rnSt4Am: 20, rnSt4Pm: 40, rnSt8: 60 }, "202611260600")).toEqual({
      "2026-11-30": { tempC: 5, pop: 0.3 }, "2026-12-04": { tempC: 3, pop: 0.6 },
    });
    expect(latestTmFc(now())).toBe("202611260600");
    expect(latestTmFc(new Date("2026-11-25T20:00:00Z"))).toBe("202611251800"); // KST 05:00 → 전날 18시
  });
});
