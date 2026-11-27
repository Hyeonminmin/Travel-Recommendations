import type { Destination, Sourced } from "../types.js";
import type { TripQuery, WeatherProvider } from "./types.js";

type Fetch = typeof fetch;

const BASE = "https://apis.data.go.kr/1360000/MidFcstInfoService";
const ISSUE_HOURS = [6, 18]; // 중기예보 발표 시각(KST)
const MID_FIRST_DAY = 4; // 발표일 기준 4일 후부터(18시 발표분은 5일 후부터)
const MID_LAST_DAY = 10;

/**
 * 목적지 → 중기예보 지역코드. 기온은 도시 코드(getMidTa), 육상예보(강수확률)는 광역 코드(getMidLandFcst)를 쓴다.
 * 4곳 모두 실제 API 로 응답을 확인한 값.
 */
const REGIONS: Record<string, { ta: string; land: string }> = {
  jeju: { ta: "11G00201", land: "11G00000" },
  busan: { ta: "11H20201", land: "11H20000" },
  gangneung: { ta: "11D20501", land: "11D20000" },
  yeosu: { ta: "21F20801", land: "11F20000" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const kst = (d: Date) => new Date(d.getTime() + 9 * 3_600_000); // UTC getter 로 KST 값을 읽기 위한 이동
const ymd = (k: Date) => `${k.getUTCFullYear()}${pad(k.getUTCMonth() + 1)}${pad(k.getUTCDate())}`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** 최신 발표 회차(tmFc, KST 'YYYYMMDDHH00')와 그 직전 회차. 발표 10분 후부터 제공된다고 보고 보수적으로 잡는다. */
export function issuanceCandidates(now: Date): string[] {
  const k = kst(new Date(now.getTime() - 10 * 60_000));
  const out: string[] = [];
  let day = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
  let idx = [...ISSUE_HOURS].reverse().findIndex((h) => h <= k.getUTCHours());
  let hours = [...ISSUE_HOURS].reverse(); // [18, 6]
  if (idx === -1) { day -= 86_400_000; idx = 0; } // 06시 이전 → 전날 18시
  for (let n = 0; n < 2; n++) {
    out.push(`${ymd(new Date(day))}${pad(hours[idx])}00`);
    idx++;
    if (idx >= hours.length) { idx = 0; day -= 86_400_000; }
  }
  return out;
}

const daysBetween = (fromYmd: string, toIso: string) => {
  const f = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(4, 6) - 1, +fromYmd.slice(6, 8));
  return Math.round((Date.parse(toIso) - f) / 86_400_000);
};
const eachDate = (start: string, end: string) => {
  const out: string[] = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

class NoData extends Error {}

/**
 * 기상청 중기예보(getMidTa + getMidLandFcst). 발표일 기준 4~10일 후(18시 발표분은 5일 후부터)를 커버한다.
 * 여행 날짜 전부에 대한 기온·강수확률 필드가 있을 때만 사용하고, 그 밖(해외·단기 구간과 걸친 일정·범위 밖)이나
 * 호출 실패는 fallback 으로 넘긴다.
 *  - 기온: 일별 (최저+최고)/2 의 평균, 강수확률: 일별 오전/오후 중 최댓값의 평균 (단기예보·Open-Meteo 와 같은 정의)
 */
export function createKmaMidWeather(serviceKey: string, fallback: WeatherProvider, fetchFn: Fetch = fetch, today = () => new Date()): WeatherProvider {
  const key = serviceKey.includes("%") ? decodeURIComponent(serviceKey) : serviceKey;

  async function getJson(url: string): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`kma-mid HTTP ${res.status}`);
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("kma-mid non-JSON response"); // 오류를 XML 로 주는 경우
        }
      } catch (e) {
        lastErr = e; // 연결 reset 등 일시 오류 1회 재시도
      }
    }
    throw lastErr;
  }

  async function item(op: string, regId: string, tmFc: string): Promise<Record<string, unknown>> {
    const q = new URLSearchParams({ serviceKey: key, numOfRows: "10", pageNo: "1", dataType: "JSON", regId, tmFc });
    const j = await getJson(`${BASE}/${op}?${q}`);
    const code = j?.response?.header?.resultCode;
    if (code === "03") throw new NoData(); // NO_DATA: 아직 제공 전이거나 너무 오래된 회차
    if (code !== "00") throw new Error(`kma-mid resultCode=${code}`);
    const it = j.response.body?.items?.item;
    const first = Array.isArray(it) ? it[0] : it;
    if (!first) throw new NoData();
    return first;
  }

  return {
    async forecast(dest: Destination, q: TripQuery): Promise<Sourced<{ avgTempC: number; rainProb: number }>> {
      const region = REGIONS[dest.id];
      if (!region || !dest.domestic) return fallback.forecast(dest, q);
      try {
        const now = today();
        // 발표일 기준 4~10일 후 필드만 존재한다. 범위 밖이면 API 를 호출하지 않고 바로 fallback(불필요한 호출·지연 방지)
        const base = issuanceCandidates(now)[0].slice(0, 8);
        if (daysBetween(base, q.startDate) < MID_FIRST_DAY || daysBetween(base, q.endDate) > MID_LAST_DAY) return fallback.forecast(dest, q);
        const dates = eachDate(q.startDate, q.endDate);
        let lastNoData = false;
        for (const tmFc of issuanceCandidates(now)) {
          let ta: Record<string, unknown>, land: Record<string, unknown>;
          try {
            [ta, land] = await Promise.all([item("getMidTa", region.ta, tmFc), item("getMidLandFcst", region.land, tmFc)]);
          } catch (e) {
            if (e instanceof NoData) { lastNoData = true; continue; } // 직전 회차로
            throw e;
          }
          const temps: number[] = [];
          const pops: number[] = [];
          for (const date of dates) {
            const n = daysBetween(tmFc.slice(0, 8), date);
            const lo = num(ta[`taMin${n}`]);
            const hi = num(ta[`taMax${n}`]);
            const rn = [num(land[`rnSt${n}Am`]), num(land[`rnSt${n}Pm`]), num(land[`rnSt${n}`])].filter((v): v is number => v !== undefined);
            if (lo === undefined || hi === undefined || rn.length === 0) throw new Error(`kma-mid: ${date} 는 이 발표 회차의 범위 밖`);
            temps.push((lo + hi) / 2);
            pops.push(Math.max(...rn));
          }
          return {
            value: { avgTempC: Math.round(mean(temps) * 10) / 10, rainProb: Math.round(mean(pops)) / 100 },
            source: `기상청 중기예보(${tmFc.slice(0, 8)} ${tmFc.slice(8)} 발표)`,
            asOf: now.toISOString(),
            estimated: false,
          };
        }
        throw new Error(lastNoData ? "kma-mid: 두 회차 모두 NO_DATA" : "kma-mid: unreachable");
      } catch {
        return fallback.forecast(dest, q);
      }
    },
  };
}
