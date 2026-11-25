import type { Destination, Sourced } from "../types.js";
import { normalizeServiceKey } from "./tourApi.js";
import type { TripQuery, WeatherProvider } from "./types.js";

type Fetch = typeof fetch;

/** 도착지 id → 기상청 ASOS 관측소 번호 */
export const ASOS_STATION: Record<string, string> = { jeju: "184", busan: "159", gangneung: "105", yeosu: "168" };

interface Row { tm?: string; avgTa?: string; sumRn?: string; ddMes?: string }

/** 같은 월일의 N년 전 날짜 (2/29 는 2/28 로 보정) */
export function yearsBack(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4)) - n;
  const md = iso.slice(5);
  return `${y}-${md === "02-29" ? "02-28" : md}`;
}

/**
 * 기상청 ASOS 일자료 기반 평년값(국내). 최근 3년 같은 기간의 평균기온과 강수일 비율(0.1mm 이상 또는 신적설 = 강수일;
 * 응답에서 sumRn 이 빈 문자열이면 무강수)로 계산. 해외·실패는 fallback.
 */
export function createAsosClimatology(serviceKey: string, fallback: WeatherProvider, fetchFn: Fetch = fetch, today = () => new Date()): WeatherProvider {
  const key = normalizeServiceKey(serviceKey);
  async function load(stn: string, s: string, e: string): Promise<Row[]> {
    const url = `https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList?${new URLSearchParams({
      serviceKey: key, pageNo: "1", numOfRows: "400", dataType: "JSON", dataCd: "ASOS", dateCd: "DAY",
      startDt: s.replace(/-/g, ""), endDt: e.replace(/-/g, ""), stnIds: stn,
    })}`;
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      if (i) await new Promise((r) => setTimeout(r, 400 * i));
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`asos HTTP ${res.status}`);
        const j = JSON.parse(await res.text());
        if (j?.response?.header?.resultCode !== "00") throw new Error("asos not ok");
        const it = j.response.body?.items?.item;
        return Array.isArray(it) ? it : it ? [it] : [];
      } catch (e2) { last = e2; }
    }
    throw last;
  }

  return {
    async forecast(dest: Destination, q: TripQuery): Promise<Sourced<{ avgTempC: number; rainProb: number }>> {
      const stn = dest.domestic ? ASOS_STATION[dest.id] : undefined;
      if (!stn) return fallback.forecast(dest, q);
      try {
        const temps: number[] = [];
        const rain: number[] = [];
        const todayIso = today().toISOString().slice(0, 10);
        for (const back of [1, 2, 3]) {
          const s = yearsBack(q.startDate, back), e = yearsBack(q.endDate, back);
          if (e >= todayIso) continue; // 아직 오지 않은 날짜는 제외
          for (const r of await load(stn, s, e)) {
            const t = Number(r.avgTa);
            if (r.avgTa === undefined || r.avgTa === "" || !Number.isFinite(t)) continue;
            temps.push(t);
            rain.push(Number(r.sumRn || 0) >= 0.1 || Number(r.ddMes || 0) > 0 ? 1 : 0); // 강수 0.1mm 이상 또는 신적설
          }
        }
        if (!temps.length) throw new Error("empty asos");
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        return {
          value: { avgTempC: Math.round(mean(temps) * 10) / 10, rainProb: Math.round(mean(rain) * 100) / 100 },
          source: "기상청 ASOS 최근3년 평년값",
          asOf: new Date().toISOString(),
          estimated: true,
        };
      } catch {
        return fallback.forecast(dest, q);
      }
    },
  };
}
