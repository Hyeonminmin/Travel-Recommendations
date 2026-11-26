import { eventsFor } from "../data.js";
import type { Providers } from "./types.js";

const now = () => new Date().toISOString();
const SRC = "mock-sample";
// 음력 기반(설날·추석·부처님오신날)과 대체공휴일은 계산할 수 없어 빠진다 → estimated
const FIXED_HOLIDAYS: [string, string][] = [["01-01", "신정"], ["03-01", "삼일절"], ["05-01", "노동절"], ["05-05", "어린이날"], ["06-06", "현충일"], ["08-15", "광복절"], ["10-03", "개천절"], ["10-09", "한글날"], ["12-25", "성탄절"]];

/** API 키가 없을 때 쓰는 결정적(deterministic) 샘플 Provider. 값은 모두 추정치. */
export function createMockProviders(): Providers {
  return {
    flight: {
      async roundTripPerPersonKRW(dest, q) {
        // 성수기(7~8, 12~1월) 가산 샘플
        const m = Number(q.startDate.slice(5, 7));
        const peak = [7, 8, 12, 1].includes(m) ? 1.25 : 1;
        return { value: Math.round(dest.flightBaseKRW * peak), source: SRC, asOf: now(), estimated: true };
      },
    },
    lodging: {
      async perNightKRW(dest) {
        return { value: dest.lodgingPerNightKRW, source: SRC, asOf: now(), estimated: true };
      },
      async rating(dest) {
        return { value: dest.lodgingRating, source: SRC, asOf: now(), estimated: true };
      },
    },
    weather: {
      async forecast(dest, q) {
        const month = Number(q.startDate.slice(5, 7)) - 1;
        return { value: dest.climate[month], source: `${SRC}(기후 평년값)`, asOf: now(), estimated: true };
      },
    },
    event: {
      async events(dest, q) {
        return { value: eventsFor(dest.id, q.startDate, q.endDate), source: SRC, asOf: now(), estimated: true };
      },
    },
    poi: {
      async poi(dest) {
        return { value: { density: dest.poiDensity, attractions: [], restaurants: [] }, source: SRC, asOf: now(), estimated: true };
      },
    },
    holiday: {
      async holidays(q) {
        const value: { date: string; name: string }[] = [];
        for (let y = Number(q.startDate.slice(0, 4)); y <= Number(q.endDate.slice(0, 4)); y++) {
          for (const [md, name] of FIXED_HOLIDAYS) {
            const date = `${y}-${md}`;
            if (date >= q.startDate && date <= q.endDate) value.push({ date, name });
          }
        }
        return { value, source: `${SRC}(양력 고정 공휴일만)`, asOf: now(), estimated: true };
      },
    },
  };
}
