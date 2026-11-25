import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createMockProviders } from "../src/providers/mock.js";
import { createTourApiEvents, extractItems, normalizeServiceKey } from "../src/providers/tourApi.js";

const [jeju, , , tokyo] = [DESTINATIONS[0], 0, 0, DESTINATIONS.find((d) => !d.domestic)!];
const q = { origin: "ICN", startDate: "2026-12-10", endDate: "2026-12-14", travelers: 1 };
const body = (item: unknown) => JSON.stringify({ response: { header: { resultCode: "0000" }, body: { items: { item } } } });
const mock = createMockProviders().event;

describe("TourAPI events", () => {
  it("기간이 겹치고 주소에 도시명이 있는 행사만 반환", async () => {
    const f = (async () => new Response(body([
      { title: "제주 겨울축제", addr1: "제주특별자치도 제주시", eventstartdate: "20261212", eventenddate: "20261220" },
      { title: "기간 밖", addr1: "제주 서귀포", eventstartdate: "20270101", eventenddate: "20270105" },
      { title: "다른 지역", addr1: "서울", eventstartdate: "20261210", eventenddate: "20261211" },
    ]))) as unknown as typeof fetch;
    const r = await createTourApiEvents("k", mock, f).events(jeju, q);
    expect(r.value.map((e) => e.name)).toEqual(["제주 겨울축제"]);
    expect(r.value[0].startDate).toBe("2026-12-12");
    expect(r.estimated).toBe(false);
  });
  it("KorService2 실패 시 KorService1 로 재시도", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return urls.length === 1 ? new Response("x", { status: 404 }) : new Response(body({ title: "단건", addr1: "제주", eventstartdate: "20261210", eventenddate: "20261211" })); }) as unknown as typeof fetch;
    const r = await createTourApiEvents("k", mock, f).events(jeju, q);
    expect(urls[1]).toContain("KorService1");
    expect(r.value).toHaveLength(1);
  });
  it("해외 목적지·API 실패는 mock fallback", async () => {
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect((await createTourApiEvents("k", mock, boom).events(jeju, q)).source).toContain("mock");
    expect((await createTourApiEvents("k", mock, boom).events(tokyo, q)).source).toContain("mock");
  });
  it("키 정규화/빈 응답 처리", () => {
    expect(normalizeServiceKey("a%2Bb")).toBe("a+b");
    expect(extractItems({ response: { body: { items: "" } } })).toEqual([]);
  });
});
