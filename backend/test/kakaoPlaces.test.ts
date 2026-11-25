import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createKakaoPlaces, parseDocs } from "../src/providers/kakaoPlaces.js";
import { createMockProviders } from "../src/providers/mock.js";

const jeju = DESTINATIONS[0];
const tokyo = DESTINATIONS.find((d) => !d.domestic)!;
const mock = createMockProviders().place;
const doc = { place_name: "수두리보말칼국수", category_name: "음식점 > 한식 > 국수 > 칼국수", road_address_name: "제주 천제연로 192", address_name: "제주 중문동", place_url: "http://place.map.kakao.com/1", x: "126.4", y: "33.2" };

describe("kakao places", () => {
  it("음식점/관광명소 두 번 검색하고 인증 헤더 전송", async () => {
    const calls: { url: string; auth: string }[] = [];
    const f = (async (u: string, init: any) => { calls.push({ url: u, auth: init.headers.Authorization }); return new Response(JSON.stringify({ documents: [doc] })); }) as unknown as typeof fetch;
    const r = await createKakaoPlaces("KEY", mock, f).places(jeju);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.auth === "KakaoAK KEY")).toBe(true);
    expect(calls.map((c) => c.url).join()).toContain("category_group_code=FD6");
    expect(r.value.restaurants[0]).toMatchObject({ name: "수두리보말칼국수", category: "국수 > 칼국수", address: "제주 천제연로 192", lat: 33.2, lon: 126.4 });
    expect(r.estimated).toBe(false);
  });
  it("해외·실패·HTTP 오류는 mock fallback", async () => {
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    const bad = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    expect((await createKakaoPlaces("K", mock, boom).places(tokyo)).source).toContain("mock");
    expect((await createKakaoPlaces("K", mock, boom).places(jeju)).source).toContain("mock");
    expect((await createKakaoPlaces("K", mock, bad).places(jeju)).source).toContain("mock");
  });
  it("빈 응답 파싱", () => expect(parseDocs({})).toEqual([]));
});
