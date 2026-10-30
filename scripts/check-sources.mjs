import { readFile } from "node:fs/promises";
import { readRemoteJson, readRemoteText } from "../server/remote.js";
import { parseCms, cmsUrl } from "../server/sources.js";

// 手动运行核验，不在应用启动或浏览过程中扫描全部源。
const { sites } = JSON.parse(
  await readFile(
    new URL("../server/builtin-sites.json", import.meta.url),
    "utf8",
  ),
);
const results = [];
for (let offset = 0; offset < sites.length; offset += 4) {
  const batch = await Promise.all(
    sites.slice(offset, offset + 4).map(async (site) => {
      let content = false;
      try {
        const data = await readRemoteJson(cmsUrl(site.api));
        const sample = parseCms(
          { code: 1, list: data.list.slice(0, 1) },
          true,
        )[0];
        content = true;
        const media = sample?.lines
          .flatMap((line) => line.episodes)
          .find((episode) => episode.mime === "application/x-mpegURL");
        const manifest = media
          ? (await readRemoteText(media.url)).trimStart().startsWith("#EXTM3U")
          : false;
        return {
          key: site.key,
          name: site.name,
          api: site.api,
          content: true,
          manifest,
          sampleId: sample?.id,
        };
      } catch (error) {
        return {
          key: site.key,
          name: site.name,
          api: site.api,
          content,
          reason: error.message,
        };
      }
    }),
  );
  results.push(...batch);
}
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      scope: "内容接口与样本HLS清单，不等同于浏览器实际播放保证",
      results,
    },
    null,
    2,
  ),
);
