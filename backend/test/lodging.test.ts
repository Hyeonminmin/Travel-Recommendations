import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createMockProviders } from "../src/providers/mock.js";
import { createTourApiLodging, priceForStay, type FeeStats, type LodgingStore } from "../src/providers/tourApiLodging.js";

const dest = (id: string) => DESTINATIONS.find((d) => d.id === id)!;
const mock = createMockProviders().lodging;
const q = (s: string, e: string) => ({ origin: "ICN", startDate: s, endDate: e, travelers: 2 });

const stats = (fees: FeeStats["fees"]): FeeStats => ({ sampled: 60, total: 200, fees });
const full = stats({
  offWeekday: { median: 100_000, n: 20 },
  offWeekend: { median: 140_000, n: 18 },
  peakWeekday: { median: 180_000, n: 12 },
  peakWeekend: { median: 240_000, n: 10 },
});

describe("priceForStay", () => {
  it("박마다 주중/주말(금·토 숙박)·성수기(7·8월)를 판정해 평균", () => {
    // 2026-12-24(목) 체크인 → 목·금·토 박: 주중1 + 주말2 → (100k + 140k*2)/3
    expect(priceForStay(full, q("2026-12-24", "2026-12-27"))).toBe(127_000);
    // 2026-07-20(월) 1박: 성수기 주중
    expect(priceForStay(full, q("2026-07-20", "2026-07-21"))).toBe(180_000);
    // 2026-07-24(금) 1박: 성수기 주말
    expect(priceForStay(full, q("2026-07-24", "2026-07-25"))).toBe(240_000);
  });
  it("표본이 적은 칸(n<5)은 쓰지 않고 가까운 칸으로 대체", () => {
    const s = stats({ offWeekday: { median: 90_000, n: 20 }, offWeekend: { median: 999_000, n: 2 } });
    expect(priceForStay(s, q("2026-12-25", "2026-12-26"))).toBe(90_000); // 금요일 박이지만 주말칸 n=2 → 주중칸
  });
  it("쓸 수 있는 칸이 하나도 없으면 undefined", () => {
    expect(priceForStay(stats({ offWeekday: { median: 90_000, n: 3 } }), q("2026-12-24", "2026-12-26"))).toBeUndefined();
    expect(priceForStay(full, q("2026-12-24", "2026-12-24"))).toBeUndefined(); // 0박
  });
});

// ── 가짜 TourAPI ─────────────────────────────────────────────────────────
type Prop = { id: string; addr1: string; fees?: Partial<Record<"a" | "b" | "c" | "d", number>> };
const wrap = (items: object[] | object | "", total = 0) =>
  JSON.stringify({ response: { header: { resultCode: "0000", resultMsg: "OK" }, body: { items: items === "" ? "" : { item: items }, totalCount: total } } });

function fakeApi(props: Prop[], calls: string[] = [], opts: { failDetail?: boolean } = {}) {
  return (async (u: string) => {
    const url = new URL(u);
    const op = url.pathname.split("/").pop()!;
    calls.push(op);
    if (op === "searchStay2") {
      const page = Number(url.searchParams.get("pageNo"));
      const slice = props.slice((page - 1) * 100, page * 100);
      return new Response(slice.length ? wrap(slice.map((p) => ({ contentid: p.id, addr1: p.addr1 })), props.length) : wrap("", props.length));
    }
    if (opts.failDetail) throw new Error("network");
    const p = props.find((x) => x.id === url.searchParams.get("contentId"))!;
    const f = p.fees ?? {};
    return new Response(wrap([{ roomtitle: "r", roomoffseasonminfee1: String(f.a ?? 0), roomoffseasonminfee2: String(f.b ?? 0), roompeakseasonminfee1: String(f.c ?? 0), roompeakseasonminfee2: String(f.d ?? 0) }], 1));
  }) as unknown as typeof fetch;
}
const mkProps = (n: number, city = "부산광역시", priced = (i: number) => i % 2 === 0): Prop[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(1000 + i), addr1: `${city} 어딘가`, fees: priced(i) ? { a: 100_000 + i * 1000, b: 150_000 + i * 1000 } : {} }));

const memStore = (init: Record<string, any> = {}): LodgingStore & { data: Record<string, any> } => {
  const s = { data: init, load: () => s.data, save: (a: Record<string, any>) => { s.data = JSON.parse(JSON.stringify(a)); } };
  return s;
};

describe("TourAPI 숙박 Provider", () => {
  it("수집 전에는 fallback(샘플)을 쓰고, 수집 후 지역 중앙값을 쓴다", async () => {
    const f = fakeApi(mkProps(40));
    const p = createTourApiLodging("k", mock, { fetchFn: f, store: memStore() });
    const before = await p.perNightKRW(dest("busan"), q("2026-12-21", "2026-12-23")); // 월·화 박 (이 호출이 백그라운드 수집 시작)
    expect(before.source).toContain("mock");
    await p.warmUp([dest("busan")]);
    const after = await p.perNightKRW(dest("busan"), q("2026-12-21", "2026-12-23"));
    expect(after.source).toContain("TourAPI");
    expect(after.estimated).toBe(true);
    // 짝수 인덱스 20곳이 요금 보유: a = 100000 + i*1000 (i=0,2,..38) → 중앙값 = 100000 + 19000 = 119000
    expect(after.value).toBe(119_000);
    expect(after.source).toContain("20곳");
  });
  it("표본 추출: 숙소가 많아도 상세 조회는 60건 이내", async () => {
    const calls: string[] = [];
    await createTourApiLodging("k", mock, { fetchFn: fakeApi(mkProps(250), calls) }).warmUp([dest("busan")]);
    expect(calls.filter((c) => c === "detailInfo2")).toHaveLength(60);
    expect(calls.filter((c) => c === "searchStay2")).toHaveLength(3); // 250건 → 100씩 3페이지
  });
  it("강릉/여수는 주소의 시 이름으로 거른 목록만 사용", async () => {
    const calls: string[] = [];
    const props = [...mkProps(30, "강원특별자치도 강릉시"), ...mkProps(30, "강원특별자치도 춘천시").map((p, i) => ({ ...p, id: String(5000 + i) }))];
    await createTourApiLodging("k", mock, { fetchFn: fakeApi(props, calls) }).warmUp([dest("gangneung")]);
    expect(calls.filter((c) => c === "detailInfo2")).toHaveLength(30);
  });
  it("stats.total 은 도 전체가 아니라 시 이름으로 거른 숙소 수", async () => {
    const props = [...mkProps(30, "강원특별자치도 강릉시"), ...mkProps(30, "강원특별자치도 춘천시").map((p, i) => ({ ...p, id: String(5000 + i) }))];
    const store = memStore();
    await createTourApiLodging("k", mock, { fetchFn: fakeApi(props), store }).warmUp([dest("gangneung")]);
    expect(store.data.gangneung.stats.total).toBe(30);
  });
  it("요금 기재 숙소가 너무 적으면(n<5) fallback", async () => {
    const p = createTourApiLodging("k", mock, { fetchFn: fakeApi(mkProps(40, "부산광역시", (i) => i < 3)) });
    await p.warmUp([dest("busan")]);
    expect((await p.perNightKRW(dest("busan"), q("2026-12-21", "2026-12-23"))).source).toContain("mock");
  });
  it("범위 밖 요금(단위 오기재)은 제외", async () => {
    const props = mkProps(40).map((p) => ({ ...p, fees: p.fees && Object.keys(p.fees).length ? { a: 500, b: 99_999_999 } : {} }));
    const p = createTourApiLodging("k", mock, { fetchFn: fakeApi(props) });
    await p.warmUp([dest("busan")]);
    expect((await p.perNightKRW(dest("busan"), q("2026-12-21", "2026-12-23"))).source).toContain("mock");
  });
  it("상세 조회 실패가 절반 넘으면 캐시하지 않고 fallback, 기존 캐시는 유지", async () => {
    const logs: string[] = [];
    const p = createTourApiLodging("k", mock, { fetchFn: fakeApi(mkProps(40), [], { failDetail: true }), log: (m) => logs.push(m) });
    await p.warmUp([dest("busan")]);
    expect((await p.perNightKRW(dest("busan"), q("2026-12-21", "2026-12-23"))).source).toContain("mock");
    expect(logs.join("\n")).toContain("refresh failed");
  });
  it("해외 목적지는 호출 없이 fallback, 평점은 항상 fallback", async () => {
    const calls: string[] = [];
    const p = createTourApiLodging("k", mock, { fetchFn: fakeApi(mkProps(40), calls) });
    await p.warmUp(DESTINATIONS.filter((d) => !d.domestic));
    expect(calls).toHaveLength(0);
    expect((await p.perNightKRW(dest("tokyo"), q("2026-12-21", "2026-12-23"))).source).toContain("mock");
    expect((await p.rating(dest("busan"))).source).toContain("mock");
  });
  it("파일 캐시: 저장 후 재생성하면 수집 없이 바로 사용, 7일 지나면 백그라운드 갱신", async () => {
    const store = memStore();
    let t = 1_000_000;
    const calls: string[] = [];
    const p1 = createTourApiLodging("k", mock, { fetchFn: fakeApi(mkProps(40), calls), store, now: () => t });
    await p1.warmUp([dest("busan")]);
    expect(Object.keys(store.data)).toEqual(["busan"]);

    const calls2: string[] = [];
    const p2 = createTourApiLodging("k", mock, { fetchFn: fakeApi(mkProps(40), calls2), store, now: () => t + 1000 });
    expect((await p2.perNightKRW(dest("busan"), q("2026-12-21", "2026-12-23"))).source).toContain("TourAPI");
    await p2.warmUp([dest("busan")]);
    expect(calls2).toHaveLength(0); // 신선한 캐시 → 재수집 없음

    t += 8 * 24 * 3_600_000; // 8일 후: 오래된 값은 계속 쓰되 갱신 시작
    const calls3: string[] = [];
    const p3 = createTourApiLodging("k", mock, { fetchFn: fakeApi(mkProps(40), calls3), store, now: () => t });
    expect((await p3.perNightKRW(dest("busan"), q("2026-12-21", "2026-12-23"))).source).toContain("TourAPI");
    await p3.warmUp([dest("busan")]);
    expect(calls3.length).toBeGreaterThan(0);
  });
  it("동시에 여러 번 요청해도 수집은 한 번만(in-flight 공유)", async () => {
    const calls: string[] = [];
    const p = createTourApiLodging("k", mock, { fetchFn: fakeApi(mkProps(40), calls) });
    await Promise.all([p.perNightKRW(dest("busan"), q("2026-12-21", "2026-12-23")), p.perNightKRW(dest("busan"), q("2026-12-21", "2026-12-23")), p.warmUp([dest("busan")])]);
    expect(calls.filter((c) => c === "detailInfo2")).toHaveLength(40);
  });
});
