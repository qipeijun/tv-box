import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FilmPoster } from "./film-poster";
import { Button } from "./ui/button";
import type { Film } from "@/lib/api";

export function FilmShelf({
  title,
  subtitle,
  films,
  onSelect,
  onViewAll,
}: {
  title: string;
  subtitle?: string;
  films: Film[];
  onSelect: (film: Film) => void;
  onViewAll?: (trigger: HTMLButtonElement) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const sync = () => setEdges({ start: element.scrollLeft <= 1,
      end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 });
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    element.addEventListener("scroll", sync, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener("scroll", sync); };
  }, [films]);
  if (!films.length) return null;
  return (
    <section className="media-shelf" aria-label={title}>
      <div className="shelf-heading">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className="shelf-actions">
          {onViewAll ? (
            <Button
              variant="ghost"
              className="shelf-view-all"
              aria-label={`浏览全部${title}`}
              onClick={(event) => onViewAll(event.currentTarget)}
            >
              查看全部
              <ChevronRight />
            </Button>
          ) : null}
          <div className="shelf-arrows">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`向前浏览${title}`}
              disabled={edges.start}
              onClick={() =>
                rail.current?.scrollBy({
                  left: -rail.current.clientWidth * 0.8,
                  behavior: matchMedia("(prefers-reduced-motion: reduce)")
                    .matches
                    ? "instant"
                    : "smooth",
                })
              }
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`向后浏览${title}`}
              disabled={edges.end}
              onClick={() =>
                rail.current?.scrollBy({
                  left: rail.current.clientWidth * 0.8,
                  behavior: matchMedia("(prefers-reduced-motion: reduce)")
                    .matches
                    ? "instant"
                    : "smooth",
                })
              }
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
      <div className="poster-rail" ref={rail}>
        {films.map((film) => (
          <button
            key={film.id}
            className="poster-card"
            onClick={() => onSelect(film)}
            aria-label={`查看${film.name}`}
          >
            <div className="poster-card-art">
              <FilmPoster
                key={film.poster}
                url={film.poster}
                name={film.name}
              />
              {film.remarks ? (
                <span className="poster-tag">{film.remarks}</span>
              ) : null}
            </div>
            <h3>{film.name}</h3>
            <p>{[film.category, film.year].filter(Boolean).join(" · ")}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
