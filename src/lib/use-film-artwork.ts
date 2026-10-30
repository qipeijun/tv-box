import { useEffect, useRef, useState } from "react";
import { fitsArtwork, fitsBackdrop, type ImageSize } from "./artwork-quality";

/** 检查已确认属于当前影片的素材；加载完成前使用海报构图，不先放大再回退。 */
export function useFilmArtwork(sourcePoster: string | null, extraPoster: string | null, background: string | null, mobile: boolean) {
  const root = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<Record<string, ImageSize | null>>({});
  const [view, setView] = useState({ width: 0, height: 0, density: 1 });
  useEffect(() => {
    let active = true;
    for (const url of new Set([sourcePoster, extraPoster, background].filter((item): item is string => !!item))) {
      const image = new Image();
      image.referrerPolicy = "no-referrer";
      image.src = url;
      image.decode().then(() => {
        if (active) setSizes(previous => ({ ...previous, [url]: { width: image.naturalWidth, height: image.naturalHeight } }));
      }).catch(() => {
        if (active) setSizes(previous => ({ ...previous, [url]: null }));
      });
    }
    return () => { active = false; };
  }, [sourcePoster, extraPoster, background]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let resolution: MediaQueryList;
    function measure() {
      resolution?.removeEventListener("change", measure);
      const density = window.devicePixelRatio || 1;
      setView({ width: element!.clientWidth, height: window.innerHeight, density });
      resolution = matchMedia(`(resolution: ${density}dppx)`);
      resolution.addEventListener("change", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      resolution?.removeEventListener("change", measure);
    };
  }, [mobile]);
  const box = { width: view.width, height: mobile ? Math.max(300, Math.min(480, view.height * .64)) : Math.max(440, Math.min(740, view.height * .7)) };
  // 优先使用像素更充足的已匹配海报；同尺寸保留片库原图。
  const posters = [sourcePoster, extraPoster].filter((url): url is string => !!url && !!sizes[url]);
  posters.sort((a, b) => sizes[b]!.width * sizes[b]!.height - sizes[a]!.width * sizes[a]!.height);
  const poster = posters[0] || null;
  const useBackdrop = !mobile && !!background && !!sizes[background] && fitsBackdrop(sizes[background]!, box, view.density);
  const immersivePoster = mobile && !!poster && fitsArtwork(sizes[poster]!, box, view.density);
  const posterSize = poster ? sizes[poster] : null;
  return {
    root, poster, background: useBackdrop ? background : null, immersivePoster,
    // 低清素材仅作为模糊氛围层，完整前景海报继续限制物理像素放大。
    ambient: !mobile && !useBackdrop ? (background && sizes[background] ? background : poster) : null,
    // 完整海报同样限制物理像素放大，极低清图片宁可小幅展示。
    posterStyle: posterSize && !immersivePoster ? { maxWidth: Math.min(mobile ? 128 : 360, posterSize.width / view.density, (mobile ? 192 : 540) * posterSize.width / posterSize.height), maxHeight: mobile ? 192 : 540 } : undefined,
  };
}
