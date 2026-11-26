import { DESTINATIONS } from "./data.js";
import { createProviders } from "./providers/index.js";
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);
const { providers, live } = createProviders();
const app = buildServer({ providers, apiToken: process.env.APP_API_TOKEN });
app.listen({ port, host: "0.0.0.0" }).then(() => console.log(`listening on :${port} | live: ${live.join(", ") || "none"} | 나머지는 mock`));

// 숙소 등록요금 수집은 첫 호출이 느려서(실측 최대 ~1분) 시작 직후 국내 도시를 미리 조회해 캐시를 채운다(실패 무시).
const today = new Date().toISOString().slice(0, 10);
for (const d of DESTINATIONS.filter((x) => x.domestic)) {
  void providers.lodging.perNightKRW(d, { origin: "ICN", startDate: today, endDate: today, travelers: 2 }).catch(() => {});
}
