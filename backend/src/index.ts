import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);
const app = buildServer({ apiToken: process.env.APP_API_TOKEN });
app.listen({ port, host: "0.0.0.0" }).then(() => console.log(`listening on :${port} (providers: mock)`));
