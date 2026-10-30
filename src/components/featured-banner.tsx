import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Button } from "./ui/button";
import { FilmPoster } from "./film-poster";
import type { Film } from "@/lib/api";
export function FeaturedBanner({
  films,
  source,
  busy = false,
  continueIds,
  onOpen,
  onPlay,
}: {
  films: Film[];
  source?: string;
  busy?: boolean;
  continueIds: Set<string>;
  onOpen: (film: Film) => void;
  onPlay: (film: Film) => void;
}) {
  const candidates = films.filter((f) => f.poster).slice(0, 5);
  const slides = candidates.length ? candidates : films.slice(0, 5);
  const [selected, setSelected] = useState("");
  const index = Math.max(
    0,
    slides.findIndex((f) => f.id === selected),
  );
  const current = slides[index];
  // 0：海报归位；负值：向下一部拖动；正值：向上一部拖动，单位为卡片宽度比例。
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [animate, setAnimate] = useState(false);
  // true：允许自动轮播；false：用户主动暂停，离开悬停后也不自行恢复。
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const rail = useRef<HTMLDivElement>(null);
  const manual = useRef(false);
  const posters = useRef<HTMLDivElement>(null);
  // 空值表示没有手势；dragged 表示已确认横向拖动，需要拦截随后产生的点击。
  const gesture = useRef<{ id: number; x: number; y: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  const wheelChange = useEffectEvent((direction: number) => change(direction, true));
  useEffect(() => {
    const element = posters.current;
    if (!element) return;
    let total = 0;
    let lastEvent = 0;
    let consumed = false;
    let lastDirection = 0;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || slides.length < 2) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      // 只在海报区域接管滚轮；双指缩放保留给浏览器。
      event.preventDefault();
      const now = performance.now();
      const delta = (horizontal ? event.deltaX : event.deltaY) *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1);
      if (now - lastEvent > 180) {
        total = 0;
        consumed = false;
      }
      if (lastDirection && Math.sign(delta) !== lastDirection) {
        total = 0;
        consumed = false;
      }
      lastDirection = Math.sign(delta);
      lastEvent = now;
      // 一次连续滚动只翻一页，避免触摸板惯性连续跳过影片。
      if (consumed) return;
      total += delta;
      if (Math.abs(total) >= 40) {
        wheelChange(Math.sign(total));
        total = 0;
        consumed = true;
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [slides.length]);
  const shell = useRef<HTMLElement>(null);
  const selectedIndex = useRef(index);
  selectedIndex.current = index;
  useEffect(() => {
    const query = matchMedia("(max-width:700px)");
    const sync = () => {
      const track = rail.current;
      const card = track?.children[selectedIndex.current] as
        | HTMLElement
        | undefined;
      if (query.matches && track && card) {
        manual.current = true;
        track.scrollTo({
          left: card.offsetLeft - (track.clientWidth - card.clientWidth) / 2,
          behavior: "instant",
        });
        manual.current = false;
      }
    };
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (selected && !slides.some((f) => f.id === selected)) setSelected("");
  }, [films]);
  const advance = useEffectEvent(() => change(1, true));
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(media.matches);
    const syncVisibility = () => setPageVisible(!document.hidden);
    const endDrag = () => setDragging(false);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    if (shell.current) observer.observe(shell.current);
    media.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);
  useEffect(() => {
    // 自动轮播只在用户没有操作且影片可见时运行，减少动态效果时不自动切换。
    if (!autoEnabled || reducedMotion || hovered || focused || dragging || !inView || !pageVisible || busy || slides.length < 2) return;
    const timer = setTimeout(advance, 6000);
    return () => clearTimeout(timer);
  }, [autoEnabled, reducedMotion, hovered, focused, dragging, inView, pageVisible, busy, current?.id, slides.length]);
  if (!current) return null;
  function select(next: number, smooth = false) {
    gesture.current = null;
    setDragOffset(0);
    setAnimate(smooth);
    if (posters.current) delete posters.current.dataset.dragging;
    setSelected(slides[next].id);
    const track = rail.current;
    const card = track?.children[next] as HTMLElement | undefined;
    if (track && card && matchMedia("(max-width:700px)").matches) {
      manual.current = true;
      track.scrollTo({
        left: card.offsetLeft - (track.clientWidth - card.clientWidth) / 2,
        behavior:
          smooth && !matchMedia("(prefers-reduced-motion:reduce)").matches
            ? "smooth"
            : "instant",
      });
    }
  }
  function change(offset: number, smooth = false) {
    select((index + offset + slides.length) % slides.length, smooth);
  }
  function followScroll() {
    const track = rail.current;
    if (!track || manual.current) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let next = 0,
      distance = Infinity;
    [...track.children].forEach((child, i) => {
      const card = child as HTMLElement;
      const currentDistance = Math.abs(
        card.offsetLeft + card.offsetWidth / 2 - center,
      );
      if (currentDistance < distance) {
        distance = currentDistance;
        next = i;
      }
    });
    if (slides[next]) setSelected(slides[next].id);
  }
  return (
    <section
      ref={shell}
      className="feature-stage feature-carousel"
      aria-roledescription="轮播"
      aria-label="首页焦点影片"
      tabIndex={0}
      onPointerDownCapture={() => setDragging(true)}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          change(-1);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          change(1);
        }
      }}
    >
      <div className="feature-atmosphere" aria-hidden="true" />
      <div className="feature-copy">
        <p className="feature-kicker">最近更新</p>
        <h1>{current.name}</h1>
        <p className="feature-meta">
          {[current.year, current.category, current.remarks]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="feature-description">
          {current.description || "片库暂未提供这部影片的简介。"}
        </p>
        <div className="feature-actions">
          <Button size="lg" disabled={busy} onClick={() => onPlay(current)}>
            <Play fill="currentColor" />
            {continueIds.has(current.id) ? "继续观看" : "播放"}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => onOpen(current)}>
            查看详情
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div
        ref={posters}
        className="feature-posters"
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || slides.length < 2) return;
          suppressClick.current = false;
          gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
        }}
        onPointerMove={(event) => {
          const active = gesture.current;
          if (!active || active.id !== event.pointerId) return;
          const dx = event.clientX - active.x;
          const dy = event.clientY - active.y;
          if (!active.dragged && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
            gesture.current = null;
            return;
          }
          if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
            active.dragged = true;
            suppressClick.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.dataset.dragging = "true";
            setAnimate(false);
            setDragOffset(Math.max(-.9, Math.min(.9, dx / (event.currentTarget.clientWidth * .48))));
          }
        }}
        onPointerUp={(event) => {
          const active = gesture.current;
          if (!active || active.id !== event.pointerId) return;
          gesture.current = null;
          delete event.currentTarget.dataset.dragging;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          const dx = event.clientX - active.x;
          if (active.dragged && Math.abs(dx) >= 40) change(dx < 0 ? 1 : -1, true);
          else { setAnimate(true); setDragOffset(0); }
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setAnimate(true);
          setDragOffset(0);
          if (posters.current) delete posters.current.dataset.dragging;
        }}
        onLostPointerCapture={() => {
          gesture.current = null;
          setAnimate(true);
          setDragOffset(0);
          if (posters.current) delete posters.current.dataset.dragging;
        }}
        onClickCapture={(event) => {
          if (suppressClick.current && event.detail > 0) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {slides.map((film, slideIndex) => {
          let distance = (slideIndex - index + slides.length) % slides.length;
          if (distance > slides.length / 2) distance -= slides.length;
          const position = distance + dragOffset;
          const depth = Math.abs(position);
          const shown = Math.abs(distance) <= 1;
          return (
            <button
              key={film.id}
              className="feature-poster"
              data-current={distance === 0}
              aria-hidden={!shown}
              inert={!shown}
              tabIndex={distance === 0 ? 0 : -1}
              style={{
                transform: `translate(-50%, -50%) translateX(${position * 62}%) translateZ(${-depth * 110}px) rotateY(${-position * 20}deg)`,
                opacity: shown ? 1 : 0,
                zIndex: slides.length - Math.abs(distance),
                transition: animate ? undefined : "none",
              }}
              onClick={(event) => distance === 0 ? onOpen(film) : select(slideIndex, event.detail > 0)}
              aria-label={distance === 0 ? `查看${film.name}` : `切换到${film.name}`}
            >
              <FilmPoster key={film.poster} url={film.poster} name={film.name} />
            </button>
          );
        })}
      </div>
      <div
        ref={rail}
        className="feature-mobile-rail"
        onScroll={followScroll}
        onScrollEnd={() => {
          manual.current = false;
          followScroll();
        }}
        onPointerDown={() => {
          manual.current = false;
        }}
        onWheel={() => {
          manual.current = false;
        }}
      >
        {slides.map((film) => (
          <button
            key={film.id}
            onClick={() => onOpen(film)}
            aria-label={`查看${film.name}`}
          >
            <FilmPoster url={film.poster} name={film.name} />
          </button>
        ))}
      </div>
      <div className="feature-bottom">
        <span>{source}</span>
        <div className="feature-carousel-controls">
          <Button
            variant="ghost"
            size="icon"
            aria-label="上一部焦点影片"
            onClick={(event) => change(-1, event.detail > 0)}
            disabled={slides.length < 2}
          >
            <ChevronLeft />
          </Button>
          <div className="feature-pagination" aria-label="选择焦点影片">
            {slides.map((film, i) => (
              <button
                key={film.id}
                aria-label={`切换到${film.name}`}
                aria-pressed={i === index}
                onClick={(event) => select(i, event.detail > 0)}
              >
                <span />
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="下一部焦点影片"
            onClick={(event) => change(1, event.detail > 0)}
            disabled={slides.length < 2}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={slides.length < 2 || reducedMotion}
            aria-label={reducedMotion ? "减少动态效果已停用自动轮播" : autoEnabled ? "暂停自动轮播" : "开启自动轮播"}
            aria-pressed={autoEnabled && !reducedMotion}
            onClick={() => setAutoEnabled((value) => !value)}
          >
            {autoEnabled && !reducedMotion ? <Pause /> : <Play />}
          </Button>
          <span className="feature-slide-count" aria-live={autoEnabled && !focused && !hovered ? "off" : "polite"}>
            {index + 1} / {slides.length}
          </span>
        </div>
      </div>
    </section>
  );
}
