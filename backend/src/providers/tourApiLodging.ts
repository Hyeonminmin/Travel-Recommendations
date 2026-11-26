import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Destination, Sourced } from "../types.js";
import { getJsonWithRetry } from "./http.js";
import { REGIONS } from "./tourApi.js";
import type { LodgingProvider, TripQuery } from "./types.js";

type Fetch = typeof fetch;

const BASE = "https://apis.data.go.kr/B551011/KorService2";
const SAMPLE_SIZE = 60; // 지역당 상세 조회 숙소 수 (호출 수·시간 억제: 상세 1건이 약 5초)
const CONCURRENCY = 8;
const REFRESH_MS = 7 * 24 * 3_600_000; // 공시 요금은 거의 안 바뀐다
const MIN_FIELD_N = 5; // 요금이 기재된 숙소가 이보다 적은 칸(성수기/주말 등)은 신뢰하지 않는다
const MIN_FEE = 20_000; // 단위·오기재로 보이는 값 제외
const MAX_FEE = 3_000_000;
const PEAK_MONTHS = [7, 8]; // 성수기 판정 휴리스틱(숙소별 성수기 기간은 알 수 없음)

const FEE_FIELDS = {
  offWeekday: "roomoffseasonminfee1",
  offWeekend: "roomoffseasonminfee2",
  peakWeekday: "roompeakseasonminfee1",
  peakWeekend: "roompeakseasonminfee2",
} as const;
type FeeKey = keyof typeof FEE_FIELDS;

/** 지역 중앙값 통계. 각 칸은 요금이 기재된 숙소들의 "객실 최저요금" 중앙값. */
export interface FeeStats {
  sampled: number; // 상세 조회에 성공한 숙소 수
  total: number; // 지역 등록 숙소 수
  fees: Partial<Record<FeeKey, { median: number; n: number }>>;
}
interface Entry { at: number; stats: FeeStats }

export interface LodgingStore {
  load(): Record<string, Entry>;
  save(all: Record<string, Entry>): void;
}

/** JSON 파일 캐시. 서버 재시작 때 수백 건을 다시 수집하지 않도록 한다. 실패해도 동작에는 영향 없음. */
export function createFileStore(path: string): LodgingStore {
  return {
    load() {
      try {
        return JSON.parse(readFileSync(path, "utf-8"));
      } catch {
        return {};
      }
    },
    save(all) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(all));
      } catch {
        /* 캐시 저장 실패는 무시 */
      }
    },
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 정렬된 목록에서 균등 간격으로 n 개 추출(결정적). */
function strideSample<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.floor((i * xs.length) / n)]);
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** 요청 기간의 박마다 성수기/주말을 판정해 칸을 고르고(없으면 가까운 칸으로 대체) 평균 1박 요금을 낸다. */
export function priceForStay(stats: FeeStats, q: TripQuery): number | undefined {
  const nights: { peak: boolean; weekend: boolean }[] = [];
  for (let t = Date.parse(q.startDate); t < Date.parse(q.endDate); t += 86_400_000) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    nights.push({ peak: PEAK_MONTHS.includes(d.getUTCMonth() + 1), weekend: dow === 5 || dow === 6 }); // 금·토 숙박
  }
  if (!nights.length) return undefined;
  const pick = (peak: boolean, weekend: boolean): number | undefined => {
    const order: FeeKey[] = [
      `${peak ? "peak" : "off"}${weekend ? "Weekend" : "Weekday"}`,
      `${peak ? "peak" : "off"}${weekend ? "Weekday" : "Weekend"}`,
      `${peak ? "off" : "peak"}${weekend ? "Weekend" : "Weekday"}`,
      `${peak ? "off" : "peak"}${weekend ? "Weekday" : "Weekend"}`,
    ] as FeeKey[];
    for (const k of order) {
      const f = stats.fees[k];
      if (f && f.n >= MIN_FIELD_N) return f.median;
    }
    return undefined;
  };
  const prices = nights.map((n) => pick(n.peak, n.weekend));
  if (prices.some((p) => p === undefined)) return undefined;
  const avg = (prices as number[]).reduce((a, b) => a + b, 0) / prices.length;
  return Math.round(avg / 1000) * 1000;
}

export type TourApiLodging = LodgingProvider & {
  /** 국내 목적지 중 캐시가 없거나 오래된 곳의 공시 요금을 수집한다(느리므로 서버 시작 시 백그라운드로 호출). */
  warmUp(dests: Destination[]): Promise<void>;
};

/**
 * TourAPI 숙박(searchStay2 + detailInfo2)의 공시 요금(비수기/성수기 × 주중/주말 객실 최저요금)으로
 * 지역별 1박 요금 중앙값을 낸다. 한계: 실시간 가격·잔여 객실이 아니고, 요금이 기재된 숙소만(약 1/4) 반영되며,
 * "최저 요금" 기준이라 실제보다 낮게 나오는 편향이 있다. 수집 전/실패 시에는 fallback 으로 대체하고 평점은 항상 fallback.
 */
export function createTourApiLodging(
  serviceKey: string,
  fallback: LodgingProvider,
  opts: { fetchFn?: Fetch; store?: LodgingStore; now?: () => number; log?: (msg: string) => void } = {},
): TourApiLodging {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => {});
  const key = serviceKey.includes("%") ? decodeURIComponent(serviceKey) : serviceKey;
  const entries: Record<string, Entry> = opts.store?.load() ?? {};
  const inflight = new Map<string, Promise<void>>();

  const url = (op: string, p: Record<string, string>) =>
    `${BASE}/${op}?${new URLSearchParams({ serviceKey: key, MobileOS: "ETC", MobileApp: "TravelRec", _type: "json", ...p })}`;
  const itemsOf = (j: any): any[] => {
    const it = j?.response?.body?.items?.item;
    return Array.isArray(it) ? it : it ? [it] : [];
  };
  const ok = (j: any, label: string) => {
    if (j?.response?.header?.resultCode !== "0000") throw new Error(`${label} resultCode=${j?.response?.header?.resultCode}`);
    return j;
  };

  async function collect(dest: Destination): Promise<FeeStats> {
    const region = REGIONS[dest.id];
    // 1) 지역 전체 숙소 목록
    const props: { id: string }[] = [];
    for (let page = 1; page <= 8; page++) {
      const j = ok(await getJsonWithRetry(fetchFn, url("searchStay2", { lDongRegnCd: region.regionCode, numOfRows: "100", pageNo: String(page) }), "tourapi-stay"), "tourapi-stay");
      for (const it of itemsOf(j)) if (!region.city || (it.addr1 ?? "").includes(region.city)) props.push({ id: String(it.contentid) });
      if (page * 100 >= Number(j.response.body?.totalCount ?? 0)) break;
    }
    if (!props.length) throw new Error("no lodging listed");
    // 2) 균등 표본의 객실 요금 상세
    const sample = strideSample(props.sort((a, b) => a.id.localeCompare(b.id)), SAMPLE_SIZE);
    const perKey: Record<FeeKey, number[]> = { offWeekday: [], offWeekend: [], peakWeekday: [], peakWeekend: [] };
    let done = 0;
    let failed = 0;
    await pool(sample, CONCURRENCY, async (p) => {
      try {
        const j = ok(await getJsonWithRetry(fetchFn, url("detailInfo2", { contentId: p.id, contentTypeId: "32" }), "tourapi-stay"), "tourapi-stay");
        const rooms = itemsOf(j);
        done++;
        for (const k of Object.keys(FEE_FIELDS) as FeeKey[]) {
          const fees = rooms.map((r) => Number(r[FEE_FIELDS[k]])).filter((v) => v >= MIN_FEE && v <= MAX_FEE);
          if (fees.length) perKey[k].push(Math.min(...fees)); // 숙소당 객실 최저요금 1개
        }
      } catch {
        failed++;
      }
    });
    if (failed > sample.length / 2) throw new Error(`detail failures ${failed}/${sample.length}`);
    const fees: FeeStats["fees"] = {};
    for (const k of Object.keys(perKey) as FeeKey[]) if (perKey[k].length) fees[k] = { median: Math.round(median(perKey[k])), n: perKey[k].length };
    return { sampled: done, total: props.length, fees }; // total: 시 이름으로 거른 뒤의 등록 숙소 수(도 전체 수 아님)
  }

  function refresh(dest: Destination): Promise<void> {
    const running = inflight.get(dest.id);
    if (running) return running;
    const p = (async () => {
      try {
        const stats = await collect(dest);
        entries[dest.id] = { at: now(), stats };
        opts.store?.save(entries);
        log(`lodging ${dest.id}: sampled ${stats.sampled}/${stats.total}, priced ${Object.entries(stats.fees).map(([k, v]) => `${k}=${v.n}`).join(",")}`);
      } catch (e) {
        log(`lodging ${dest.id} refresh failed: ${(e as Error).message}`); // 기존 캐시는 유지
      } finally {
        inflight.delete(dest.id);
      }
    })();
    inflight.set(dest.id, p);
    return p;
  }

  return {
    async perNightKRW(dest: Destination, q: TripQuery): Promise<Sourced<number>> {
      if (!dest.domestic || !REGIONS[dest.id]) return fallback.perNightKRW(dest, q);
      const e = entries[dest.id];
      if (!e || now() - e.at > REFRESH_MS) void refresh(dest); // 요청을 막지 않고 백그라운드 갱신
      if (!e) return fallback.perNightKRW(dest, q);
      const price = priceForStay(e.stats, q);
      if (price === undefined) return fallback.perNightKRW(dest, q);
      const n = Math.max(...Object.values(e.stats.fees).map((f) => f.n));
      return {
        value: price,
        source: `TourAPI 숙박 공시요금 지역 중앙값(객실 최저요금 기준, 요금 기재 숙소 ${n}곳) — 실시간 가격 아님`,
        asOf: new Date(e.at).toISOString(),
        estimated: true,
      };
    },
    rating: (dest) => fallback.rating(dest),
    async warmUp(dests: Destination[]) {
      for (const d of dests) {
        const e = entries[d.id];
        if (d.domestic && REGIONS[d.id] && (!e || now() - e.at > REFRESH_MS)) await refresh(d); // 호출량 억제를 위해 지역 순차 수집
      }
    },
  };
}
