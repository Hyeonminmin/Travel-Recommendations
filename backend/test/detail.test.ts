import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const qs = "startDate=2026-12-10&endDate=2026-12-14&travelers=2";
describe("GET /destination/:id", () => {
  it("상세 원자료를 출처와 함께 반환", async () => {
    const r = await buildServer().inject({ url: `/destination/jeju?${qs}` });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.destination.id).toBe("jeju");
    for (const k of ["flight", "lodgingPerNight", "lodgingRating", "weather", "events", "holidays", "places", "hotels"]) expect(b[k].source).toBeTruthy();
  });
  it("없는 id 404, 날짜 오류 400, 토큰 필요 시 401", async () => {
    expect((await buildServer().inject({ url: `/destination/nope?${qs}` })).statusCode).toBe(404);
    expect((await buildServer().inject({ url: "/destination/jeju?startDate=2026-12-14&endDate=2026-12-10" })).statusCode).toBe(400);
    expect((await buildServer({ apiToken: "t" }).inject({ url: `/destination/jeju?${qs}` })).statusCode).toBe(401);
  });
});
