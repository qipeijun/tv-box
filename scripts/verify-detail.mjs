import { createServer } from "vite";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";

// 仅在内存中转换与渲染组件，不监听端口、不启动浏览器或执行页面副作用。
const vite = await createServer({
  configFile: false,
  resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
});
try {
  const { EpisodePicker } = await vite.ssrLoadModule("/src/components/episode-picker.tsx");
  const { DesktopFilmLayout, MobileFilmLayout } = await vite.ssrLoadModule("/src/components/film-layouts.tsx");
  const { FilmSynopsis } = await vite.ssrLoadModule("/src/components/film-synopsis.tsx");
  const { FilmDetails } = await vite.ssrLoadModule("/src/components/film-details.tsx");
  const episodes = Array.from({ length: 538 }, (_, i) => ({
    id: String(i), name: `第${i + 1}期：完整节目名称`,
    url: `https://example.com/${i}`, mime: "video/mp4", reason: "",
  }));
  episodes[0].name = "20221102期";
  const film = { id: "long-show", name: "综艺", poster: null, description: "一句话。", lines: [{ name: "线路", episodes }] };
  const props = { film, activeId: "0", onPlay() {}, onDescendingChange() {}, activeLabel: "待播放" };
  const ascending = renderToStaticMarkup(h(EpisodePicker, { ...props, descending: false }));
  assert.match(ascending, /data-long-names="true"/);
  assert.match(ascending, /待播放 · 20221102期/);
  const descending = renderToStaticMarkup(h(EpisodePicker, { ...props, descending: true }));
  assert.match(descending, /定位待播放/);
  assert.match(descending, /第538期：完整节目名称/);
  assert.match(descending, /value="0" selected=""/);
  const playing = renderToStaticMarkup(h(EpisodePicker, { ...props, descending: true, activeLabel: "正在播放" }));
  assert.match(playing, /value="17" selected=""/);
  const single = renderToStaticMarkup(h(EpisodePicker, { ...props, film: { ...film, lines: [{ name: "线路", episodes: [episodes[0]] }] }, descending: true }));
  assert.doesNotMatch(single, /集数范围/);
  const layout = { title: "测试", identity: h("h1", null, "测试"), actions: h("button", null, "播放 第01集"), artwork: h("img", { src: "/poster.jpg", alt: "海报" }) };
  for (const backdrop of [undefined, h("img", { src: "/background.jpg", alt: "" })]) {
    const html = renderToStaticMarkup(h(DesktopFilmLayout, { ...layout, backdrop }));
    assert.match(html, /film-desktop-poster/);
    assert.match(html, /film-desktop-intro/);
  }
  assert.doesNotMatch(renderToStaticMarkup(h(DesktopFilmLayout, { ...layout, hasArtwork: false })), /class="film-desktop-poster"/);
  assert.match(renderToStaticMarkup(h(MobileFilmLayout, { ...layout, hasArtwork: false })), /data-has-artwork="false"/);
  assert.match(renderToStaticMarkup(h(FilmSynopsis, { description: " ", mobile: true })), /暂无剧情简介/);
  const synopsis = renderToStaticMarkup(h(FilmSynopsis, { description: "一句话。", mobile: true }));
  assert.doesNotMatch(synopsis, /展开简介/);
  assert.match(synopsis, /-webkit-line-clamp:4/);
  const detail = { film, scope: "test", loading: false, error: "", related: [], favorite: false, favoriteWritable: true, favoriteError: "", descending: false,
    onDescendingChange() {}, onFavorite() {}, onBack() {}, onPlay() {}, onRetry() {}, onLibrary() {}, onSelect() {} };
  const ready = renderToStaticMarkup(h(FilmDetails, detail));
  assert.match(ready, /播放 20221102期/);
  assert.match(ready, /待播放 · 20221102期/);
  const resume = renderToStaticMarkup(h(FilmDetails, { ...detail, initialEpisodeId: "0", continueEpisodeId: "0", continuePosition: 92 }));
  assert.match(resume, /继续 20221102期 · 1:32/);
  assert.match(resume, /上次观看 · 20221102期/);
  console.log("详情组件静态渲染检查通过：长集名、倒序首组、播放定位、单集、补图结构、无图、简介与续播语义。");
} finally {
  await vite.close();
}
