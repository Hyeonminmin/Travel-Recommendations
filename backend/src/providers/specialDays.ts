import type { Holiday, Sourced } from "../types.js";
import type { HolidayProvider, TripQuery } from "./types.js";

type Fetch = typeof fetch;

const ENDPOINT = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const CACHE_MS = 24 * 3_600_000; // 공휴일은 거의 바뀌지 않으므로 월 단위로 하루 캐시

interface RestDeItem { dateName?: string; isHoliday?: string; locdate?: number | string }

const pad = (n: number) => String(n).padStart(2, "0");

/** 시작~종료(포함)가 걸치는 [연, 월] 목록 */
export function monthsBetween(start: string, end: string): [number, number][] {
  const out: [number, number][] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4));
  const em = Number(end.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push([y, m]);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * 한국천문연구원 특일정보(getRestDeInfo) 공휴일 Provider. 월 단위로 조회해 여행 기간과 겹치는 날만 반환한다.
 * 대체공휴일·임시공휴일이 포함된다. 호출 실패 시 fallback(양력 고정 공휴일) 으로 대체한다.
 */
export function createSpecialDaysHolidays(serviceKey: string, fallback: HolidayProvider, fetchFn: Fetch = fetch, now = () => Date.now()): HolidayProvider {
  const key = serviceKey.includes("%") ? decodeURIComponent(serviceKey) : serviceKey;
  const cache = new Map<string, { at: number; days: Holiday[] }>();

  async function getJson(url: string): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`specialDays HTTP ${res.status}`);
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("specialDays non-JSON response"); // 오류를 XML 로 주는 경우
        }
      } catch (e) {
        lastErr = e; // 연결 reset 등 일시 오류 1회 재시도
      }
    }
    throw lastErr;
  }

  async function month(y: number, m: number): Promise<Holiday[]> {
    const ck = `${y}-${m}`;
    const hit = cache.get(ck);
    if (hit && now() - hit.at < CACHE_MS) return hit.days;
    const q = new URLSearchParams({ serviceKey: key, solYear: String(y), solMonth: pad(m), _type: "json", numOfRows: "50" });
    const j = await getJson(`${ENDPOINT}?${q}`);
    const header = j?.response?.header;
    if (header?.resultCode !== "00") throw new Error(`specialDays resultCode=${header?.resultCode}`);
    const raw = j.response.body?.items?.item; // 0건이면 items 가 "" / 1건이면 배열이 아닌 객체
    const list: RestDeItem[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const days = list
      .filter((i) => i.isHoliday === "Y" && i.locdate && i.dateName)
      .map((i) => {
        const d = String(i.locdate);
        return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, name: i.dateName! };
      });
    cache.set(ck, { at: now(), days });
    return days;
  }

  return {
    async holidays(q: TripQuery): Promise<Sourced<Holiday[]>> {
      try {
        const all = (await Promise.all(monthsBetween(q.startDate, q.endDate).map(([y, m]) => month(y, m)))).flat();
        const value = all.filter((h) => h.date >= q.startDate && h.date <= q.endDate).sort((a, b) => a.date.localeCompare(b.date));
        return { value, source: "한국천문연구원 특일정보", asOf: new Date(now()).toISOString(), estimated: false };
      } catch {
        return fallback.holidays(q);
      }
    },
  };
}
