import type { Destination, Sourced } from "../types.js";
import type { TripQuery, WeatherProvider } from "./types.js";

type Fetch = typeof fetch;

const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString().slice(0, 10);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Open-Meteo(키 불필요).
 *  - 오늘부터 15일 이내 여행: 예보 API
 *  - 그 이후: 최근 3년 같은 기간 실측(archive)으로 기후 평년값 계산 (비 온 날 비율 = 강수확률 근사)
 * 호출 실패 시 fallback Provider 로 대체해 추천 자체는 중단되지 않게 한다.
 */
export function createOpenMeteoWeather(fallback: WeatherProvider, fetchFn: Fetch = fetch, today = () => new Date()): WeatherProvider {
  async function json(url: string) {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
    return (await res.json()) as { daily?: Record<string, (number | null)[]> };
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
