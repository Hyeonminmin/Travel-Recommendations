import type { Destination, Sourced } from "../types.js";
import type { Place, PlaceProvider } from "./types.js";

type Fetch = typeof fetch;

interface Doc { place_name?: string; category_name?: string; road_address_name?: string; address_name?: string; place_url?: string; x?: string; y?: string }

export function parseDocs(j: any): Place[] {
  const docs: Doc[] = Array.isArray(j?.documents) ? j.documents : [];
  return docs
    .filter((d) => d.place_name)
    .map((d) => ({
      name: d.place_name!,
      category: (d.category_name ?? "").split(">").map((s) => s.trim()).filter(Boolean).slice(-2).join(" > "),
      address: d.road_address_name || d.address_name || "",
      url: d.place_url ?? "",
      lat: d.y ? Number(d.y) : undefined,
      lon: d.x ? Number(d.x) : undefined,
    }));
}

/**
 * Kakao 로컬 키워드 검색(국내 한정). 정렬은 Kakao 정확도순이며 평점/광고 정보를 쓰지 않는다.
 * FD6=음식점, AT4=관광명소. 실패·해외는 fallback.
 */
export function createKakaoPlaces(restKey: string, fallback: PlaceProvider, fetchFn: Fetch = fetch): PlaceProvider {
  async function search(query: string, group: "FD6" | "AT4"): Promise<Place[]> {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?${new URLSearchParams({ query, category_group_code: group, size: "10" })}`;
    const res = await fetchFn(url, { headers: { Authorization: `KakaoAK ${restKey}` } });
    if (!res.ok) throw new Error(`kakao HTTP ${res.status}`);
    return parseDocs(await res.json());
  }
  return {
    async places(dest: Destination): Promise<Sourced<{ restaurants: Place[]; attractions: Place[] }>> {
      if (!dest.domestic) return fallback.places(dest);
      try {
        const [restaurants, attractions] = await Promise.all([search(`${dest.name} 맛집`, "FD6"), search(`${dest.name} 관광명소`, "AT4")]);
        return { value: { restaurants, attractions }, source: "Kakao 로컬 검색(정확도순)", asOf: new Date().toISOString(), estimated: false };
      } catch {
        return fallback.places(dest);
      }
    },
  };
}
