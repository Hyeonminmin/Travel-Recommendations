import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createMockProviders } from "../src/providers/mock.js";
import { createSerpApiHotels, sampleStay, type HotelState, type HotelStore } from "../src/providers/serpApiHotels.js";

const dest = (id: string) => DESTINATIONS.find((d) => d.id === id)!;
const mock = createMockProviders().lodging;
const q = (s: string, e: string) => ({ origin: "ICN", startDate: s, endDate: e, travelers: 2 });
const NOW = Date.parse("2026-11-26T03:00:00Z"); // 목요일
const KEY = "SECRET-KEY-123";

const prop = (price: number, rating = 4.3, type = "hotel") => ({ type, overall_rating: rating, rate_per_night: { extracted_lowest: price } });
const ok = (props: object[]) => JSON.stringify({ search_metadata: { status: "Success" }, properties: props });
// 호텔 6곳(5만~10만) + 민박 1곳(1만, 제외 대상)
const HOTELS = [prop(50_000, 4.0), prop(60_000, 4.2), prop(70_000, 4.3), prop(80_000, 4.4), prop(90_000, 4.5), prop(100_000, 4.6), prop(10_000, 3.0, "vacation rental")];

const fake = (body: () => string | Response, urls: string[] = []) =>
  (async (u: string) => { urls.push(u); const b = body(); return typeof b === "string" ? new Response(b) : b; }) as unknown as typeof fetch;
const memStore = (init?: HotelState): HotelStore & { data?: HotelState } => {
  const s: any = { data: init, load: () => s.data, save: (x: HotelState) => { s.data = JSON.parse(JSON.stringify(x)); } };
  return s;
};

describe("sampleStay", () => {
  it("15일에 가장 가까운 목요일 체크인 2박", () => {
    expect(sampleStay("2026-12", NOW)).toEqual({ checkIn: "2026-12-17", checkOut: "2026-12-19" }); // 12/15 화 → 12/17 목
    expect(sampleStay("2027-02", NOW)).toEqual({ checkIn: "2027-02-18", checkOut: "2027-02-20" }); // 2/15 월 → 2/18 목
    expect(sampleStay("2027-03", NOW)).toEqual({ checkIn: "2027-03-18", checkOut: "2027-03-20" }); // 3/15 월
    expect(sampleStay("2027-01", NOW)).toEqual({ checkIn: "2027-01-14", checkOut: "2027-01-16" }); // 1/15 금 → 1/14 목
  });
  it("이미 지난 날짜면 이번 달 남은 첫 목요일, 없으면 undefined", () => {
    // 11월은 오늘(11/26)+2일 이후 목요일이 없다
    expect(sampleStay("2026-11", NOW)).toBeUndefined();
    expect(sampleStay("2026-10", NOW)).toBeUndefined();
    // 12/15 목(=표본) 이 오늘+2일 이전이면 12월 남은 첫 목요일
    expect(sampleStay("2026-12", Date.parse("2026-12-16T00:00:00Z"))).toEqual({ checkIn: "2026-12-24", checkOut: "2026-12-26" });
  });
});

describe("SerpAPI 호텔 Provider", () => {
  it("수집 전엔 fallback, 수집 후엔 호텔 유형 중앙값과 평점 중앙값(월 캐시)", async () => {
    const urls: string[] = [];
    const p = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS), urls), now: () => NOW });
    const first = await p.perNightKRW(dest("osaka"), q("2026-12-20", "2026-12-22"));
    expect(first.source).toContain("mock"); // 이 호출이 백그라운드 수집을 시작
    await p.settle();
    const r = await p.perNightKRW(dest("osaka"), q("2026-12-28", "2026-12-30")); // 같은 달 다른 날짜 → 같은 캐시
    expect(r.value).toBe(75_000); // 호텔 6곳 중앙값 (민박 제외)
    expect(r.estimated).toBe(true);
    expect(r.source).toContain("SerpAPI");
    expect(r.source).toContain("상위 6곳");
    expect((await p.rating(dest("osaka"))).value).toBe(4.35); // 4.0,4.2,4.3,4.4,4.5,4.6 중앙값
    expect(urls).toHaveLength(1);
  });
  it("요청 URL: 영문 검색어·2인·원화·표본 날짜", async () => {
    const urls: string[] = [];
    const p = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS), urls), now: () => NOW });
    await p.perNightKRW(dest("danang"), q("2026-12-20", "2026-12-22"));
    await p.settle();
    const u = new URL(urls[0]);
    expect(u.searchParams.get("engine")).toBe("google_hotels");
    expect(u.searchParams.get("q")).toBe("Da Nang hotels");
    expect(u.searchParams.get("check_in_date")).toBe("2026-12-17");
    expect(u.searchParams.get("check_out_date")).toBe("2026-12-19");
    expect(u.searchParams.get("adults")).toBe("2");
    expect(u.searchParams.get("currency")).toBe("KRW");
  });
  it("국내 목적지는 호출 없이 fallback", async () => {
    const urls: string[] = [];
    const p = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS), urls), now: () => NOW });
    expect((await p.perNightKRW(dest("busan"), q("2026-12-20", "2026-12-22"))).source).toContain("mock");
    expect((await p.rating(dest("busan"))).source).toContain("mock");
    await p.settle();
    expect(urls).toHaveLength(0);
  });
  it("호텔이 5곳 미만이면 전체 숙소를 사용, 가격 있는 숙소가 5곳 미만이면 캐시하지 않고 fallback", async () => {
    const few = [prop(50_000, 4.0, "hotel"), prop(60_000, 4.2, "hotel"), prop(70_000, 4.3, "vacation rental"), prop(80_000, 4.4, "vacation rental"), prop(90_000, 4.5, "vacation rental")];
    const p = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(few)), now: () => NOW });
    await p.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"));
    await p.settle();
    expect((await p.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"))).value).toBe(70_000);
    const tiny = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok([prop(50_000), prop(60_000)])), now: () => NOW });
    await tiny.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"));
    await tiny.settle();
    expect((await tiny.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"))).source).toContain("mock");
  });
  it("월 호출 상한에 도달하면 더 호출하지 않는다(사용량은 파일에 저장)", async () => {
    const urls: string[] = [];
    const logs: string[] = [];
    const store = memStore();
    const p = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS), urls), store, now: () => NOW, monthlyBudget: 2, log: (m) => logs.push(m) });
    for (const id of ["tokyo", "osaka", "fukuoka"]) { await p.perNightKRW(dest(id), q("2026-12-20", "2026-12-22")); await p.settle(); }
    expect(urls).toHaveLength(2);
    expect(logs.join("\n")).toContain("monthly budget reached");
    expect(store.data!.usage).toEqual({ month: "2026-11", count: 2 });
    // 달이 바뀌면 사용량이 초기화된다
    const later = Date.parse("2026-12-02T00:00:00Z");
    const p2 = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS), urls), store, now: () => later, monthlyBudget: 2 });
    await p2.perNightKRW(dest("fukuoka"), q("2027-01-20", "2027-01-22"));
    await p2.settle();
    expect(urls).toHaveLength(3);
  });
  it("오류 응답은 재시도하지 않고(한도 보호), 1시간 쿨다운 뒤에만 다시 호출", async () => {
    const urls: string[] = [];
    let t = NOW;
    const p = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => JSON.stringify({ error: "Invalid API key" }), urls), now: () => t });
    await p.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"));
    await p.settle();
    expect(urls).toHaveLength(1); // 재시도 없음
    await p.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"));
    await p.settle();
    expect(urls).toHaveLength(1); // 쿨다운 중
    t += 61 * 60_000;
    await p.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"));
    await p.settle();
    expect(urls).toHaveLength(2);
  });
  it("HTTP 429 도 재시도하지 않고 fallback", async () => {
    const urls: string[] = [];
    const p = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => new Response("rate limited", { status: 429 }), urls), now: () => NOW });
    await p.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"));
    await p.settle();
    expect(urls).toHaveLength(1);
    expect((await p.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"))).source).toContain("mock");
  });
  it("연결 오류(응답 전 실패)는 1회 재시도", async () => {
    let n = 0;
    const f = (async () => { if (n++ === 0) throw new Error("ECONNRESET"); return new Response(ok(HOTELS)); }) as unknown as typeof fetch;
    const p = createSerpApiHotels(KEY, mock, { fetchFn: f, now: () => NOW });
    await p.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"));
    await p.settle();
    expect((await p.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"))).source).toContain("SerpAPI");
  });
  it("동시 요청은 한 번만 호출, 달이 다르면 별도 호출", async () => {
    const urls: string[] = [];
    const p = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS), urls), now: () => NOW });
    await Promise.all([p.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22")), p.perNightKRW(dest("tokyo"), q("2026-12-21", "2026-12-23"))]);
    await p.settle();
    expect(urls).toHaveLength(1);
    await p.perNightKRW(dest("tokyo"), q("2027-02-10", "2027-02-12"));
    await p.settle();
    expect(urls).toHaveLength(2);
  });
  it("캐시는 파일로 이어지고 30일이 지나면 오래된 값을 쓰면서 갱신", async () => {
    const store = memStore();
    let t = NOW;
    const p1 = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS)), store, now: () => t });
    await p1.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"));
    await p1.settle();
    const urls: string[] = [];
    const p2 = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS), urls), store, now: () => t + 1000 });
    expect((await p2.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22"))).source).toContain("SerpAPI");
    await p2.settle();
    expect(urls).toHaveLength(0); // 신선한 캐시
    t += 31 * 86_400_000;
    const p3 = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS), urls), store, now: () => t });
    expect((await p3.perNightKRW(dest("tokyo"), q("2027-01-05", "2027-01-07"))).source).toContain("mock"); // 다른 달 → 아직 없음
    await p3.settle();
    expect(urls.length).toBeGreaterThan(0);
  });
  it("rating: 수집 전엔 fallback 이면서 다음 달 수집을 시작, 이후 평점 반환", async () => {
    const urls: string[] = [];
    const p = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS), urls), now: () => NOW });
    expect((await p.rating(dest("bangkok"))).source).toContain("mock");
    await p.settle();
    expect(new URL(urls[0]).searchParams.get("check_in_date")).toBe("2026-12-17"); // NOW+30일 → 12월
    expect((await p.rating(dest("bangkok"))).value).toBe(4.35);
  });
  it("warmUp: 해외 목적지만, 이미 있는 항목은 건너뛴다", async () => {
    const urls: string[] = [];
    const p = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS), urls), now: () => NOW });
    await p.warmUp(DESTINATIONS);
    expect(urls).toHaveLength(6);
    await p.warmUp(DESTINATIONS);
    expect(urls).toHaveLength(6);
  });
  it("API 키는 로그에 남지 않는다", async () => {
    const logs: string[] = [];
    const bad = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => JSON.stringify({ error: `bad key ${KEY}`.replace(KEY, "***") })), now: () => NOW, log: (m) => logs.push(m) });
    const good = createSerpApiHotels(KEY, mock, { fetchFn: fake(() => ok(HOTELS)), now: () => NOW, log: (m) => logs.push(m) });
    for (const p of [bad, good]) { await p.perNightKRW(dest("tokyo"), q("2026-12-20", "2026-12-22")); await p.settle(); }
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(KEY);
  });
});
