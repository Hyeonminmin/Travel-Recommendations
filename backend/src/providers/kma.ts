import type { Destination, Sourced } from "../types.js";
import { loadMid } from "./kmaMid.js";
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
interface Day { tempC?: number; pop?: number }
const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * 국내 날씨 = 기상청 단기예보(~5일) + 중기예보(4~10일) 로 덮이는 날은 예보, 나머지 날은 fallback(최근 3년 평년값 등)을
 * 덮인 일수 비율만큼 가중해 섞는다. 예보가 하나도 없거나 해외/오류면 fallback 그대로.
 */
export function createKmaWeather(serviceKey: string, fallback: WeatherProvider, fetchFn: Fetch = fetch, now = () => new Date()): WeatherProvider {
  const key = normalizeServiceKey(serviceKey);
  async function load(nx: number, ny: number, base: { date: string; time: string }): Promise<Row[]> {
    const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?${new URLSearchParams({
      serviceKey: key, pageNo: "1", numOfRows: "1000", dataType: "JSON", base_date: base.date, base_time: base.time, nx: String(nx), ny: String(ny),
    })}`;
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      if (i) await new Promise((r) => setTimeout(r, 400 * i)); // 서버가 연결을 연달아 끊는 경우가 있어 간격을 둠
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
        const nowD = now();
        const tripDates: string[] = [];
        for (let t = Date.parse(q.startDate); t <= Date.parse(q.endDate); t += 86_400_000) tripDates.push(new Date(t).toISOString().slice(0, 10));
        const byDay: Record<string, Day> = {};
        let shortDays = 0;

        // 1) 단기예보(우선)
        try {
          const { nx, ny } = toGrid(dest.lat, dest.lon);
          const rows = (await load(nx, ny, latestBase(nowD))).filter((r) => tripDates.includes(iso(r.fcstDate)));
          for (const d of new Set(rows.map((r) => r.fcstDate))) {
            const num = (c: string) => rows.filter((r) => r.fcstDate === d && r.category === c).map((r) => Number(r.fcstValue)).filter(Number.isFinite);
            const t = num("TMP"), p = num("POP");
            if (t.length) { byDay[iso(d)] = { tempC: mean(t), pop: p.length ? mean(p) / 100 : undefined }; shortDays++; }
          }
        } catch { /* 단기예보 실패 → 중기/평년값으로 진행 */ }

        // 2) 중기예보(단기가 덮지 못한 날만)
        let midDays = 0;
        const mid = tripDates.some((d) => !byDay[d]) ? await loadMid(key, dest.id, nowD, fetchFn) : {};
        for (const d of tripDates) {
          if (byDay[d] || !mid[d] || mid[d].tempC === undefined) continue;
          byDay[d] = mid[d];
          midDays++;
        }

        const covered = shortDays + midDays;
        if (!covered) return fallback.forecast(dest, q);
        const days = Object.values(byDay);
        const temps = days.map((x) => x.tempC).filter((x): x is number => x !== undefined);
        const pops = days.map((x) => x.pop).filter((x): x is number => x !== undefined);
        let temp = mean(temps);
        let pop = pops.length ? mean(pops) : 0.3;
        const cov = covered / tripDates.length;
        const parts = [shortDays ? `단기${shortDays}일` : "", midDays ? `중기${midDays}일` : ""].filter(Boolean).join("+");
        let source = `기상청 예보(${parts}/${tripDates.length}일)`;
        let estimated = false;
        if (cov < 1) {
          // 예보가 덮지 못한 날은 과거(평년값) 기록으로 보충: 일수 비율 가중 평균
          const hist = await fallback.forecast(dest, q);
          temp = cov * temp + (1 - cov) * hist.value.avgTempC;
          pop = cov * pop + (1 - cov) * hist.value.rainProb;
          source += ` + 나머지 ${hist.source}`;
          estimated = true;
        }
        return { value: { avgTempC: round1(temp), rainProb: round2(pop) }, source, asOf: nowD.toISOString(), estimated };
      } catch {
        return fallback.forecast(dest, q);
      }
    },
  };
}
