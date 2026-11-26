import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createMockProviders } from "../src/providers/mock.js";
import { createTourApiEvents, inferTags } from "../src/providers/tourApi.js";

const dest = (id: string) => DESTINATIONS.find((d) => d.id === id)!;
const mock = createMockProviders().event;
// 2026-12-01 09:00 KST — 캐시·기준일 테스트용 고정 시각(여행일 12/10 은 이후)
const NOW = () => Date.parse("2026-12-01T00:00:00Z");
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
    const r = await createTourApiEvents("k", mock, f, NOW).events(dest("busan"), q);
    expect(r.value.map((e) => e.name)).toEqual(["해운대 빛축제"]);
    expect(r.value[0]).toMatchObject({ startDate: "2026-12-01", endDate: "2026-12-31" });
    expect(r.estimated).toBe(false);
    expect(urls[0]).toContain("lDongRegnCd=26");
    expect(urls[0]).toContain("eventStartDate=20261201"); // 캐시용으로 여행 시작일이 아니라 오늘(KST) 기준 조회
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

describe("TourAPI 행사 지역 캐시", () => {
  const trip = (s: string, e: string) => ({ origin: "ICN", startDate: s, endDate: e, travelers: 1 });
  const events = [item("해운대 빛축제", "20261201", "20261231"), item("봄꽃 축제", "20270320", "20270410"), item("상설", "20260101", "20271231")];
  const counting = (text: string, urls: string[]) => fakeFetch(text, urls);

  it("같은 지역은 여행 날짜가 달라도 호출 1회로 캐시를 공유하고 요청마다 겹침을 다시 거른다", async () => {
    const urls: string[] = [];
    const p = createTourApiEvents("k", mock, counting(body(events), urls), NOW);
    const a = await p.events(dest("busan"), trip("2026-12-10", "2026-12-14"));
    const b = await p.events(dest("busan"), trip("2027-03-25", "2027-03-28"));
    const c = await p.events(dest("busan"), trip("2026-12-20", "2026-12-22"));
    expect(urls).toHaveLength(1);
    expect(a.value.map((e) => e.name)).toEqual(["해운대 빛축제"]);
    expect(b.value.map((e) => e.name)).toEqual(["봄꽃 축제"]); // 같은 캐시에서 다른 기간 결과
    expect(c.value.map((e) => e.name)).toEqual(["해운대 빛축제"]);
    expect(new URL(urls[0]).searchParams.get("eventStartDate")).toBe("20261201");
  });
  it("지역이 다르면 따로 조회, 해외는 호출하지 않는다", async () => {
    const urls: string[] = [];
    const p = createTourApiEvents("k", mock, counting(body(events), urls), NOW);
    await p.events(dest("busan"), trip("2026-12-10", "2026-12-14"));
    await p.events(dest("jeju"), trip("2026-12-10", "2026-12-14"));
    await p.events(dest("tokyo"), trip("2026-12-10", "2026-12-14"));
    expect(urls.map((u) => new URL(u).searchParams.get("lDongRegnCd"))).toEqual(["26", "50"]);
  });
  it("6시간이 지나면 다시 조회", async () => {
    const urls: string[] = [];
    let t = NOW();
    const p = createTourApiEvents("k", mock, counting(body(events), urls), () => t);
    await p.events(dest("busan"), trip("2026-12-10", "2026-12-14"));
    t += 5 * 3_600_000;
    await p.events(dest("busan"), trip("2026-12-10", "2026-12-14"));
    expect(urls).toHaveLength(1);
    t += 2 * 3_600_000; // 합계 7시간
    await p.events(dest("busan"), trip("2026-12-10", "2026-12-14"));
    expect(urls).toHaveLength(2);
  });
  it("갱신 실패 시 오래된 캐시를 계속 사용(asOf 는 수집 시각), 캐시가 없으면 fallback", async () => {
    let t = NOW();
    let fail = false;
    const f = (async () => { if (fail) throw new Error("network"); return new Response(body(events)); }) as unknown as typeof fetch;
    const p = createTourApiEvents("k", mock, f, () => t);
    const first = await p.events(dest("busan"), trip("2026-12-10", "2026-12-14"));
    fail = true;
    t += 7 * 3_600_000;
    const stale = await p.events(dest("busan"), trip("2026-12-10", "2026-12-14"));
    expect(stale.source).toContain("TourAPI");
    expect(stale.value).toEqual(first.value);
    expect(stale.asOf).toBe(first.asOf);
    expect((await p.events(dest("jeju"), trip("2026-12-10", "2026-12-14"))).source).toContain("mock"); // 캐시 없는 지역
  });
  it("같은 지역 동시 요청은 호출 한 번을 공유", async () => {
    const urls: string[] = [];
    const p = createTourApiEvents("k", mock, counting(body(events), urls), NOW);
    await Promise.all([
      p.events(dest("busan"), trip("2026-12-10", "2026-12-14")),
      p.events(dest("busan"), trip("2027-03-25", "2027-03-28")),
      p.events(dest("busan"), trip("2026-12-20", "2026-12-22")),
    ]);
    expect(urls).toHaveLength(1);
  });
  it("과거 날짜로 시작하는 여행은 캐시를 쓰지 않고 여행 시작일 기준으로 직접 조회", async () => {
    const urls: string[] = [];
    const p = createTourApiEvents("k", mock, counting(body(events), urls), NOW);
    await p.events(dest("busan"), trip("2026-11-20", "2026-12-03"));
    expect(new URL(urls[0]).searchParams.get("eventStartDate")).toBe("20261120");
    await p.events(dest("busan"), trip("2026-11-20", "2026-12-03"));
    expect(urls).toHaveLength(2); // 캐시 안 함
  });
  it("지역 행사가 300건을 넘어 잘리면 캐시를 쓰지 않고 요청별(여행 시작일 기준) 조회", async () => {
    const urls: string[] = [];
    const many = Array.from({ length: 100 }, (_, i) => item(`행사${i}`, "20261201", "20261231"));
    // 페이지마다 100건, totalCount 는 450 → 300건까지만 받고 잘림
    const p = createTourApiEvents("k", mock, counting(body(many, 450), urls), NOW);
    await p.events(dest("busan"), trip("2026-12-10", "2026-12-14"));
    const afterFirst = urls.length;
    expect(afterFirst).toBeGreaterThanOrEqual(4); // 공유 조회 3페이지 + 요청별 직접 조회
    await p.events(dest("busan"), trip("2026-12-10", "2026-12-14"));
    expect(urls.length).toBeGreaterThan(afterFirst + 2); // 잘린 지역은 매 요청 직접 조회
    expect(new URL(urls[urls.length - 1]).searchParams.get("eventStartDate")).toBe("20261210");
  });
});

