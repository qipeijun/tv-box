/* 仅用于本机隔离浏览器上下文；用本机短片替换测试影片数据，不在产品中导入。 */
(() => {
  if (
    location.hostname !== "127.0.0.1" ||
    !new URLSearchParams(location.search).get("review")?.startsWith("auto-next")
  )
    return;
  if (window.__autoNextFixtureInstalled) return;
  window.__autoNextFixtureInstalled = true;
  const mode = new URLSearchParams(location.search).get("mode");
  const media = `${location.origin}/__playback_check__/next.mp4`;
  const item = (id, name) => ({
    id,
    name,
    url: media,
    mime: "video/mp4",
    reason: "",
  });
  const film = {
    id: "fixture",
    name: "自动连播验证",
    poster: null,
    year: "",
    category: "剧集",
    remarks: "3 集隔离数据",
    description: "使用本机短片验证结束事件，不代表真实节目。",
    lines: [
      {
        name: "测试线路",
        episodes: ["特别篇", "第02集", "第01集"].map((name, i) =>
          item(`0:${i}`, name),
        ),
      },
      {
        name: "下一项不可播放",
        episodes: [
          item("1:0", "第一集"),
          {
            id: "1:1",
            name: "第二集",
            url: "https://example.com/share",
            mime: null,
            reason: "分享页面",
          },
          item("1:2", "第三集"),
        ],
      },
    ],
  };
  const sub = {
    id: "next-fixture",
    name: "验证片库",
    revision: "next-fixture-v1",
    fetchedAt: new Date().toISOString(),
    sites: [
      {
        key: "main",
        name: "验证站点",
        supported: true,
        searchable: true,
        reason: "",
      },
    ],
    livePlaylists: [],
  };
  localStorage.setItem(
    "tvbox.library.v1",
    JSON.stringify({
      version: 2,
      selection: { builtinId: "curated" },
      customs: [],
      siteKeys: { "builtin:curated": "main" },
    }),
  );
  if (mode === "corrupt" && localStorage.getItem("tvbox.playback.v1") === null)
    localStorage.setItem("tvbox.playback.v1", "{invalid-next");
  const originalFetch = window.fetch;
  const json = (value) =>
    new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    });
  window.fetch = (input, init) => {
    const path = new URL(String(input), location.origin).pathname;
    if (path === "/api/subscriptions") return Promise.resolve(json(sub));
    if (path === "/api/builtins")
      return Promise.resolve(
        json({
          subscriptions: [
            {
              id: "curated",
              name: "验证片库",
              description: "本机回归",
              checkedAt: "2026-10-30",
              source: "https://example.com",
            },
          ],
        }),
      );
    if (path === "/api/metadata/search")
      return Promise.resolve(json({ candidates: [] }));
    if (path.endsWith("/categories"))
      return Promise.resolve(json({ categories: [] }));
    if (path.endsWith("/videos/fixture"))
      return Promise.resolve(json({ film }));
    if (path.includes("/videos"))
      return Promise.resolve(
        json({ films: [film], pagination: { page: 1, pages: 1, total: 1 } }),
      );
    return originalFetch(input, init);
  };
  const probe = { plays: [], starts: [], ended: [] };
  window.__autoNextProbe = probe;
  window.__starts = probe.starts;
  window.__nodes = [];
  window.__playCalls = 0;
  const seen = new WeakSet();
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const owner = location.hash;
    probe.plays.push(owner);
    window.__playCalls = probe.plays.length;
    if (!seen.has(this)) {
      seen.add(this);
      window.__nodes.push(this);
      this.addEventListener('playing', () => {
        if (mode === 'slow') this.playbackRate = .01;
        const started = { hash: owner, time: this.currentTime };
        probe.starts.push(started);
        queueMicrotask(() => { started.record = JSON.parse(localStorage.getItem('tvbox.history.v1') || 'null')?.records[0]?.episodeName; });
      }, {once:true});
      this.addEventListener('ended', () => probe.ended.push(owner));
    }
    if (mode === 'deny-next' && probe.plays.length === 2) return Promise.reject(new DOMException('隔离自动播放限制', 'NotAllowedError'));
    return nativePlay.call(this);
  };
})();
