import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createMockProviders } from "../src/providers/mock.js";
import { createSpecialDaysHolidays, monthsBetween } from "../src/providers/specialDays.js";
import { HOLIDAY_PENALTY_MAX, holidayPenalty, recommend } from "../src/scoring.js";

const mock = createMockProviders();
const dest = (id: string) => DESTINATIONS.find((d) => d.id === id)!;
const q = (s: string, e: string) => ({ origin: "ICN", startDate: s, endDate: e, travelers: 1 });
const rest = (name: string, locdate: number, isHoliday = "Y") => ({ dateKind: "01", dateName: name, isHoliday, locdate, seq: 1 });
const body = (items: object[] | object | "") =>
  JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE." }, body: { items: items === "" ? "" : { item: items } } } });
const fakeFetch = (texts: Record<string, string>, urls: string[] = []) =>
  (async (u: string) => {
    urls.push(u);
    const m = new URL(u).searchParams.get("solMonth")!;
    return new Response(texts[m] ?? body(""));
  }) as unknown as typeof fetch;

describe("monthsBetween", () => {
  it("연말~연초를 넘나드는 기간", () => {
    expect(monthsBetween("2026-12-30", "2027-01-02")).toEqual([[2026, 12], [2027, 1]]);
    expect(monthsBetween("2026-12-10", "2026-12-14")).toEqual([[2026, 12]]);
  });
});

describe("특일정보 Provider", () => {
  it("여행 기간과 겹치는 공휴일만(대체공휴일 포함), 월별로 조회", async () => {
    const urls: string[] = [];
    const f = fakeFetch({ "02": body([rest("설날", 20270206), rest("설날", 20270207), rest("설날", 20270208), rest("대체공휴일(설날)", 20270209)]) }, urls);
    const r = await createSpecialDaysHolidays("k", mock.holiday, f).holidays(q("2027-02-07", "2027-02-10"));
    expect(r.value.map((h) => h.date)).toEqual(["2027-02-07", "2027-02-08", "2027-02-09"]);
    expect(r.estimated).toBe(false);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("solYear=2027");
    expect(urls[0]).toContain("solMonth=02");
  });
  it("1건은 객체로, 0건은 빈 문자열로 와도 처리 / isHoliday=N 은 제외", async () => {
    const f = fakeFetch({ "12": body(rest("기독탄신일", 20261225)), "01": body("") });
    const r = await createSpecialDaysHolidays("k", mock.holiday, f).holidays(q("2026-12-24", "2027-01-02"));
    expect(r.value).toEqual([{ date: "2026-12-25", name: "기독탄신일" }]);
    const n = await createSpecialDaysHolidays("k", mock.holiday, fakeFetch({ "12": body([rest("기념일", 20261212, "N")]) })).holidays(q("2026-12-10", "2026-12-14"));
    expect(n.value).toEqual([]);
  });
  it("같은 달은 캐시해 재호출하지 않는다", async () => {
    const urls: string[] = [];
    const p = createSpecialDaysHolidays("k", mock.holiday, fakeFetch({}, urls));
    await p.holidays(q("2026-12-10", "2026-12-14"));
    await p.holidays(q("2026-12-20", "2026-12-22"));
    expect(urls).toHaveLength(1);
  });
  it("오류 코드/XML/네트워크 실패는 fallback(양력 고정 공휴일, estimated)", async () => {
    const bad = [
      fakeFetch({ "12": "<OpenAPI_ServiceResponse>SERVICE_KEY_IS_NOT_REGISTERED</OpenAPI_ServiceResponse>" }),
      fakeFetch({ "12": JSON.stringify({ response: { header: { resultCode: "30", resultMsg: "SERVICE KEY" } } }) }),
      (async () => { throw new Error("network"); }) as unknown as typeof fetch,
    ];
    for (const f of bad) {
      const r = await createSpecialDaysHolidays("k", mock.holiday, f).holidays(q("2026-12-24", "2026-12-26"));
      expect(r.estimated).toBe(true);
      expect(r.value).toEqual([{ date: "2026-12-25", name: "성탄절" }]);
    }
  });
});

describe("공휴일 패널티", () => {
  const hol = (n: number) => Array.from({ length: n }, (_, i) => ({ date: `2027-02-0${i + 1}`, name: "설날" }));
  it("국내만 대상, 하루 3점, 최대 10점", () => {
    expect(holidayPenalty(dest("busan"), hol(1))?.points).toBe(3);
    expect(holidayPenalty(dest("busan"), hol(3))?.points).toBe(9);
    expect(holidayPenalty(dest("busan"), hol(4))?.points).toBe(HOLIDAY_PENALTY_MAX);
    expect(holidayPenalty(dest("tokyo"), hol(3))).toBeNull();
    expect(holidayPenalty(dest("busan"), [])).toBeNull();
  });
  it("recommend: 국내 총점이 차감되고 penalties 로 사유가 노출, 해외는 그대로", async () => {
    const base = { origin: "ICN", startDate: "2026-12-24", endDate: "2026-12-26", budgetKRW: 5_000_000, travelers: 1, scope: "both" as const, tags: [], weights: { cost: 0.3, weather: 0.2, event: 0.15, lodging: 0.15, poi: 0.1, logistics: 0.1 }, idealTempC: [18, 26] as [number, number] };
    const noHoliday = { ...mock, holiday: { holidays: async () => ({ value: [], source: "t", asOf: "", estimated: false }) } };
    const withHoliday = { ...mock, holiday: { holidays: async () => ({ value: [{ date: "2026-12-25", name: "성탄절" }], source: "t", asOf: "", estimated: false }) } };
    const a = (await recommend(base, noHoliday)).results;
    const b = (await recommend(base, withHoliday)).results;
    const pick = (rs: typeof a, id: string) => rs.find((r) => r.destinationId === id)!;
    expect(pick(a, "busan").penalties).toEqual([]);
    expect(pick(b, "busan").penalties[0].points).toBe(3);
    expect(pick(b, "busan").totalScore).toBeCloseTo(pick(a, "busan").totalScore - 3, 1);
    expect(pick(b, "tokyo").totalScore).toBe(pick(a, "tokyo").totalScore);
    expect(pick(b, "tokyo").penalties).toEqual([]);
  });
  it("공휴일이 추정치(API 실패 fallback)면 국내 결과에만 안내 문구", async () => {
    const base = { origin: "ICN", startDate: "2027-02-05", endDate: "2027-02-10", budgetKRW: 5_000_000, travelers: 1, scope: "both" as const, tags: [], weights: { cost: 0.3, weather: 0.2, event: 0.15, lodging: 0.15, poi: 0.1, logistics: 0.1 }, idealTempC: [18, 26] as [number, number] };
    const failing = { ...mock, holiday: createSpecialDaysHolidays("k", mock.holiday, (async () => { throw new Error("network"); }) as unknown as typeof fetch) };
    const { results } = await recommend(base, failing);
    const note = (id: string) => results.find((r) => r.destinationId === id)!.dataNotes.join(" ");
    expect(note("busan")).toContain("공휴일 정보를 불러오지 못해");
    expect(note("tokyo")).not.toContain("공휴일 정보를 불러오지 못해");
  });
});
