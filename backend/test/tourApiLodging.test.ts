import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createMockProviders } from "../src/providers/mock.js";
import { createTourApiLodging, extractRoomFees } from "../src/providers/tourApiLodging.js";

const busan = DESTINATIONS.find((d) => d.id === "busan")!;
const tokyo = DESTINATIONS.find((d) => !d.domestic)!;
const mock = createMockProviders().lodging;
const q = (s: string) => ({ origin: "ICN", startDate: s, endDate: s, travelers: 2 });
const wrap = (item: unknown) => JSON.stringify({ response: { header: { resultCode: "0000" }, body: { items: item ? { item } : "" } } });
const rooms = [{ roomoffseasonminfee1: "100000", roompeakseasonminfee1: "150000" }, { roomoffseasonminfee1: "0", roompeakseasonminfee1: "0" }];

function fakeFetch(stays = 3, perStay: unknown = rooms) {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(u);
    if (u.includes("searchStay2")) return new Response(wrap(Array.from({ length: stays }, (_, i) => ({ contentid: String(i + 1) }))));
    return new Response(wrap(perStay));
  }) as unknown as typeof fetch;
  return { f, urls };
}

describe("TourAPI lodging price estimate", () => {
  it("0(미등록) 제외, 단건/배열 처리", () => {
    expect(extractRoomFees(JSON.parse(wrap(rooms)))).toEqual({ off: [100000], peak: [150000] });
    expect(extractRoomFees(JSON.parse(wrap({ roomoffseasonminfee1: "80000" })))).toEqual({ off: [80000], peak: [] });
    expect(extractRoomFees(JSON.parse(wrap(undefined)))).toEqual({ off: [], peak: [] });
  });
  it("비수기/성수기 구분해 중앙값, 표본 수 표기", async () => {
    const { f } = fakeFetch(6); // 6곳 × 유효 1객실 = 6표본
    const p = createTourApiLodging("k", mock, f);
    const off = await p.perNightKRW(busan, q("2026-10-10"));
    const peak = await p.perNightKRW(busan, q("2026-12-24"));
    expect(off.value).toBe(100000);
    expect(peak.value).toBe(150000);
    expect(off.source).toContain("비수기");
    expect(off.source).toContain("표본 6");
    expect(off.estimated).toBe(true);
  });
  it("지역당 24h 캐시: 두 번째 조회는 호출 없음", async () => {
    const { f, urls } = fakeFetch(6);
    const p = createTourApiLodging("k", mock, f, () => 0);
    await p.perNightKRW(busan, q("2026-10-10"));
    const n = urls.length;
    await p.perNightKRW(busan, q("2026-12-24"));
    expect(urls.length).toBe(n);
  });
  it("표본 부족·해외·실패는 fallback", async () => {
    expect((await createTourApiLodging("k", mock, fakeFetch(2).f).perNightKRW(busan, q("2026-10-10"))).source).toContain("mock");
    expect((await createTourApiLodging("k", mock, fakeFetch(6).f).perNightKRW(tokyo, q("2026-10-10"))).source).toContain("mock");
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect((await createTourApiLodging("k", mock, boom).perNightKRW(busan, q("2026-10-10"))).source).toContain("mock");
  });
  it("수집이 느리면 이번 요청은 fallback, 수집 완료 후 다음 요청은 추정값", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = (async (u: string) => {
      await gate;
      return u.includes("searchStay2") ? new Response(wrap(Array.from({ length: 6 }, (_, i) => ({ contentid: String(i) })))) : new Response(wrap(rooms));
    }) as unknown as typeof fetch;
    const p = createTourApiLodging("k", mock, slow, () => 0, 3_600_000, 20);
    expect((await p.perNightKRW(busan, q("2026-10-10"))).source).toContain("mock");
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect((await p.perNightKRW(busan, q("2026-10-10"))).value).toBe(100000);
  });
});
