import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createKmaMidWeather, issuanceCandidates } from "../src/providers/kmaMid.js";
import { createMockProviders } from "../src/providers/mock.js";

const dest = (id: string) => DESTINATIONS.find((d) => d.id === id)!;
const mock = createMockProviders().weather;
// 2026-11-26 10:30 KST (= 01:30 UTC) → 최신 발표는 11/26 06시
const today = () => new Date("2026-11-26T01:30:00Z");
const q = (s: string, e: string) => ({ origin: "ICN", startDate: s, endDate: e, travelers: 1 });

const ok = (item: object) => JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" }, body: { items: { item: [item] }, totalCount: 1 } } });
const noData = JSON.stringify({ response: { header: { resultCode: "03", resultMsg: "NO_DATA" } } });

// 11/26 06시 발표: 4일 후=11/30
const TA = ok({ regId: "x", taMin4: 4, taMax4: 12, taMin5: 6, taMax5: 14, taMin6: 8, taMax6: 16, taMin10: 2, taMax10: 10 });
const LAND = ok({ regId: "y", rnSt4Am: 10, rnSt4Pm: 50, rnSt5Am: 20, rnSt5Pm: 30, rnSt6Am: 0, rnSt6Pm: 0, rnSt10: 60 });

type Call = { op: string; regId: string; tmFc: string };
const fake = (handler: (c: Call) => string, calls: Call[] = []) =>
  (async (u: string) => {
    const url = new URL(u);
    const c = { op: url.pathname.split("/").pop()!, regId: url.searchParams.get("regId")!, tmFc: url.searchParams.get("tmFc")! };
    calls.push(c);
    return new Response(handler(c));
  }) as unknown as typeof fetch;
const normal = (c: Call) => (c.op === "getMidTa" ? TA : LAND);

describe("중기예보 발표 회차", () => {
  it("최신 회차와 직전 회차를 돌려준다 (발표 10분 후부터 제공)", () => {
    expect(issuanceCandidates(new Date("2026-11-26T01:30:00Z"))).toEqual(["202611260600", "202611251800"]); // 10:30 KST
    expect(issuanceCandidates(new Date("2026-11-26T09:30:00Z"))).toEqual(["202611261800", "202611260600"]); // 18:30 KST
    expect(issuanceCandidates(new Date("2026-11-25T21:05:00Z"))).toEqual(["202611251800", "202611250600"]); // 06:05 KST → 아직 전날 18시
    expect(issuanceCandidates(new Date("2026-11-25T18:00:00Z"))).toEqual(["202611251800", "202611250600"]); // 03:00 KST
  });
});

describe("기상청 중기예보 Provider", () => {
  it("일별 (최저+최고)/2 평균, 강수확률은 일별 오전/오후 최댓값의 평균", async () => {
    const calls: Call[] = [];
    const r = await createKmaMidWeather("k", mock, fake(normal, calls), today).forecast(dest("busan"), q("2026-11-30", "2026-12-01"));
    // 11/30(N=4): (4+12)/2=8, 12/01(N=5): (6+14)/2=10 → 9
    expect(r.value.avgTempC).toBe(9);
    // 11/30: max(10,50)=50, 12/01: max(20,30)=30 → 40%
    expect(r.value.rainProb).toBe(0.4);
    expect(r.estimated).toBe(false);
    expect(r.source).toContain("중기예보");
    expect(r.source).toContain("20261126 0600");
    expect(calls.map((c) => c.op).sort()).toEqual(["getMidLandFcst", "getMidTa"]);
    expect(calls.find((c) => c.op === "getMidTa")!.regId).toBe("11H20201");
    expect(calls.find((c) => c.op === "getMidLandFcst")!.regId).toBe("11H20000");
  });
  it("8~10일 후는 오전/오후 구분 없는 rnSt{N} 를 쓴다", async () => {
    const r = await createKmaMidWeather("k", mock, fake(normal), today).forecast(dest("jeju"), q("2026-12-06", "2026-12-06"));
    expect(r.value).toEqual({ avgTempC: 6, rainProb: 0.6 });
  });
  it("지역 코드: 제주·강릉·여수도 각자의 코드로 조회", async () => {
    for (const [id, ta, land] of [["jeju", "11G00201", "11G00000"], ["gangneung", "11D20501", "11D20000"], ["yeosu", "21F20801", "11F20000"]]) {
      const calls: Call[] = [];
      await createKmaMidWeather("k", mock, fake(normal, calls), today).forecast(dest(id), q("2026-11-30", "2026-11-30"));
      expect(calls.find((c) => c.op === "getMidTa")!.regId).toBe(ta);
      expect(calls.find((c) => c.op === "getMidLandFcst")!.regId).toBe(land);
    }
  });
  it("최신 회차가 NO_DATA 면 직전 회차로 내려간다", async () => {
    const calls: Call[] = [];
    const f = fake((c) => (c.tmFc === "202611260600" ? noData : c.op === "getMidTa" ? ok({ taMin5: 1, taMax5: 3 }) : ok({ rnSt5Am: 20, rnSt5Pm: 40 })), calls);
    // 직전 회차 11/25 18시 기준 5일 후 = 11/30
    const r = await createKmaMidWeather("k", mock, f, today).forecast(dest("busan"), q("2026-11-30", "2026-11-30"));
    expect(r.value).toEqual({ avgTempC: 2, rainProb: 0.4 });
    expect(r.source).toContain("20261125 1800");
  });
  it("범위 밖(단기 구간·11일 이후·필드 누락)·해외는 fallback", async () => {
    for (const [d, s, e] of [["busan", "2026-11-27", "2026-11-28"], ["busan", "2026-11-28", "2026-12-01"], ["busan", "2026-12-07", "2026-12-08"], ["busan", "2026-12-02", "2026-12-04"], ["tokyo", "2026-11-30", "2026-12-01"]] as const) {
      const r = await createKmaMidWeather("k", mock, fake(normal), today).forecast(dest(d), q(s, e));
      expect(r.source).toContain("mock");
    }
  });
  it("해외는 호출 자체를 하지 않는다", async () => {
    const calls: Call[] = [];
    await createKmaMidWeather("k", mock, fake(normal, calls), today).forecast(dest("tokyo"), q("2026-11-30", "2026-12-01"));
    expect(calls).toHaveLength(0);
  });
  it("오류 코드/XML/네트워크 실패/모두 NO_DATA 는 fallback", async () => {
    const bad = [
      fake(() => "<OpenAPI_ServiceResponse>SERVICE_KEY_IS_NOT_REGISTERED</OpenAPI_ServiceResponse>"),
      fake(() => JSON.stringify({ response: { header: { resultCode: "30", resultMsg: "SERVICE KEY" } } })),
      fake(() => noData),
      (async () => { throw new Error("network"); }) as unknown as typeof fetch,
    ];
    for (const f of bad) {
      const r = await createKmaMidWeather("k", mock, f, today).forecast(dest("busan"), q("2026-11-30", "2026-12-01"));
      expect(r.source).toContain("mock");
    }
  });
  it("일시적 연결 오류는 1회 재시도", async () => {
    let n = 0;
    const base = fake(normal);
    const f = (async (u: string) => { if (n++ === 0) throw new Error("ECONNRESET"); return (base as any)(u); }) as unknown as typeof fetch;
    const r = await createKmaMidWeather("k", mock, f, today).forecast(dest("busan"), q("2026-11-30", "2026-12-01"));
    expect(r.source).toContain("중기예보");
  });
  it("인코딩된 키는 이중 인코딩하지 않는다", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response(TA); }) as unknown as typeof fetch;
    await createKmaMidWeather("a%2Bb%3D", mock, f, today).forecast(dest("busan"), q("2026-11-30", "2026-11-30"));
    expect(urls[0]).toContain("serviceKey=a%2Bb%3D");
  });
  it("발표일 기준 4~10일 범위 밖이면 API 를 호출하지 않고 바로 fallback", async () => {
    for (const [s, e] of [["2026-11-28", "2026-11-29"], ["2026-11-27", "2026-12-01"], ["2026-12-05", "2026-12-07"], ["2026-12-24", "2026-12-27"]]) {
      const calls: Call[] = [];
      const r = await createKmaMidWeather("k", mock, fake(normal, calls), today).forecast(dest("busan"), q(s, e));
      expect(r.source).toContain("mock");
      expect(calls).toHaveLength(0);
    }
    // 경계(발표일 11/26 기준 +4 ~ +10 = 11/30 ~ 12/06)는 호출한다
    const calls: Call[] = [];
    await createKmaMidWeather("k", mock, fake(normal, calls), today).forecast(dest("busan"), q("2026-11-30", "2026-11-30"));
    expect(calls.length).toBe(2);
  });
});

