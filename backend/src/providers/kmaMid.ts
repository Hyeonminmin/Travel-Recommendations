type Fetch = typeof fetch;

/** 도착지 id → 중기예보 지역코드 (기온: 도시 단위 / 육상: 광역 단위). ※ 공식 코드표 기준, 실응답 미검증(서비스 활용신청 전). */
export const MID_REGION: Record<string, { ta: string; land: string }> = {
  jeju: { ta: "11G00201", land: "11G00000" },
  busan: { ta: "11H20201", land: "11H20000" },
  gangneung: { ta: "11D20501", land: "11D20000" },
  yeosu: { ta: "11F20401", land: "11F20000" },
};

/** 중기예보 발표 시각(KST 06/18시, 약 30분 뒤 제공) → tmFc(YYYYMMDDHHmm) */
export function latestTmFc(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000 - 30 * 60_000);
  const h = kst.getUTCHours();
  let d = kst;
  let hh = "1800";
  if (h >= 18) hh = "1800";
  else if (h >= 6) hh = "0600";
  else { d = new Date(kst.getTime() - 86_400_000); hh = "1800"; }
  return d.toISOString().slice(0, 10).replace(/-/g, "") + hh;
}

const addDays = (yyyymmdd: string, n: number) => {
  const t = Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};

/** 발표일 기준 N일 후(4~10) → { 'YYYY-MM-DD': { tempC, pop(0~1) } } */
export function parseMid(taItem: any, landItem: any, tmFc: string): Record<string, { tempC?: number; pop?: number }> {
  const out: Record<string, { tempC?: number; pop?: number }> = {};
  const base = tmFc.slice(0, 8);
  for (let n = 4; n <= 10; n++) {
    const lo = taItem?.[`taMin${n}`], hi = taItem?.[`taMax${n}`];
    const pops = (n <= 7 ? [landItem?.[`rnSt${n}Am`], landItem?.[`rnSt${n}Pm`]] : [landItem?.[`rnSt${n}`]]).filter((x) => typeof x === "number");
    const rec: { tempC?: number; pop?: number } = {};
    if (typeof lo === "number" && typeof hi === "number") rec.tempC = (lo + hi) / 2;
    if (pops.length) rec.pop = pops.reduce((a: number, b: number) => a + b, 0) / pops.length / 100;
    if (rec.tempC !== undefined || rec.pop !== undefined) out[addDays(base, n)] = rec;
  }
  return out;
}

/** 기상청 중기예보(기온 + 육상). 실패(미승인 키 포함)는 빈 객체. */
export async function loadMid(key: string, destId: string, now: Date, fetchFn: Fetch): Promise<Record<string, { tempC?: number; pop?: number }>> {
  const region = MID_REGION[destId];
  if (!region) return {};
  const tmFc = latestTmFc(now);
  const get = async (op: string, regId: string) => {
    const url = `https://apis.data.go.kr/1360000/MidFcstInfoService/${op}?${new URLSearchParams({ serviceKey: key, pageNo: "1", numOfRows: "10", dataType: "JSON", regId, tmFc })}`;
    let last: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`kma-mid HTTP ${res.status}`);
        const j = JSON.parse(await res.text());
        if (j?.response?.header?.resultCode !== "00") throw new Error("kma-mid not ok");
        const it = j.response.body?.items?.item;
        return Array.isArray(it) ? it[0] : it;
      } catch (e) { last = e; }
    }
    throw last;
  };
  try {
    const [ta, land] = await Promise.all([get("getMidTa", region.ta), get("getMidLandFcst", region.land)]);
    return parseMid(ta, land, tmFc);
  } catch {
    return {};
  }
}
