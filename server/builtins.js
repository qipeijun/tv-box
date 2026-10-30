import config from "./builtin-sites.json" with { type: "json" };
import extended from "./extended-sites.json" with { type: "json" };

// 内置列表只收录已核验的公开配置；核验记录不等同于永久在线或全部影片可播放。
export const builtins = [
  {
    id: "curated",
    name: "映场精选片库",
    description: `${config.sites.length} 个已核验内容接口，打开即可浏览`,
    checkedAt: "2026-10-29",
    config,
    source: "https://github.com/qipeijun/tv-box",
  },
  {
    id: "extended",
    name: "扩展影视片库",
    description: `${extended.sites.length} 个新增入口，内容接口与样本清单已核验`,
    checkedAt: "2026-10-29",
    config: extended,
    source: "https://github.com/qipeijun/tv-box",
  },
  {
    id: "cloud-public", name: "公开网盘片库", checkedAt: "2026-10-30",
    description: "KK 网盘公开内容接口；夸克分享目录可读，播放需本人登录",
    source: "https://www.kkpans.com/",
    config: { sites: [{ key: "kkpans-public", name: "KK网盘（公开接口）", type: 3, api: "node_kkpans_public", searchable: 1 }] },
  },
  {
    id: "fantaiying",
    name: "饭太硬",
    description: "部分点播已有后端适配，其他站点逐步接入；直播入口可单独查看",
    checkedAt: "2026-10-29",
    url: "https://cdn09022024.gitlink.org.cn/api/v1/repos/xxooo/in/raw/in.bmp",
    source: "https://www.饭太硬.net/",
  },
  {
    id: "moontv",
    name: "MoonTV 公共片库",
    description: "电影天堂、无尽、魔都等公开内容入口",
    checkedAt: "2026-10-29",
    url: "https://cdn.jsdelivr.net/gh/samqin123/MoonTV@main/config.json",
    source: "https://github.com/samqin123/MoonTV/blob/main/config.json",
  },
  {
    id: "tvboxorg",
    name: "TVboxorg 公共片库",
    description: "公开维护的聚合订阅，可手动更新",
    checkedAt: "2026-10-29",
    url: "https://cdn.jsdelivr.net/gh/TVboxorg/TVbox@main/dist/official.json",
    source: "https://github.com/TVboxorg/TVbox",
  },
  {
    id: "jiusanzhou",
    name: "Zoe 公共片库",
    description: "另一组公开维护的影视订阅",
    checkedAt: "2026-10-29",
    url: "https://cdn.jsdelivr.net/gh/jiusanzhou/tvbox@main/tvbox.json",
    source: "https://github.com/jiusanzhou/tvbox",
  },
];

export function publicBuiltins() {
  return builtins.map(({ config, ...item }) => item);
}
