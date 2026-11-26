import type { Destination, PoiInfo, Sourced } from "../types.js";
import type { PoiProvider } from "./types.js";

type Fetch = typeof fetch;

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/category.json";
const RADIUS_M = 20_000; // 카카오 로컬 최대 반경
const CACHE_MS = 24 * 3_600_000;

// 카테고리 그룹 코드: AT4=관광명소, FD6=음식점
const ATTRACTION = "AT4";
const RESTAURANT = "FD6";

interface KakaoResp { meta?: { total_count?: number }; documents?: { place_name?: string }[] }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * 반경 내 개수 → 0..1 밀도. 규모 차이가 커서(제주 관광명소 100여 곳 vs 음식점 수천~수만) 로그 스케일을 쓴다.
 * 관광명소 1,000곳=1점, 음식점 약 3만 곳=1점 이 되도록 잡은 임의 튜닝값이며 6:4 로 합산한다.
 * 한계: 목적지 중심 좌표 1점 기준 반경이라 도시 규모가 큰 곳, 중심에서 멀리 흩어진 곳(섬 등)에 편향이 있다.
 */
export function densityFromCounts(attractions: number, restaurants: number): number {
  const a = clamp01(Math.log10(Math.max(1, attractions)) / 3);
  const r = clamp01(Math.log10(Math.max(1, restaurants)) / 4.5);
  return Math.round((0.6 * a + 0.4 * r) * 100) / 100;
}

/**
 * 카카오 로컬 API(카테고리 검색) 기반 볼거리·식당 Provider. 국내 목적지만 지원하고
 * 해외·호출 실패 시 fallback 으로 대체한다. 목적지별 결과는 24시간 캐시한다.
 */
export function createKakaoPoi(restApiKey: string, fallback: PoiProvider, fetchFn: Fetch = fetch, now = () => Date.now()): PoiProvider {
  const cache = new Map<string, { at: number; value: PoiInfo }>();

  async function search(dest: Destination, code: string): Promise<{ total: number; names: string[] }> {
    const q = new URLSearchParams({ category_group_code: code, x: String(dest.lon), y: String(dest.lat), radius: String(RADIUS_M), size: "15" });
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchFn(`${ENDPOINT}?${q}`, { headers: { Authorization: `KakaoAK ${restApiKey}` } });
        if (!res.ok) throw new Error(`kakao HTTP ${res.status}`); // 401/403 은 키·사용설정 문제 → 재시도해도 같지만 비용이 작다
        const j = (await res.json()) as KakaoResp;
        const total = j.meta?.total_count;
        if (typeof total !== "number") throw new Error("kakao unexpected response");
        const names = (j.documents ?? []).map((d) => d.place_name?.trim()).filter((n): n is string => !!n).slice(0, 3);
        return { total, names };
      } catch (e) {
        lastErr = e; // 연결 reset 등 일시 오류 1회 재시도
      }
    }
    throw lastErr;
  }

  return {
    async poi(dest: Destination): Promise<Sourced<PoiInfo>> {
      if (!dest.domestic) return fallback.poi(dest);
      const hit = cache.get(dest.id);
      if (hit && now() - hit.at < CACHE_MS) {
        return { value: hit.value, source: "카카오 로컬 API(카테고리 검색)", asOf: new Date(hit.at).toISOString(), estimated: false };
      }
      try {
        const [at, fd] = await Promise.all([search(dest, ATTRACTION), search(dest, RESTAURANT)]);
        const value: PoiInfo = {
          density: densityFromCounts(at.total, fd.total),
          attractionCount: at.total,
          restaurantCount: fd.total,
          attractions: at.names,
          restaurants: fd.names,
        };
        cache.set(dest.id, { at: now(), value });
        return { value, source: "카카오 로컬 API(카테고리 검색)", asOf: new Date(now()).toISOString(), estimated: false };
      } catch {
        return fallback.poi(dest);
      }
    },
  };
}
