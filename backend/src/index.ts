import { createProviders } from "./providers/index.js";
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);
const { providers, live } = createProviders();
const app = buildServer({ providers, apiToken: process.env.APP_API_TOKEN });
app.listen({ port, host: "0.0.0.0" }).then(() => console.log(`listening on :${port} | live: ${live.join(", ") || "none"} | 나머지는 mock`));
