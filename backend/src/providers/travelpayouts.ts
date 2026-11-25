import type { Destination, Sourced } from "../types.js";
import type { FlightProvider, TripQuery } from "./types.js";

type Fetch = typeof fetch;
interface Ticket { price: number; departure_at: string; return_at?: string; transfers?: number }

const dayMs = 86_400_000;
const diffDays = (a: string, b: string) => Math.abs(Math.round((Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / dayMs));

/**
 * Travelpayouts(Aviasales) Data API — 최근 검색된 '캐시' 왕복 최저가.
 * 정확한 날짜 조회는 결과가 거의 없어(검증: 6개 노선 중 2개) 월 단위로 받아 요청 날짜에 가장 가까운 항목을 고른다.
 *  - 출발·귀국일 모두 ±1일 이내: estimated=false (그래도 캐시가이므로 source 에 날짜 표기)
 *  - 그 외: 가장 가까운 날짜의 가격을 쓰고 estimated=true
 *  - 결과 없음/오류/국내선: fallback Provider
 */
export function createTravelpayoutsFlight(token: string, fallback: FlightProvider, fetchFn: Fetch = fetch): FlightProvider {
  return {
    async roundTripPerPersonKRW(dest: Destination, q: TripQuery): Promise<Sourced<number>> {
      if (!dest.iata || dest.domestic) return fallback.roundTripPerPersonKRW(dest, q);
      try {
        const url =
          `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${q.origin}&destination=${dest.iata}` +
          `&departure_at=${q.startDate.slice(0, 7)}&return_at=${q.endDate.slice(0, 7)}&currency=krw&limit=100&sorting=price&one_way=false`;
        const res = await fetchFn(url, { headers: { "X-Access-Token": token } });
        if (!res.ok) throw new Error(`travelpayouts HTTP ${res.status}`);
        const tickets = ((await res.json()) as { data?: Ticket[] }).data?.filter((t) => t.return_at && t.price > 0) ?? [];
        if (!tickets.length) return fallback.roundTripPerPersonKRW(dest, q);

        const dist = (t: Ticket) => diffDays(t.departure_at, q.startDate) + diffDays(t.return_at!, q.endDate);
        const best = tickets.reduce((a, b) => (dist(b) < dist(a) || (dist(b) === dist(a) && b.price < a.price) ? b : a));
        const exact = diffDays(best.departure_at, q.startDate) <= 1 && diffDays(best.return_at!, q.endDate) <= 1;
        return {
          value: best.price,
          source: `travelpayouts 캐시가 (${best.departure_at.slice(0, 10)}~${best.return_at!.slice(0, 10)})`,
          asOf: new Date().toISOString(),
          estimated: !exact,
        };
      } catch {
        return fallback.roundTripPerPersonKRW(dest, q);
      }
    },
  };
}
