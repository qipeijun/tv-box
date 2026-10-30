import { access } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import staticPlugin from "@fastify/static";
import { createApp } from "./app.js";

/** API 与静态资源使用同一服务；生产构建缺失时启动失败，不交付空白站点。 */
export async function createWebServer(config, { logger = true, root = fileURLToPath(new URL("../dist", import.meta.url)) } = {}) {
  if (config.production) {
    try { await access(join(root, "index.html")); }
    catch { throw Error("缺少 dist/index.html，请先执行 npm run build。"); }
  }
  const app = createApp({ logger, allowedOrigins: config.origins });
  if (config.production) {
    await app.register(staticPlugin, {
      root,
      setHeaders(response, path) {
        if (basename(path) === "index.html") response.header("Cache-Control", "no-cache");
        else if (/[/\\]assets[/\\][^/\\]+-[\w-]+\.(?:js|css)$/.test(path))
          response.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    });
  }
  return app;
}
