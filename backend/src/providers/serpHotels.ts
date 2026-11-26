import type { Destination, Sourced } from "../types.js";
import type { HotelQuote, HotelQuoteProvider, TripQuery } from "./types.js";

type Fetch = typeof fetch;

interface Prop { name?: string; overall_rating?: number; link?: string; rate_per_night?: { extracted_lowest?: number }; total_rate?: { extracted_lowest?: number } }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/** SerpApi google_hotels 응답 → 숙소 시세. ※ 필드명은 공식 문서 기준이며 실응답 미검증(키 발급 전). */
export function parseHotels(j: any): HotelQuote[] {
  const props: Prop[] = Array.isArray(j?.properties) ? j.properties : [];
  return props
    .filter((p) => p.name && typeof p.rate_per_night?.extracted_lowest === "number")
    .map((p) => ({ name: p.name!, perNightKRW: p.rate_per_night!.extracted_lowest!, rating: p.overall_rating, url: p.link }));
}

/**
 * 유료 SerpApi(Google Hotels) 실시간 숙소 시세. 호출 비용 때문에 결과 상세에서만 쓰고,
 * (목적지, 날짜, 인원) 단위로 캐시한다(기본 24h). 실패/키 없음은 fallback.
 * 정렬은 가격순이 아니라 Google 기본 순서를 그대로 두고, 순위·점수에는 반영하지 않는다.
 */
export function createSerpHotels(apiKey: string, fallback: HotelQuoteProvider, fetchFn: Fetch = fetch, now = () => Date.now(), ttlMs = 24 * 3_600_000): HotelQuoteProvider {
  const cache = new Map<string, { at: number; value: Sourced<{ medianPerNightKRW: number; hotels: HotelQuote[] }> }>();
  return {
    async quotes(dest: Destination, q: TripQuery) {
      const key = `${dest.id}|${q.startDate}|${q.endDate}|${q.travelers}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      try {
        const params = new URLSearchParams({
          engine: "google_hotels", q: `${dest.name} 호텔`, check_in_date: q.startDate, check_out_date: q.endDate,
          adults: String(Math.min(q.travelers, 2)), currency: "KRW", hl: "ko", gl: "kr", api_key: apiKey,
        });
        const res = await fetchFn(`https://serpapi.com/search.json?${params}`);
        if (!res.ok) throw new Error(`serpapi HTTP ${res.status}`); // 메시지에 URL(키) 포함 금지
        const hotels = parseHotels(await res.json()).slice(0, 10);
        if (!hotels.length) throw new Error("no hotels");
        const value: Sourced<{ medianPerNightKRW: number; hotels: HotelQuote[] }> = {
          value: { medianPerNightKRW: median(hotels.map((h) => h.perNightKRW)), hotels },
          source: "Google Hotels(SerpApi) 실시간 검색",
          asOf: new Date().toISOString(),
          estimated: false,
        };
        cache.set(key, { at: now(), value });
        return value;
      } catch {
        return fallback.quotes(dest, q);
      }
    },
  };
}
