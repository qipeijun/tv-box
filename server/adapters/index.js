import { reboCategories, reboPage, reboDetail, reboPlay } from "./fantaiying.js";
import { nuomiCategories, nuomiPage, nuomiDetail, nuomiPlay } from "./nuomi.js";
import { trailerAdapter } from "./trailers.js";
import { kkpansAdapter } from "./kkpans.js";

// 只登记项目内已实现的适配；不加载订阅提供的脚本或运行器。
export const nativeAdapters = {
  kkpans: kkpansAdapter,
  trailers: trailerAdapter,
  rebo: {
    categories: (site, io) => reboCategories(site, io.json),
    page: (site, query, io, options) => reboPage(site, query, io.json, options),
    detail: (site, id, io, options) => reboDetail(site, id, io.json, options),
    play: (_site, raw, io, options) => reboPlay(raw, io.json, options),
  },
  nuomi: {
    categories: (site, io) => nuomiCategories(site, io.text),
    page: (site, query, io, options) => nuomiPage(site, query, io.text, options),
    detail: (site, id, io, options) => nuomiDetail(site, id, io.text, options),
    play: (site, raw, io, options) => nuomiPlay(site, raw, io.text, options),
  },
};
