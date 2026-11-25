import { describe, expect, it } from "vitest";
import { createSpecialDayHolidays, extractHolidays, monthsBetween } from "../src/providers/holidays.js";
import { createMockProviders } from "../src/providers/mock.js";
import { congestionPenalty } from "../src/scoring.js";

const q = { origin: "ICN", startDate: "2026-12-20", endDate: "2027-01-02", travelers: 1 };
const resp = (item: unknown) => JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: item === undefined ? "" : { item } } } });
const mock = createMockProviders().holiday;

describe("holidays", () => {
  it("월 목록(연도 경계)", () => expect(monthsBetween("2026-12-20", "2027-01-02")).toEqual([{ y: "2026", m: "12" }, { y: "2027", m: "01" }]));
  it("단건 객체/배열/빈 응답 파싱", () => {
    expect(extractHolidays(JSON.parse(resp({ dateName: "기독탄신일", isHoliday: "Y", locdate: 20261225 })))).toEqual([{ date: "2026-12-25", name: "기독탄신일" }]);
    expect(extractHolidays(JSON.parse(resp([{ dateName: "a", isHoliday: "N", locdate: 20260101 }, { dateName: "신정", isHoliday: "Y", locdate: 20270101 }])))).toHaveLength(1);
    expect(extractHolidays(JSON.parse(resp(undefined)))).toEqual([]);
  });
  it("월별 호출 후 기간 내 공휴일만 반환", async () => {
    const f = (async (u: string) => new Response(u.includes("solMonth=12") ? resp({ dateName: "기독탄신일", isHoliday: "Y", locdate: 20261225 }) : resp({ dateName: "신정", isHoliday: "Y", locdate: 20270101 }))) as unknown as typeof fetch;
    const r = await createSpecialDayHolidays("k", mock, f).holidays(q);
    expect(r.value.map((h) => h.name)).toEqual(["기독탄신일", "신정"]);
    expect(r.estimated).toBe(false);
  });
  it("실패 시 mock fallback, 혼잡 감점 상한", async () => {
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect((await createSpecialDayHolidays("k", mock, boom).holidays(q)).source).toContain("mock");
    expect(congestionPenalty(1)).toBeCloseTo(0.1);
    expect(congestionPenalty(9)).toBe(0.3);
  });
});
