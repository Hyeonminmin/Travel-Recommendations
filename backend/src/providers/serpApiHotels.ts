import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Destination, Sourced } from "../types.js";
import type { LodgingProvider, TripQuery } from "./types.js";

type Fetch = typeof fetch;

const ENDPOINT = "https://serpapi.com/search.json";
/** 목적지 → Google Hotels 검색어(영문이 결과가 안정적). 해외 6곳. */
const QUERY: Record<string, string> = { tokyo: "Tokyo", osaka: "Osaka", fukuoka: "Fukuoka", bangkok: "Bangkok", danang: "Da Nang", taipei: "Taipei" };

const CACHE_MS = 30 * 24 * 3_600_000; // 월 단위 시세라 30일 유지
const FAIL_COOLDOWN_MS = 3_600_000; // 실패한 키는 1시간 동안 다시 호출하지 않음(호출당 한도 소모 방지)
const DEFAULT_MONTHLY_BUDGET = 150; // 무료 플랜 월 250회 중 여유를 남긴다
const MIN_PRICED = 5; // 가격이 있는 숙소가 이보다 적으면 신뢰하지 않음
const STAY_NIGHTS = 2;

export interface HotelEntry {
  at: number;
  checkIn: string;
  medianNightKRW: number; // 2인 1실 1박, 호텔 유형 중앙값(호텔이 5곳 미만이면 전체)
  ratingMedian: number | null;
  n: number; // 중앙값에 쓰인 숙소 수
}
export interface HotelState {
  entries: Record<string, HotelEntry>; // key = `${destId}|${YYYY-MM}`
  usage: { month: string; count: number }; // SerpAPI 호출 수(달력 월, UTC)
}
export interface HotelStore {
  load(): HotelState | undefined;
  save(s: HotelState): void;
}

export function createHotelFileStore(path: string): HotelStore {
  return {
    load() {
      try {
        return JSON.parse(readFileSync(path, "utf-8"));
      } catch {
        return undefined;
      }
    },
    save(s) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(s));
      } catch {
        /* 캐시 저장 실패는 무시 */
      }
    },
  };
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ymOf = (ms: number) => iso(ms).slice(0, 7);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * 월 대표 표본 숙박: 15일에 가장 가까운 목요일 체크인 2박(목·금 숙박이 섞임).
 * 이미 지난 날짜면 그 달에 남은 첫 목요일(내일 이후), 그것도 없으면 undefined.
 */
export function sampleStay(ym: string, nowMs: number): { checkIn: string; checkOut: string } | undefined {
  const [y, m] = ym.split("-").map(Number);
  const fifteenth = Date.UTC(y, m - 1, 15);
  const dow = new Date(fifteenth).getUTCDay();
  let ci = fifteenth + (((4 - dow + 3 + 7) % 7) - 3) * 86_400_000; // 가장 가까운 목요일
  const earliest = Date.parse(iso(nowMs)) + 2 * 86_400_000; // 오늘+2일 이후만 조회
  if (ci < earliest) {
    ci = earliest + ((((4 - new Date(earliest).getUTCDay()) % 7) + 7) % 7) * 86_400_000;
    if (ymOf(ci) !== ym) return undefined;
  }
  return { checkIn: iso(ci), checkOut: iso(ci + STAY_NIGHTS * 86_400_000) };
}

export type SerpApiHotels = LodgingProvider & {
  /** 해외 목적지 중 다음 달 항목이 없는 곳을 수집한다(평점 확보용). 한도 보호 로직을 그대로 따른다. */
  warmUp(dests: Destination[]): Promise<void>;
  /** 진행 중인 수집이 모두 끝날 때까지 기다린다(테스트·종료용). */
  settle(): Promise<void>;
};

/**
 * SerpAPI Google Hotels 기반 해외 숙소 1박 요금·평점 Provider. 국내는 fallback 으로 위임한다.
 * 검색 결과 상위 20곳(관련도순)의 중앙값이라 "시세 추정"이며 실시간 가격·예약 사이트별 가격이 아니다.
 * 월 호출 한도가 작아 (목적지, 월) 단위로 캐시하고, 월 사용량 상한과 실패 쿨다운으로 호출을 아낀다.
 * 수집 전·실패·한도 초과 시에는 fallback(샘플값)을 쓴다.
 */
export function createSerpApiHotels(
  apiKey: string,
  fallback: LodgingProvider,
  opts: { fetchFn?: Fetch; store?: HotelStore; now?: () => number; monthlyBudget?: number; log?: (msg: string) => void } = {},
): SerpApiHotels {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const budget = opts.monthlyBudget ?? DEFAULT_MONTHLY_BUDGET;
  const log = opts.log ?? (() => {});
  const state: HotelState = opts.store?.load() ?? { entries: {}, usage: { month: ymOf(now()), count: 0 } };
  const inflight = new Map<string, Promise<void>>();
  const failedAt = new Map<string, number>();
  let tail: Promise<unknown> = Promise.resolve(); // 호출은 한 번에 하나씩

  const persist = () => opts.store?.save(state);
  const key = (d: Destination, ym: string) => `${d.id}|${ym}`;
  const supported = (d: Destination) => !d.domestic && !!QUERY[d.id];

  /** 연결 오류(응답 전 실패)에만 1회 재시도한다. 응답을 받은 오류는 이미 한도가 소모됐을 수 있어 재시도하지 않는다. */
  async function call(url: string): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (state.usage.month !== ymOf(now())) state.usage = { month: ymOf(now()), count: 0 };
      state.usage.count++;
      persist();
      let res: Response;
      try {
        res = await fetchFn(url);
      } catch (e) {
        if (attempt === 1) throw e;
        continue;
      }
      if (!res.ok) throw new Error(`serpapi HTTP ${res.status}`);
      return res.json();
    }
  }

  async function collect(dest: Destination, ym: string): Promise<HotelEntry | undefined> {
    const stay = sampleStay(ym, now());
    if (!stay) throw new Error(`no future sample date in ${ym}`);
    const q = new URLSearchParams({
      engine: "google_hotels", q: `${QUERY[dest.id]} hotels`, check_in_date: stay.checkIn, check_out_date: stay.checkOut,
      adults: "2", currency: "KRW", gl: "kr", hl: "ko", api_key: apiKey,
    });
    const j = await call(`${ENDPOINT}?${q}`);
    if (j?.error || j?.search_metadata?.status !== "Success") throw new Error(`serpapi: ${String(j?.error ?? j?.search_metadata?.status).slice(0, 80)}`);
    const props: any[] = (j.properties ?? []).filter((p: any) => typeof p?.rate_per_night?.extracted_lowest === "number" && p.rate_per_night.extracted_lowest > 0);
    const hotels = props.filter((p) => p.type === "hotel");
    const used = hotels.length >= MIN_PRICED ? hotels : props;
    if (used.length < MIN_PRICED) throw new Error(`too few priced properties (${used.length})`);
    const ratings = used.map((p) => p.overall_rating).filter((r: unknown): r is number => typeof r === "number" && r > 0);
    return {
      at: now(),
      checkIn: stay.checkIn,
      medianNightKRW: Math.round(median(used.map((p) => p.rate_per_night.extracted_lowest)) / 1000) * 1000,
      ratingMedian: ratings.length >= MIN_PRICED ? Math.round(median(ratings) * 100) / 100 : null,
      n: used.length,
    };
  }

  function refresh(dest: Destination, ym: string): Promise<void> {
    const k = key(dest, ym);
    const running = inflight.get(k);
    if (running) return running;
    if (now() - (failedAt.get(k) ?? -Infinity) < FAIL_COOLDOWN_MS) return Promise.resolve();
    const job = async () => {
      if (state.usage.month !== ymOf(now())) state.usage = { month: ymOf(now()), count: 0 };
      if (state.usage.count >= budget) {
        log(`serpapi ${k}: monthly budget reached (${state.usage.count}/${budget}), skipped`);
        return;
      }
      try {
        const e = await collect(dest, ym);
        if (e) {
          state.entries[k] = e;
          persist();
          log(`serpapi ${k}: median ${e.medianNightKRW} from ${e.n} properties, usage ${state.usage.count}/${budget}`);
        }
      } catch (err) {
        failedAt.set(k, now());
        log(`serpapi ${k} failed: ${(err as Error).message}`); // URL(키 포함)은 로그에 남기지 않는다
      }
    };
    const p = tail.then(job, job).finally(() => inflight.delete(k)) as Promise<void>;
    tail = p.catch(() => {});
    inflight.set(k, p);
    return p;
  }

  const SRC = "Google Hotels 검색 결과(SerpAPI)";
  const latestFor = (dest: Destination) =>
    Object.entries(state.entries).filter(([k]) => k.startsWith(`${dest.id}|`)).map(([, e]) => e).sort((a, b) => b.at - a.at)[0];

  return {
    async perNightKRW(dest: Destination, q: TripQuery): Promise<Sourced<number>> {
      if (!supported(dest)) return fallback.perNightKRW(dest, q);
      const ym = q.startDate.slice(0, 7); // 여행이 달을 넘겨도 시작 월 기준
      const e = state.entries[key(dest, ym)];
      if (!e || now() - e.at > CACHE_MS) void refresh(dest, ym); // 요청을 막지 않고 백그라운드 수집
      if (!e) return fallback.perNightKRW(dest, q);
      return {
        value: e.medianNightKRW,
        source: `${SRC} ${ym} 상위 ${e.n}곳 중앙값(2인 1실, ${e.checkIn} 체크인 2박 표본) — 실시간 가격 아님`,
        asOf: new Date(e.at).toISOString(),
        estimated: true,
      };
    },
    async rating(dest: Destination): Promise<Sourced<number>> {
      if (!supported(dest)) return fallback.rating(dest);
      const e = latestFor(dest);
      if (!e) void refresh(dest, ymOf(now() + 30 * 86_400_000)); // 평점 확보를 위해 다음 달 1회 수집
      if (!e || e.ratingMedian === null) return fallback.rating(dest);
      return { value: e.ratingMedian, source: `${SRC} 상위 ${e.n}곳 평점 중앙값`, asOf: new Date(e.at).toISOString(), estimated: true };
    },
    async warmUp(dests: Destination[]) {
      const ym = ymOf(now() + 30 * 86_400_000);
      for (const d of dests) if (supported(d) && !state.entries[key(d, ym)]) await refresh(d, ym);
    },
    async settle() {
      while (inflight.size) await Promise.all([...inflight.values()]);
    },
  };
}
