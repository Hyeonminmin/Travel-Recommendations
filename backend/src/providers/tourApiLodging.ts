import type { Destination, Sourced } from "../types.js";
import { normalizeServiceKey } from "./tourApi.js";
import type { LodgingProvider, TripQuery } from "./types.js";

type Fetch = typeof fetch;
const LDONG: Record<string, string> = { jeju: "50", busan: "26", gangneung: "51", yeosu: "46" };
const PEAK_MONTHS = [7, 8, 12, 1];
const MIN_SAMPLES = 5;
const MAX_STAYS = 40;
const BASE = "https://apis.data.go.kr/B551011/KorService2";

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

interface Room { roomoffseasonminfee1?: string; roompeakseasonminfee1?: string }

/** 숙박 상세(detailInfo2)의 객실 요금. 미등록 요금은 "0" 으로 오므로 0 은 제외. 단건이면 객체로 온다. */
export function extractRoomFees(j: any): { off: number[]; peak: number[] } {
  const raw = j?.response?.body?.items?.item;
  const rooms: Room[] = !raw ? [] : Array.isArray(raw) ? raw : [raw];
  const pos = (v?: string) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
  return {
    off: rooms.map((r) => pos(r.roomoffseasonminfee1)).filter((x): x is number => x !== undefined),
    peak: rooms.map((r) => pos(r.roompeakseasonminfee1)).filter((x): x is number => x !== undefined),
  };
}

/**
 * 한국관광공사 숙박(searchStay2 + detailInfo2) 에 숙소가 직접 등록한 객실 최저요금(주중)의 중앙값으로
 * 1박 요금을 추정한다(국내만). 요금 등록률이 낮고 "최저요금"이라 낙관적이므로 estimated=true,
 * 표본이 MIN_SAMPLES 미만이거나 실패하면 fallback. 첫 수집은 호출이 많아(실측 최대 ~1분) 요청을 막지 않도록
 * waitMs 안에 끝나지 않으면 이번 요청은 fallback 으로 응답하고 수집은 백그라운드로 계속해 24h 캐시를 채운다.
 */
export function createTourApiLodging(serviceKey: string, fallback: LodgingProvider, fetchFn: Fetch = fetch, now = () => Date.now(), ttlMs = 24 * 3_600_000, waitMs = 6_000): LodgingProvider {
  const key = normalizeServiceKey(serviceKey);
  const cache = new Map<string, { at: number; fees: { off: number[]; peak: number[] } | null }>();
  const inflight = new Map<string, Promise<{ off: number[]; peak: number[] } | null>>();

  async function get(op: string, extra: Record<string, string>) {
    const url = `${BASE}/${op}?${new URLSearchParams({ serviceKey: key, MobileOS: "ETC", MobileApp: "TravelRec", _type: "json", ...extra })}`;
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      if (i) await new Promise((r) => setTimeout(r, 300 * i));
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`tourapi HTTP ${res.status}`);
        return JSON.parse(await res.text());
      } catch (e) { last = e; }
    }
    throw last;
  }

  function collect(ldong: string) {
    let p = inflight.get(ldong);
    if (!p) { p = collectOnce(ldong).finally(() => inflight.delete(ldong)); inflight.set(ldong, p); }
    return p;
  }
  async function collectOnce(ldong: string) {
    const hit = cache.get(ldong);
    if (hit && now() - hit.at < ttlMs) return hit.fees;
    try {
      const list = await get("searchStay2", { lDongRegnCd: ldong, numOfRows: String(MAX_STAYS), pageNo: "1" });
      const raw = list?.response?.body?.items?.item;
      const ids: string[] = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((s: any) => String(s.contentid));
      const fees = { off: [] as number[], peak: [] as number[] };
      for (let i = 0; i < ids.length; i += 5) { // 동시 5건씩
        const batch = await Promise.all(ids.slice(i, i + 5).map((id) => get("detailInfo2", { contentId: id, contentTypeId: "32" }).then(extractRoomFees).catch(() => ({ off: [], peak: [] }))));
        for (const b of batch) { fees.off.push(...b.off); fees.peak.push(...b.peak); }
      }
      cache.set(ldong, { at: now(), fees });
      return fees;
    } catch {
      return null; // 실패는 캐시하지 않음
    }
  }

  return {
    async perNightKRW(dest: Destination, q: TripQuery): Promise<Sourced<number>> {
      const ldong = dest.domestic ? LDONG[dest.id] : undefined;
      if (!ldong) return fallback.perNightKRW(dest, q);
      const fees = await Promise.race([collect(ldong), new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
      const peak = PEAK_MONTHS.includes(Number(q.startDate.slice(5, 7)));
      const xs = fees ? (peak ? fees.peak : fees.off) : [];
      if (xs.length < MIN_SAMPLES) return fallback.perNightKRW(dest, q);
      return { value: median(xs), source: `한국관광공사 숙박 등록요금 중앙값(${peak ? "성수기" : "비수기"}, 표본 ${xs.length}객실)`, asOf: new Date().toISOString(), estimated: true };
    },
    rating: (dest) => fallback.rating(dest),
  };
}
