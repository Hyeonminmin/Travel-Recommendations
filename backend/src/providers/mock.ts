import { eventsFor } from "../data.js";
import type { Providers } from "./types.js";

const now = () => new Date().toISOString();
const SRC = "mock-sample";

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
  };
}
