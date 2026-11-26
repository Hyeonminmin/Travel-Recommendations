import type { Destination, Sourced } from "../types.js";
import type { TripQuery, WeatherProvider } from "./types.js";

type Fetch = typeof fetch;

const ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";
const COVERAGE_DAYS = 3; // 단기예보는 발표일 기준 약 +3일 23시까지
const BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23]; // 발표 시각(KST). 실제 제공은 발표 약 10분 후

const pad = (n: number) => String(n).padStart(2, "0");
const kst = (d: Date) => new Date(d.getTime() + 9 * 3_600_000); // UTC getter 로 KST 값을 읽기 위한 이동
const ymdOf = (k: Date) => `${k.getUTCFullYear()}${pad(k.getUTCMonth() + 1)}${pad(k.getUTCDate())}`;
const isoOf = (k: Date) => `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 위경도 → 기상청 격자(nx, ny). 기상청 공식 Lambert Conformal Conic 변환식. */
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

/** 지금(KST) 기준 조회 가능한 가장 최근 발표 시각. 발표 후 10분 미만이면 직전 회차를 쓴다. */
export function latestBase(now: Date): { baseDate: string; baseTime: string } {
  const k = kst(new Date(now.getTime() - 10 * 60_000));
  const h = k.getUTCHours();
  const hour = [...BASE_HOURS].reverse().find((b) => b <= h);
  if (hour === undefined) {
    const prev = new Date(k.getTime() - 86_400_000); // 02시 이전 → 전날 23시 발표분
    return { baseDate: ymdOf(prev), baseTime: "2300" };
  }
  return { baseDate: ymdOf(k), baseTime: `${pad(hour)}00` };
}

interface FcstItem { category: string; fcstDate: string; fcstValue: string }

/**
 * 기상청 단기예보(getVilageFcst). 국내 목적지이면서 여행 전체가 발표일~+3일 안에 들어올 때만 사용하고,
 * 그 밖(먼 날짜·해외)이나 호출 실패는 fallback(Open-Meteo→Mock 체인)으로 넘긴다.
 *  - 기온: 시간별 TMP 평균, 강수확률: 날짜별 POP 최댓값의 평균 (Open-Meteo 쪽과 같은 정의)
 */
export function createKmaWeather(serviceKey: string, fallback: WeatherProvider, fetchFn: Fetch = fetch, today = () => new Date()): WeatherProvider {
  const key = serviceKey.includes("%") ? decodeURIComponent(serviceKey) : serviceKey;

  async function getJson(url: string): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`kma HTTP ${res.status}`);
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("kma non-JSON response"); // 오류를 XML 로 주는 경우
        }
      } catch (e) {
        lastErr = e; // 연결 reset 등 일시 오류 1회 재시도
      }
    }
    throw lastErr;
  }

  async function fetchAll(dest: Destination, baseDate: string, baseTime: string): Promise<FcstItem[]> {
    const { nx, ny } = toGrid(dest.lat, dest.lon);
    const out: FcstItem[] = [];
    for (let page = 1; page <= 3; page++) {
      const q = new URLSearchParams({ serviceKey: key, pageNo: String(page), numOfRows: "1000", dataType: "JSON", base_date: baseDate, base_time: baseTime, nx: String(nx), ny: String(ny) });
      const j = await getJson(`${ENDPOINT}?${q}`);
      const header = j?.response?.header;
      if (header?.resultCode !== "00") throw new Error(`kma resultCode=${header?.resultCode}`);
      const body = j.response.body;
      const items = body?.items?.item;
      out.push(...(Array.isArray(items) ? items : items ? [items] : []));
      if (page * 1000 >= Number(body?.totalCount ?? 0)) break;
    }
    return out;
  }

  return {
    async forecast(dest: Destination, q: TripQuery): Promise<Sourced<{ avgTempC: number; rainProb: number }>> {
      const now = today();
      const todayKst = kst(now);
      const lastDay = isoOf(new Date(todayKst.getTime() + COVERAGE_DAYS * 86_400_000));
      if (!dest.domestic || q.startDate < isoOf(todayKst) || q.endDate > lastDay) return fallback.forecast(dest, q);
      try {
        const { baseDate, baseTime } = latestBase(now);
        const items = await fetchAll(dest, baseDate, baseTime);
        const inTrip = (it: FcstItem) => it.fcstDate >= q.startDate.replaceAll("-", "") && it.fcstDate <= q.endDate.replaceAll("-", "");
        const temps = items.filter((i) => i.category === "TMP" && inTrip(i)).map((i) => Number(i.fcstValue)).filter(Number.isFinite);
        if (!temps.length) throw new Error("empty forecast");
        const popByDay = new Map<string, number>();
        for (const i of items) {
          if (i.category !== "POP" || !inTrip(i)) continue;
          const v = Number(i.fcstValue);
          if (Number.isFinite(v)) popByDay.set(i.fcstDate, Math.max(popByDay.get(i.fcstDate) ?? 0, v));
        }
        const rainProb = popByDay.size ? Math.round(mean([...popByDay.values()])) / 100 : 0.3;
        return {
          value: { avgTempC: Math.round(mean(temps) * 10) / 10, rainProb },
          source: `기상청 단기예보(${baseDate} ${baseTime} 발표)`,
          asOf: now.toISOString(),
          estimated: false,
        };
      } catch {
        return fallback.forecast(dest, q);
      }
    },
  };
}
