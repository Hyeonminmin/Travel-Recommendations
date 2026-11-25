import type { Destination, Sourced } from "../types.js";
import { normalizeServiceKey } from "./tourApi.js";
import type { TripQuery, WeatherProvider } from "./types.js";

type Fetch = typeof fetch;

/** 위경도 → 기상청 격자(nx, ny). 기상청 공개 Lambert Conformal Conic 변환식. */
export function toGrid(lat: number, lon: number): { nx: number; ny: number } {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const D = Math.PI / 180;
  const re = RE / GRID, slat1 = SLAT1 * D, slat2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * D - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

const BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];
/** KST 기준 가장 최근 발표 시각(발표 후 약 10분 뒤부터 제공). */
export function latestBase(now: Date): { date: string; time: string } {
  const kst = new Date(now.getTime() + 9 * 3_600_000 - 10 * 60_000); // 10분 지연 반영
  let hour = [...BASE_HOURS].reverse().find((h) => h <= kst.getUTCHours());
  let d = kst;
  if (hour === undefined) { hour = 23; d = new Date(kst.getTime() - 86_400_000); }
  return { date: d.toISOString().slice(0, 10).replace(/-/g, ""), time: String(hour).padStart(2, "0") + "00" };
}

interface Row { category: string; fcstDate: string; fcstValue: string }

/**
 * 기상청 단기예보(국내, 발표 시점 기준 약 3~5일). 여행 일수의 절반 이상을 예보가 덮을 때만 사용하고,
 * 그 외(먼 날짜/해외/실패)는 fallback(Open-Meteo 등)에 맡긴다.
 */
export function createKmaWeather(serviceKey: string, fallback: WeatherProvider, fetchFn: Fetch = fetch, now = () => new Date()): WeatherProvider {
  const key = normalizeServiceKey(serviceKey);
  async function load(nx: number, ny: number, base: { date: string; time: string }): Promise<Row[]> {
    const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${new URLSearchParams({
      serviceKey: key, pageNo: "1", numOfRows: "1000", dataType: "JSON", base_date: base.date, base_time: base.time, nx: String(nx), ny: String(ny),
    })}`;
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`kma HTTP ${res.status}`);
        const j = JSON.parse(await res.text());
        if (j?.response?.header?.resultCode !== "00") throw new Error(`kma ${j?.response?.header?.resultCode}`);
        const item = j?.response?.body?.items?.item;
        return Array.isArray(item) ? item : item ? [item] : [];
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  return {
    async forecast(dest: Destination, q: TripQuery): Promise<Sourced<{ avgTempC: number; rainProb: number }>> {
      if (!dest.domestic) return fallback.forecast(dest, q);
      try {
        const { nx, ny } = toGrid(dest.lat, dest.lon);
        const rows = await load(nx, ny, latestBase(now()));
        const dayIn = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` >= q.startDate && `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` <= q.endDate;
        const inRange = rows.filter((r) => dayIn(r.fcstDate));
        const days = new Set(inRange.map((r) => r.fcstDate));
        const tripDays = Math.max(1, Math.round((Date.parse(q.endDate) - Date.parse(q.startDate)) / 86_400_000) + 1);
        if (days.size * 2 < tripDays) return fallback.forecast(dest, q);
        const nums = (cat: string) => inRange.filter((r) => r.category === cat).map((r) => Number(r.fcstValue)).filter((n) => Number.isFinite(n));
        const tmp = nums("TMP"), pop = nums("POP");
        if (!tmp.length) return fallback.forecast(dest, q);
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        return {
          value: { avgTempC: Math.round(mean(tmp) * 10) / 10, rainProb: pop.length ? Math.round(mean(pop)) / 100 : 0.3 },
          source: `기상청 단기예보(${days.size}/${tripDays}일)`,
          asOf: new Date().toISOString(),
          estimated: days.size < tripDays,
        };
      } catch {
        return fallback.forecast(dest, q);
      }
    },
  };
}
