import { eventsFor } from "../data.js";
import type { Providers } from "./types.js";

const now = () => new Date().toISOString();
const SRC = "mock-sample";
/** 샘플: 연말연시 공휴일만 (실제 값은 특일 API 사용). */
const MOCK_HOLIDAYS = [{ date: "2026-12-25", name: "기독탄신일" }, { date: "2027-01-01", name: "신정" }];

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
    holiday: {
      async holidays(q) {
        const value = MOCK_HOLIDAYS.filter((h) => h.date >= q.startDate && h.date <= q.endDate);
        return { value, source: `${SRC}(공휴일 일부)`, asOf: now(), estimated: true };
      },
    },
    place: {
      async places() {
        return { value: { restaurants: [], attractions: [] }, source: `${SRC}(장소 데이터 없음)`, asOf: now(), estimated: true };
      },
    },
    hotelQuote: {
      async quotes(dest) {
        return { value: { medianPerNightKRW: dest.lodgingPerNightKRW, hotels: [] }, source: `${SRC}(실시간 시세 없음)`, asOf: now(), estimated: true };
      },
    },
  };
}
