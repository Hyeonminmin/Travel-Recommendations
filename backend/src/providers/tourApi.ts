import type { Destination, Sourced, TripEvent } from "../types.js";
import type { EventProvider, TripQuery } from "./types.js";

type Fetch = typeof fetch;

const ENDPOINT = "https://apis.data.go.kr/B551011/KorService2/searchFestival2";
const MAX_EVENTS = 5; // scoring 이 행사 수에 비례해 가산하므로 상위 몇 개만 사용
const CACHE_MS = 6 * 3_600_000; // 행사 목록은 하루에 몇 번 바뀌는 정도
const MAX_PAGES = 3; // 지역당 최대 300건
const MAX_DURATION_DAYS = 120; // 연중 상설 프로그램(예: 1/1~12/31 상설공연)은 "행사"로 보지 않음

/**
 * 목적지 → TourAPI 법정동 시도코드(lDongRegnCd). 응답의 areacode 는 비어 있고 areaCode 필터도 동작하지 않아
 * lDongRegnCd 를 사용한다. city 가 있으면 주소(addr1)에 해당 시 이름이 포함된 행사만 남긴다.
 */
export const REGIONS: Record<string, { regionCode: string; city?: string }> = {
  jeju: { regionCode: "50" },
  busan: { regionCode: "26" },
  gangneung: { regionCode: "51", city: "강릉" },
  yeosu: { regionCode: "12", city: "여수" },
};

interface TourItem {
  title?: string;
  addr1?: string;
  eventstartdate?: string;
  eventenddate?: string;
}

const iso = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
const compact = (d: string) => d.replaceAll("-", "");
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** 행사명 키워드로 사용자 태그와 매칭될 태그를 추정한다. 축제/행사는 기본으로 "축제". */
export function inferTags(title: string): string[] {
  const tags = new Set<string>(["축제"]);
  if (/음식|미식|먹거리|맛|커피|푸드|와인|막걸리|수산|굴|해산물|전어|대게/.test(title)) tags.add("미식");
  if (/꽃|벚꽃|억새|단풍|유채|국화|해변|바다|숲|섬|트레킹|생태|가든/.test(title)) tags.add("자연");
  if (/불꽃|빛|일루미|야경|드론|미디어아트|도시|패션|영화|뮤직|음악|록|EDM/.test(title)) tags.add("도시");
  return [...tags];
}

/**
 * 한국관광공사 TourAPI(KorService2 searchFestival2) 행사 Provider. 국내 목적지만 지원하고
 * 해외·호출 실패 시에는 fallback 으로 대체한다. (행사가 0건인 정상 응답은 fallback 하지 않는다)
 *
 * 캐시: 지역(lDongRegnCd)별 "오늘(KST) 이후 행사" 원본 목록을 6시간 캐시하고, 여행 기간과의 겹침은 요청마다 로컬에서 거른다.
 * 그래서 /recommend 한 번에 TourAPI 를 4번 부르던 것이 지역당 6시간에 1~3번으로 줄고, 여행 날짜가 달라도 캐시를 공유한다.
 * 갱신에 실패하면 오래된 캐시를 계속 쓴다. 지역 행사가 한 번에 받을 수 있는 양(300건)을 넘으면 먼 날짜 행사가 잘릴 수 있어
 * 그 지역은 캐시를 쓰지 않고 요청별 조회(여행 시작일 기준)로 되돌아가고, 과거 날짜로 시작하는 여행도 캐시를 쓰지 않는다.
 */
export function createTourApiEvents(serviceKey: string, fallback: EventProvider, fetchFn: Fetch = fetch, now: () => number = () => Date.now()): EventProvider {
  // data.go.kr 은 Encoding/Decoding 키 두 종류를 주므로 이미 인코딩된 키는 풀어서 URLSearchParams 로 한 번만 인코딩
  const key = serviceKey.includes("%") ? decodeURIComponent(serviceKey) : serviceKey;

  async function getJson(url: string): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`tourapi HTTP ${res.status}`);
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("tourapi non-JSON response"); // 오류를 XML 로 주는 경우
        }
      } catch (e) {
        lastErr = e; // 연결 reset 등 일시 오류를 위해 1회 재시도
      }
    }
    throw lastErr;
  }

  async function fetchRegion(regionCode: string, from: string): Promise<{ items: TourItem[]; truncated: boolean }> {
    const out: TourItem[] = [];
    let total = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const q = new URLSearchParams({
        serviceKey: key, MobileOS: "ETC", MobileApp: "TravelRec", _type: "json",
        eventStartDate: compact(from), lDongRegnCd: regionCode, numOfRows: "100", pageNo: String(page),
      });
      const j = await getJson(`${ENDPOINT}?${q}`);
      const header = j?.response?.header;
      if (header?.resultCode !== "0000") throw new Error(`tourapi resultCode=${header?.resultCode}`);
      const body = j.response.body;
      const items = body?.items?.item; // 0건이면 items 가 "" 로 온다
      const list: TourItem[] = Array.isArray(items) ? items : items ? [items] : [];
      out.push(...list);
      total = Number(body?.totalCount ?? 0);
      if (page * 100 >= total) break;
    }
    return { items: out, truncated: total > out.length };
  }

  interface RegionEntry { at: number; items: TourItem[]; truncated: boolean }
  const cache = new Map<string, RegionEntry>();
  const inflight = new Map<string, Promise<RegionEntry>>();
  const todayKst = () => new Date(now() + 9 * 3_600_000).toISOString().slice(0, 10);

  function loadShared(regionCode: string): Promise<RegionEntry> {
    const running = inflight.get(regionCode);
    if (running) return running; // 동시 요청은 호출 한 번을 공유
    const p = (async () => {
      const r = await fetchRegion(regionCode, todayKst());
      const entry = { at: now(), ...r };
      cache.set(regionCode, entry);
      return entry;
    })().finally(() => inflight.delete(regionCode));
    inflight.set(regionCode, p);
    return p;
  }

  /** 지역 행사 원본 목록(+기준 시각). 캐시를 쓸 수 없는 경우(과거 시작·잘림)는 여행 시작일 기준으로 직접 조회한다. */
  async function regionItems(regionCode: string, tripStart: string): Promise<{ items: TourItem[]; at: number }> {
    const direct = async () => ({ items: (await fetchRegion(regionCode, tripStart)).items, at: now() });
    if (tripStart < todayKst()) return direct();
    const hit = cache.get(regionCode);
    if (hit && now() - hit.at < CACHE_MS) return hit.truncated ? direct() : hit;
    try {
      const entry = await loadShared(regionCode);
      return entry.truncated ? direct() : entry;
    } catch (e) {
      if (hit && !hit.truncated) return hit; // 갱신 실패 시 오래된 캐시라도 사용
      throw e;
    }
  }

  return {
    async events(dest: Destination, q: TripQuery): Promise<Sourced<TripEvent[]>> {
      const region = REGIONS[dest.id];
      if (!region || !dest.domestic) return fallback.events(dest, q);
      try {
        // eventStartDate 는 "이 날짜 이후에도 진행 중인 행사"까지 포함해 돌려준다
        const { items, at } = await regionItems(region.regionCode, q.startDate);
        const events: TripEvent[] = [];
        for (const it of items) {
          if (!it.title || !it.eventstartdate || !it.eventenddate) continue;
          if (region.city && !(it.addr1 ?? "").includes(region.city)) continue;
          const startDate = iso(it.eventstartdate);
          const endDate = iso(it.eventenddate);
          if (startDate > q.endDate || endDate < q.startDate) continue; // 여행 기간과 겹치지 않음
          if (days(startDate, endDate) > MAX_DURATION_DAYS) continue;
          events.push({ name: it.title.trim(), tags: inferTags(it.title), startDate, endDate });
        }
        // 짧고 뚜렷한 행사를 우선 (기간이 긴 행사는 뒤로)
        events.sort((a, b) => days(a.startDate, a.endDate) - days(b.startDate, b.endDate));
        return { value: events.slice(0, MAX_EVENTS), source: "TourAPI(한국관광공사) 행사정보", asOf: new Date(at).toISOString(), estimated: false };
      } catch {
        return fallback.events(dest, q);
      }
    },
  };
}
