import type { Sourced } from "../types.js";
import { normalizeServiceKey } from "./tourApi.js";
import type { HolidayProvider, TripQuery } from "./types.js";

type Fetch = typeof fetch;
interface Item { dateName?: string; isHoliday?: string; locdate?: number | string }

/** 여행 기간에 걸친 (연,월) 목록 */
export function monthsBetween(start: string, end: string): { y: string; m: string }[] {
  const out: { y: string; m: string }[] = [];
  let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4)), em = Number(end.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push({ y: String(y), m: String(m).padStart(2, "0") });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** 이 응답은 1건이면 객체, 여러 건이면 배열, 0건이면 "" 로 온다(실응답 확인). */
export function extractHolidays(j: any): { date: string; name: string }[] {
  const raw = j?.response?.body?.items?.item;
  if (!raw) return [];
  const items: Item[] = Array.isArray(raw) ? raw : [raw];
  return items
    .filter((i) => i.isHoliday === "Y" && i.locdate && i.dateName)
    .map((i) => { const s = String(i.locdate); return { date: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`, name: i.dateName! }; });
}

/** 한국천문연구원 특일 정보(공휴일). 실패 시 fallback. */
export function createSpecialDayHolidays(serviceKey: string, fallback: HolidayProvider, fetchFn: Fetch = fetch): HolidayProvider {
  const key = normalizeServiceKey(serviceKey);
  async function month(y: string, m: string) {
    const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?${new URLSearchParams({ serviceKey: key, solYear: y, solMonth: m, _type: "json" })}`;
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) { // Node fetch 가 간헐적으로 실패하는 것이 관찰됨
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`holiday HTTP ${res.status}`);
        const j = JSON.parse(await res.text());
        if (j?.response?.header?.resultCode !== "00") throw new Error(`holiday ${j?.response?.header?.resultCode}`);
        return extractHolidays(j);
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }
  return {
    async holidays(q: TripQuery): Promise<Sourced<{ date: string; name: string }[]>> {
      try {
        const all = (await Promise.all(monthsBetween(q.startDate, q.endDate).map((x) => month(x.y, x.m)))).flat();
        const value = all.filter((h) => h.date >= q.startDate && h.date <= q.endDate);
        return { value, source: "한국천문연구원 특일정보", asOf: new Date().toISOString(), estimated: false };
      } catch {
        return fallback.holidays(q);
      }
    },
  };
}
