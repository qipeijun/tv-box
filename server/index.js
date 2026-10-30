import { readServerConfig } from "./config.js";
import { createWebServer } from "./runtime.js";

const config = readServerConfig();
const app = await createWebServer(config);
await app.listen({ host: config.host, port: config.port });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
