import type { Destination, Sourced } from "../types.js";
import type { TripQuery, WeatherProvider } from "./types.js";

type Fetch = typeof fetch;

const MAX_CONCURRENT = 4;
const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 3_000;
const ARCHIVE_TTL_MS = 24 * 3_600_000;
const FORECAST_TTL_MS = 3 * 3_600_000;
const MAX_CACHE = 500;
const MAX_BLOCK_MS = 30 * 60_000; // 한도 초과 시 최대 30분간 호출 중단
class Fatal extends Error {}

const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString().slice(0, 10);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Open-Meteo(키 불필요).
 *  - 오늘부터 15일 이내 여행: 예보 API
 *  - 그 이후: 최근 3년 같은 기간 실측(archive)으로 기후 평년값 계산 (비 온 날 비율 = 강수확률 근사)
 * 호출 실패 시 fallback Provider 로 대체해 추천 자체는 중단되지 않게 한다.
 */
export function createOpenMeteoWeather(
  fallback: WeatherProvider,
  fetchFn: Fetch = fetch,
  today = () => new Date(),
  opts: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): WeatherProvider {
  type Daily = { daily?: Record<string, (number | null)[]> };
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());

  // 1) 동시 요청 제한: /recommend 는 목적지 10곳이 평년값 3회씩 동시에 요청해 429(요청 과다)를 맞기 쉽다
  let active = 0;
  const waiting: (() => void)[] = [];
  async function limited<T>(task: () => Promise<T>): Promise<T> {
    if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  }

  // 2) 429/5xx/연결 오류는 백오프 후 재시도(Retry-After 존중, 최대 MAX_WAIT_MS). 그 외 4xx 는 즉시 실패
  // 4) 차단기: Retry-After 가 길면(일일 한도 초과 등) 기다려도 소용없으므로 그 시간 동안은 호출하지 않고 바로 fallback 한다.
  //    (무료 한도는 IP 당 하루 1만 회라 공용 IP·반복 호출에서 소진될 수 있다)
  let blockedUntil = 0;
  async function fetchJson(url: string): Promise<Daily> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (now() < blockedUntil) throw new Fatal("open-meteo blocked: rate limit");
      let wait = 400 * 2 ** attempt;
      try {
        const res = await fetchFn(url);
        if (res.ok) return (await res.json()) as Daily;
        if (res.status !== 429 && res.status < 500) throw new Fatal(`open-meteo HTTP ${res.status}`);
        const ra = Number(res.headers.get("retry-after"));
        if (Number.isFinite(ra) && ra > 0) wait = ra * 1000;
        if (res.status === 429 && wait > MAX_WAIT_MS) {
          blockedUntil = now() + Math.min(wait, MAX_BLOCK_MS);
          throw new Fatal("open-meteo rate limit exceeded");
        }
        lastErr = new Error(`open-meteo HTTP ${res.status}`);
      } catch (e) {
        if (e instanceof Fatal) throw e;
        lastErr = e; // 연결 reset 등
      }
      if (attempt < MAX_ATTEMPTS - 1) await sleep(Math.min(wait, MAX_WAIT_MS));
    }
    throw lastErr;
  }

  // 3) URL 별 캐시(+진행 중 요청 공유): 같은 좌표·기간이면 재호출하지 않는다. 평년값은 하루, 예보는 몇 시간.
  const cache = new Map<string, { at: number; data: Daily }>();
  const inflight = new Map<string, Promise<Daily>>();
  async function json(url: string): Promise<Daily> {
    const ttl = url.includes("archive-api") ? ARCHIVE_TTL_MS : FORECAST_TTL_MS;
    const hit = cache.get(url);
    if (hit && now() - hit.at < ttl) return hit.data;
    const running = inflight.get(url);
    if (running) return running;
    const p = limited(() => fetchJson(url))
      .then((data) => {
        cache.set(url, { at: now(), data });
        if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string); // 오래된 것부터 제거
        return data;
      })
      .finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }
  const clean = (xs: (number | null)[] | undefined) => (xs ?? []).filter((x): x is number => typeof x === "number");

  return {
    async forecast(dest: Destination, q: TripQuery): Promise<Sourced<{ avgTempC: number; rainProb: number }>> {
      try {
        const now = today().toISOString().slice(0, 10);
        const loc = `latitude=${dest.lat}&longitude=${dest.lon}&timezone=auto`;
        if (q.startDate >= now && q.endDate <= addDays(now, 15)) {
          const j = await json(`https://api.open-meteo.com/v1/forecast?${loc}&daily=temperature_2m_mean,precipitation_probability_max&start_date=${q.startDate}&end_date=${q.endDate}`);
          const t = clean(j.daily?.temperature_2m_mean);
          const p = clean(j.daily?.precipitation_probability_max);
          if (!t.length) throw new Error("empty forecast");
          return { value: { avgTempC: round1(mean(t)), rainProb: p.length ? round2(mean(p) / 100) : 0.3 }, source: "open-meteo forecast", asOf: new Date().toISOString(), estimated: false };
        }
        const temps: number[] = [];
        const rainDays: number[] = [];
        const y = Number(q.startDate.slice(0, 4));
        for (const back of [1, 2, 3]) {
          const s = q.startDate.replace(String(y), String(y - back));
          const e = q.endDate.replace(q.endDate.slice(0, 4), String(Number(q.endDate.slice(0, 4)) - back));
          const j = await json(`https://archive-api.open-meteo.com/v1/archive?${loc}&daily=temperature_2m_mean,precipitation_sum&start_date=${s}&end_date=${e}`);
          temps.push(...clean(j.daily?.temperature_2m_mean));
          rainDays.push(...clean(j.daily?.precipitation_sum).map((mm) => (mm >= 1 ? 1 : 0)));
        }
        if (!temps.length) throw new Error("empty archive");
        return { value: { avgTempC: round1(mean(temps)), rainProb: round2(mean(rainDays)) }, source: "open-meteo 최근3년 평년값", asOf: new Date().toISOString(), estimated: true };
      } catch {
        return fallback.forecast(dest, q);
      }
    },
  };
}
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
