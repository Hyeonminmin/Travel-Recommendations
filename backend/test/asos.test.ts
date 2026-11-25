import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../src/data.js";
import { createAsosClimatology, yearsBack } from "../src/providers/asos.js";
import { createMockProviders } from "../src/providers/mock.js";

const jeju = DESTINATIONS[0];
const tokyo = DESTINATIONS.find((d) => !d.domestic)!;
const mock = createMockProviders().weather;
const today = () => new Date("2026-11-26T00:00:00Z");
const q = { origin: "ICN", startDate: "2027-02-10", endDate: "2027-02-11", travelers: 1 };
const resp = (items: unknown[]) => JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: items } } } });

describe("ASOS climatology", () => {
  it("3년치 평균기온과 강수일 비율(빈 sumRn=무강수)", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response(resp([{ avgTa: "4.0", sumRn: "" }, { avgTa: "6.0", sumRn: "0.2" }])); }) as unknown as typeof fetch;
    const r = await createAsosClimatology("k", mock, f, today).forecast(jeju, q);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain("stnIds=184");
    expect(urls[0]).toContain("startDt=20260210");
    expect(r.value).toEqual({ avgTempC: 5, rainProb: 0.5 });
    expect(r.source).toContain("ASOS");
  });
  it("해외·오류·빈 결과는 fallback", async () => {
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    const empty = (async () => new Response(resp([]))) as unknown as typeof fetch;
    expect((await createAsosClimatology("k", mock, empty, today).forecast(tokyo, q)).source).toContain("mock");
    expect((await createAsosClimatology("k", mock, empty, today).forecast(jeju, q)).source).toContain("mock");
    expect((await createAsosClimatology("k", mock, boom, today).forecast(jeju, q)).source).toContain("mock");
  });
  it("윤일 보정", () => expect(yearsBack("2028-02-29", 1)).toBe("2027-02-28"));
});
