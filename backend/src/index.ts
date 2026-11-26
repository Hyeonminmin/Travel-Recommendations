import { createProviders } from "./providers/index.js";
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);
const { providers, live, warmUp } = createProviders();
const app = buildServer({ providers, apiToken: process.env.APP_API_TOKEN });
app.listen({ port, host: "0.0.0.0" }).then(() => console.log(`listening on :${port} | live: ${live.join(", ") || "none"} | 나머지는 mock`));
warmUp().catch((e) => console.warn("warm-up failed:", (e as Error).message)); // 숙소 요금 등 느린 수집은 서버 기동을 막지 않는다
