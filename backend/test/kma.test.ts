import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createKmaWeather, latestBase, toGrid } from "../src/providers/kma.js";
import { createMockProviders } from "../src/providers/mock.js";

const dest = (id: string) => DESTINATIONS.find((d) => d.id === id)!;
const mock = createMockProviders().weather;
// 2026-11-26 10:30 KST (= 01:30 UTC)
const today = () => new Date("2026-11-26T01:30:00Z");
const q = (s: string, e: string) => ({ origin: "ICN", startDate: s, endDate: e, travelers: 1 });
const row = (category: string, fcstDate: string, fcstTime: string, fcstValue: string) => ({ category, fcstDate, fcstTime, fcstValue });
const body = (item: object[]) => JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" }, body: { items: { item }, totalCount: item.length } } });
const fakeFetch = (text: string, urls: string[] = []) => (async (u: string) => { urls.push(u); return new Response(text); }) as unknown as typeof fetch;

describe("기상청 격자 변환", () => {
  it("서울/부산은 기상청 공식 격자와 일치, 제주는 변환식 결과 고정", () => {
    expect(toGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
    expect(toGrid(35.1796, 129.0756)).toEqual({ nx: 98, ny: 76 });
    expect(toGrid(33.4996, 126.5312)).toEqual({ nx: 53, ny: 38 });
  });
});

describe("발표 시각 선택", () => {
  it("발표 10분 후부터 해당 회차를 사용", () => {
    expect(latestBase(new Date("2026-11-26T01:30:00Z"))).toEqual({ baseDate: "20261126", baseTime: "0800" }); // 10:30 KST
    expect(latestBase(new Date("2026-11-25T23:05:00Z"))).toEqual({ baseDate: "20261126", baseTime: "0500" }); // 08:05 KST
  });
  it("02:10 이전은 전날 23시 발표분", () => {
    expect(latestBase(new Date("2026-11-25T16:30:00Z"))).toEqual({ baseDate: "20261125", baseTime: "2300" }); // 01:30 KST
  });
});

describe("기상청 단기예보 Provider", () => {
  const items = [
    row("TMP", "20261127", "0900", "4"), row("TMP", "20261127", "1500", "8"), row("TMP", "20261128", "1500", "6"),
    row("POP", "20261127", "0900", "20"), row("POP", "20261127", "1500", "60"), row("POP", "20261128", "1500", "20"),
    row("TMP", "20261130", "1500", "30"), // 여행 기간 밖
  ];
  it("3일 이내 국내 여행은 기상청 값을 사용 (기온=시간별 평균, 강수확률=일별 최댓값 평균)", async () => {
    const urls: string[] = [];
    const r = await createKmaWeather("k", mock, fakeFetch(body(items), urls), today).forecast(dest("busan"), q("2026-11-27", "2026-11-28"));
    expect(r.value).toEqual({ avgTempC: 6, rainProb: 0.4 }); // (60+20)/2
    expect(r.estimated).toBe(false);
    expect(r.source).toContain("기상청");
    expect(urls[0]).toContain("nx=98");
    expect(urls[0]).toContain("ny=76");
    expect(urls[0]).toContain("base_date=20261126");
  });
  it("3일 초과·과거·해외는 호출 없이 fallback", async () => {
    for (const [d, s, e] of [["busan", "2026-12-10", "2026-12-12"], ["busan", "2026-11-25", "2026-11-27"], ["tokyo", "2026-11-27", "2026-11-28"]] as const) {
      const urls: string[] = [];
      const r = await createKmaWeather("k", mock, fakeFetch(body(items), urls), today).forecast(dest(d), q(s, e));
      expect(urls).toHaveLength(0);
      expect(r.source).toContain("mock");
    }
  });
  it("오류 코드/XML/빈 예보/네트워크 실패는 fallback", async () => {
    const bad = [
      fakeFetch("<OpenAPI_ServiceResponse>SERVICE_KEY_IS_NOT_REGISTERED</OpenAPI_ServiceResponse>"),
      fakeFetch(JSON.stringify({ response: { header: { resultCode: "03", resultMsg: "NO_DATA" } } })),
      fakeFetch(body([row("POP", "20261127", "0900", "10")])),
      (async () => { throw new Error("network"); }) as unknown as typeof fetch,
    ];
    for (const f of bad) {
      const r = await createKmaWeather("k", mock, f, today).forecast(dest("jeju"), q("2026-11-27", "2026-11-28"));
      expect(r.source).toContain("mock");
    }
  });
  it("인코딩된 키는 이중 인코딩하지 않는다", async () => {
    const urls: string[] = [];
    await createKmaWeather("a%2Bb%3D", mock, fakeFetch(body(items), urls), today).forecast(dest("busan"), q("2026-11-27", "2026-11-28"));
    expect(urls[0]).toContain("serviceKey=a%2Bb%3D");
  });
});
