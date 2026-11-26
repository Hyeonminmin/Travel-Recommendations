import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createMockProviders } from "../src/providers/mock.js";
import { createTourApiEvents, inferTags } from "../src/providers/tourApi.js";

const dest = (id: string) => DESTINATIONS.find((d) => d.id === id)!;
const mock = createMockProviders().event;
const q = { origin: "ICN", startDate: "2026-12-10", endDate: "2026-12-14", travelers: 1 };
const item = (title: string, s: string, e: string, addr1 = "부산광역시 해운대구") => ({ title, addr1, eventstartdate: s, eventenddate: e });
const body = (items: object[] | "", total = Array.isArray(items) ? items.length : 0) =>
  JSON.stringify({ response: { header: { resultCode: "0000", resultMsg: "OK" }, body: { items: items === "" ? "" : { item: items }, totalCount: total } } });
const fakeFetch = (text: string, urls: string[] = []) =>
  (async (u: string) => { urls.push(u); return new Response(text); }) as unknown as typeof fetch;

describe("TourAPI events", () => {
  it("여행 기간과 겹치는 행사만 반환하고 lDongRegnCd 로 조회한다", async () => {
    const urls: string[] = [];
    const f = fakeFetch(body([
      item("해운대 빛축제", "20261201", "20261231"),   // 겹침
      item("이미 끝난 행사", "20261101", "20261105"),   // 종료
      item("나중 행사", "20261220", "20261225"),        // 시작 전
    ]), urls);
    const r = await createTourApiEvents("k", mock, f).events(dest("busan"), q);
    expect(r.value.map((e) => e.name)).toEqual(["해운대 빛축제"]);
    expect(r.value[0]).toMatchObject({ startDate: "2026-12-01", endDate: "2026-12-31" });
    expect(r.estimated).toBe(false);
    expect(urls[0]).toContain("lDongRegnCd=26");
    expect(urls[0]).toContain("eventStartDate=20261210");
  });
  it("120일 넘는 상설 프로그램은 제외", async () => {
    const r = await createTourApiEvents("k", mock, fakeFetch(body([item("상설 드론쇼", "20260101", "20261231")]))).events(dest("busan"), q);
    expect(r.value).toEqual([]);
  });
  it("강릉/여수는 주소의 시 이름으로 걸러낸다", async () => {
    const f = fakeFetch(body([
      item("강릉 행사", "20261211", "20261212", "강원특별자치도 강릉시 어딘가"),
      item("춘천 행사", "20261211", "20261212", "강원특별자치도 춘천시 어딘가"),
    ]));
    const r = await createTourApiEvents("k", mock, f).events(dest("gangneung"), q);
    expect(r.value.map((e) => e.name)).toEqual(["강릉 행사"]);
  });
  it("0건(items 가 빈 문자열)은 fallback 이 아니라 '행사 없음' 으로 처리", async () => {
    const r = await createTourApiEvents("k", mock, fakeFetch(body(""))).events(dest("jeju"), q);
    expect(r.value).toEqual([]);
    expect(r.source).toContain("TourAPI");
  });
  it("items.item 이 객체 1건으로 오는 경우도 처리", async () => {
    const text = JSON.stringify({ response: { header: { resultCode: "0000" }, body: { items: { item: item("단건", "20261211", "20261212") }, totalCount: 1 } } });
    const r = await createTourApiEvents("k", mock, fakeFetch(text)).events(dest("busan"), q);
    expect(r.value).toHaveLength(1);
  });
  it("해외 목적지는 TourAPI 를 호출하지 않고 fallback", async () => {
    const urls: string[] = [];
    const r = await createTourApiEvents("k", mock, fakeFetch(body(""), urls)).events(dest("tokyo"), q);
    expect(urls).toHaveLength(0);
    expect(r.source).toContain("mock");
  });
  it("오류 응답/XML/네트워크 실패는 fallback", async () => {
    for (const f of [
      fakeFetch("<xml>SERVICE_KEY_IS_NOT_REGISTERED</xml>"),
      fakeFetch(JSON.stringify({ response: { header: { resultCode: "0030", resultMsg: "SERVICE KEY" } } })),
      (async () => { throw new Error("network"); }) as unknown as typeof fetch,
    ]) {
      const r = await createTourApiEvents("k", mock, f).events(dest("jeju"), q);
      expect(r.source).toContain("mock");
    }
  });
  it("일시적 연결 오류는 1회 재시도", async () => {
    let n = 0;
    const f = (async () => { if (n++ === 0) throw new Error("ECONNRESET"); return new Response(body([item("행사", "20261211", "20261212")])); }) as unknown as typeof fetch;
    const r = await createTourApiEvents("k", mock, f).events(dest("busan"), q);
    expect(r.value).toHaveLength(1);
  });
  it("인코딩된 키는 이중 인코딩하지 않는다", async () => {
    const urls: string[] = [];
    await createTourApiEvents("a%2Bb%3D", mock, fakeFetch(body(""), urls)).events(dest("jeju"), q);
    expect(urls[0]).toContain("serviceKey=a%2Bb%3D");
  });
  it("행사명 키워드로 태그 추정", () => {
    expect(inferTags("여수밤바다 불꽃축제")).toEqual(expect.arrayContaining(["축제", "도시"]));
    expect(inferTags("강릉 커피축제")).toContain("미식");
  });
});
