import type { Destination, Sourced, TripEvent } from "../types.js";
import type { EventProvider, TripQuery } from "./types.js";

type Fetch = typeof fetch;

/**
 * 도착지 id → 시도 코드. 필요한 도시는 여기에 추가.
 *  - KorService2: lDongRegnCd(법정동 시도코드, 실응답 확인) / KorService1: areaCode(구 코드)
 */
const REGION: Record<string, { ldong: string; area: string }> = {
  jeju: { ldong: "50", area: "39" },
  busan: { ldong: "26", area: "6" },
  gangneung: { ldong: "51", area: "32" },
  yeosu: { ldong: "46", area: "38" },
};

const ymdToIso = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const isoToYmd = (s: string) => s.replace(/-/g, "");

/** data.go.kr 키는 Encoding/Decoding 두 형태가 있다. URLSearchParams 가 다시 인코딩하므로 디코딩해서 사용. */
export function normalizeServiceKey(key: string): string {
  if (!key.includes("%")) return key;
  try { return decodeURIComponent(key); } catch { return key; }
}

interface FestivalItem { title?: string; addr1?: string; eventstartdate?: string; eventenddate?: string }

/** 응답이 단건이면 객체, 다건이면 배열, 0건이면 "" 로 오는 data.go.kr 특성을 흡수. */
export function extractItems(j: any): FestivalItem[] {
  const item = j?.response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

/**
 * 한국관광공사 TourAPI 행사정보(searchFestival). 국내 도착지만 실제 호출하고
 * 해외·실패 시에는 fallback(Mock) 사용. 서비스 버전은 KorService2 → KorService1 순으로 시도.
 * KorService2 응답 필드(title/addr1/eventstartdate/eventenddate)는 실응답으로 확인함.
 */
export function createTourApiEvents(serviceKey: string, fallback: EventProvider, fetchFn: Fetch = fetch): EventProvider {
  const key = normalizeServiceKey(serviceKey);

  async function load(region: { ldong: string; area: string }, q: TripQuery): Promise<FestivalItem[]> {
    let lastErr: unknown;
    for (const [svc, op] of [["KorService2", "searchFestival2"], ["KorService1", "searchFestival1"]] as const) {
      try {
        const params = new URLSearchParams({
          serviceKey: key, MobileOS: "ETC", MobileApp: "TravelRec", _type: "json",
          eventStartDate: isoToYmd(q.startDate), numOfRows: "100", pageNo: "1",
        });
        if (svc === "KorService2") params.set("lDongRegnCd", region.ldong); else params.set("areaCode", region.area);
        const url = `https://apis.data.go.kr/B551011/${svc}/${op}?${params}`;
        // 서버가 간헐적으로 연결을 끊는 것이 관찰되어(실측) 서비스당 최대 3회 재시도
        let res: Response | undefined;
        for (let i = 0; i < 3 && !res; i++) { try { res = await fetchFn(url); } catch (e) { lastErr = e; } }
        if (!res) throw lastErr;
        if (!res.ok) throw new Error(`tourapi HTTP ${res.status}`);
        const j = JSON.parse(await res.text());
        if (j?.response?.header?.resultCode && j.response.header.resultCode !== "0000") {
          throw new Error(`tourapi ${j.response.header.resultCode}`);
        }
        return extractItems(j);
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  return {
    async events(dest: Destination, q: TripQuery): Promise<Sourced<TripEvent[]>> {
      const area = dest.domestic ? REGION[dest.id] : undefined;
      if (!area) return fallback.events(dest, q);
      try {
        const items = await load(area, q);
        const events: TripEvent[] = items
          .filter((it) => it.title && it.eventstartdate && it.eventenddate && (it.addr1 ?? "").includes(dest.name))
          .map((it) => ({ name: it.title!, tags: ["축제"], startDate: ymdToIso(it.eventstartdate!), endDate: ymdToIso(it.eventenddate!) }))
          .filter((e) => e.startDate <= q.endDate && e.endDate >= q.startDate);
        return { value: events, source: "한국관광공사 TourAPI", asOf: new Date().toISOString(), estimated: false };
      } catch {
        return fallback.events(dest, q);
      }
    },
  };
}
