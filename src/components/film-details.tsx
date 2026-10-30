import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  ArrowLeft,
  Library,
  Play,
  RefreshCw,
  Star,
  ListVideo,
} from "lucide-react";
import { Button } from "./ui/button";
import { FilmSynopsis } from "./film-synopsis";
import { Skeleton } from "./ui/skeleton";
import { FilmPoster } from "./film-poster";
import { FilmShelf } from "./film-shelf";
import { EpisodePicker } from "./episode-picker";
import { CastPortrait, MetadataSearch, useFilmMetadata } from "./film-metadata";
import { matchEpisode, playableLines, playbackTime } from "@/lib/playback";
import { navigate } from "@/lib/navigation";
import { useFilmArtwork } from "@/lib/use-film-artwork";
import { useViewingDevice } from "@/lib/use-viewing-device";
import { DesktopFilmLayout, MobileFilmLayout } from "./film-layouts";
import type { Episode, Film, FilmDetail } from "@/lib/api";

export function FilmDetails({
  film,
  preview,
  loading,
  error,
  source,
  scope,
  initialEpisodeId,
  related,
  onBack,
  onPlay,
  onRetry,
  onLibrary,
  onSelect,
  requireSelection = false,
  continueEpisodeId,
  continuePosition = 0,
  onFindElsewhere,
  descending, onDescendingChange,
  favorite, favoriteError, favoriteWritable, onFavorite,
}: {
  film: FilmDetail | null;
  preview?: Film;
  loading: boolean;
  error: string;
  source?: string;
  scope: string;
  initialEpisodeId?: string | null;
  related: Film[];
  onBack: () => void;
  onPlay: (episode: Episode) => void;
  onRetry: () => void;
  onLibrary: () => void;
  onSelect: (film: Film) => void;
  onFindElsewhere?: () => void;
  descending: boolean;
  onDescendingChange: (value: boolean) => void;
  favorite: boolean;
  favoriteError: string;
  favoriteWritable: boolean;
  onFavorite: () => void;
  requireSelection?: boolean;
  continueEpisodeId?: string;
  continuePosition?: number;
}) {
  const mobile = useViewingDevice();
  const Layout = mobile ? MobileFilmLayout : DesktopFilmLayout;
  const errorHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (error) errorHeading.current?.focus({ preventScroll: true });
  }, [error]);
  return (
    <article className={`film-page detail-page viewing-detail ${mobile ? "viewing-detail-mobile" : "viewing-detail-desktop"}`}>
      <nav className="film-navigation" aria-label="影片导航">
        <Button
          variant="ghost"
          onClick={onBack}
          aria-label="返回上一页"
        >
          <ArrowLeft />
          返回
        </Button>
        {source ? (
          <Button variant="ghost" onClick={onLibrary}>
            <Library data-icon="inline-start" />
            <span>{source}</span>
          </Button>
        ) : null}
      </nav>
      {!film && (loading || preview) ? (
        <div aria-busy={loading}>
          <Layout title={preview?.name || "正在加载影片"} compactArtwork hasArtwork={!!preview?.poster}
            artwork={preview ? <FilmPoster url={preview.poster} name={preview.name} /> : <Skeleton className="film-loading-poster" />}
            identity={<>
              {preview ? <><h1 className="film-title">{preview.name}</h1><div className="film-facts">{[preview.year, preview.remarks].filter(Boolean).map((fact, i) => <span key={i}>{fact}</span>)}</div></> : <><Skeleton className="film-loading-title" /><Skeleton className="film-loading-facts" /></>}
            </>}
            actions={loading ? <div className="film-actions"><Button disabled><RefreshCw className="animate-spin" />正在准备播放</Button><p role="status">正在获取播放线路与集数…</p></div> : null}
            synopsis={preview?.description ? <section className="detail-synopsis"><h2>剧情简介</h2><p className="synopsis-collapsed">{preview.description}</p></section> : null}
          />
        </div>
      ) : null}
      {error ? (
        <section className="media-empty" role="alert">
          <h1 ref={errorHeading} tabIndex={-1}>
            影片暂时没有打开
          </h1>
          <p>{error}</p>
          <div>
            <Button onClick={onRetry}>
              <RefreshCw data-icon="inline-start" />
              重新加载
            </Button>
            <Button variant="outline" onClick={onLibrary}>
              选择其他片库
            </Button>
          </div>
        </section>
      ) : null}

      {film ? (
        <FilmContent
          key={`${scope}:${film.id}`}
          {...{
            film,
            scope,
            initialEpisodeId,
            related,
            onPlay,
            onLibrary,
            onSelect,
            requireSelection,
            continueEpisodeId,
            continuePosition,
            onFindElsewhere,
            descending, onDescendingChange,
  favorite, favoriteError, favoriteWritable, onFavorite,
          }}
        />
      ) : null}
    </article>
  );
}

function FilmContent({
  film,
  scope,
  initialEpisodeId,
  related,
  onPlay,
  onLibrary,
  onSelect,
  requireSelection,
  continueEpisodeId,
  continuePosition,
  onFindElsewhere,
  descending, onDescendingChange,
  favorite, favoriteError, favoriteWritable, onFavorite,
}: {
  film: FilmDetail;
  scope: string;
  initialEpisodeId?: string | null;
  related: Film[];
  onPlay: (episode: Episode) => void;
  onLibrary: () => void;
  onSelect: (film: Film) => void;
  requireSelection: boolean;
  continueEpisodeId?: string;
  continuePosition: number;
  onFindElsewhere?: () => void;
  descending: boolean;
  onDescendingChange: (value: boolean) => void;
  favorite: boolean;
  favoriteError: string;
  favoriteWritable: boolean;
  onFavorite: () => void;
}) {
  const mobile = useViewingDevice();
  const Layout = mobile ? MobileFilmLayout : DesktopFilmLayout;
  const lines = playableLines(film);
  const initial = requireSelection
    ? undefined
    : initialEpisodeId
      ? lines
          .flatMap((line) => line.episodes)
          .find((episode) => episode.id === initialEpisodeId)
      : lines[0]?.episodes[0];
  const [lineIndex, setLineIndex] = useState(
    () =>
      lines.find((line) =>
        line.episodes.some((episode) => episode.id === initial?.id),
      )?.index ?? lines[0]?.index,
  );
  const [selected, setSelected] = useState<Episode | null>(initial ?? null);
  // 跨站确认或无法唯一匹配集数时，即使只有一个条目也保留显式选择。
  const showChoices = lines.length > 1 || lines.some((line) => line.episodes.length > 1) || (lines.length > 0 && !selected);
  const choices = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const enrichment = useFilmMetadata(film, scope);
  const metadata = enrichment.metadata;
  const artwork = useFilmArtwork(film.poster, metadata?.poster || null, metadata?.background || null, mobile);

  const cast = metadata?.cast.length ? metadata.cast : [];
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [film.id]);
  function changeLine(index: number) {
    setLineIndex(index);
    const line = lines.find((item) => item.index === index);
    setSelected(
      line && selected ? matchEpisode(line.episodes, selected.name) : null,
    );
  }
  function showEpisodes() {
    const title = choices.current?.querySelector("h2");
    title?.setAttribute("tabindex", "-1");
    title?.focus({ preventScroll: true });
    choices.current?.scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  return <Layout title={film.name} artworkRef={artwork.root} compactArtwork={!artwork.immersivePoster} hasArtwork={!!film.poster}
    backdrop={artwork.background ? <img className="film-backdrop" src={artwork.background} alt="" referrerPolicy="no-referrer" /> : null}
    ambientBackdrop={artwork.ambient ? <img src={artwork.ambient} alt="" referrerPolicy="no-referrer" /> : null}
    artwork={artwork.poster ? <img src={artwork.poster} alt={`${film.name} 海报`} style={artwork.posterStyle} referrerPolicy="no-referrer" /> : <FilmPoster url={null} name={film.name} />}
    identity={<>
          {film.category ? (
            <p className="film-eyebrow">{film.category}</p>
          ) : null}
          <h1 className="film-title" ref={heading} tabIndex={-1}>
            {film.name}
          </h1>
    </>}
    facts={<>
          <div className="film-facts">
            {metadata?.rating ? (
              <a
                className="detail-rating"
                href={metadata.url}
                target="_blank"
                rel="noreferrer"
              >
                <Star aria-hidden="true" fill="currentColor" />
                <strong>{metadata.rating.toFixed(1)}</strong>
                <span>{metadata.ratingLabel}</span>
              </a>
            ) : null}
            {[
              film.year || metadata?.year,
              film.area,
              film.language,
              metadata?.runtime,
              film.remarks,
            ]
              .filter(Boolean)
              .map((fact, index) => (
                <span key={index}>{fact}</span>
              ))}
          </div>
    </>}
    actions={<>
          <div className="film-actions">
            {lines.length ? (
              <>
                <Button
                  size="lg"
                  onClick={() => (selected ? onPlay(selected) : showEpisodes())}
                >
                  <Play data-icon="inline-start" fill="currentColor" />
                  {selected
                    ? selected.id === continueEpisodeId
                      ? `继续 ${selected.name} · ${playbackTime(continuePosition)}`
                      : `播放 ${selected.name}`
                    : "选择集数"}
                </Button>
                {showChoices ? <Button variant="ghost" onClick={showEpisodes}>
                  <ListVideo data-icon="inline-start" />
                  选集与线路
                </Button> : null}
              </>
            ) : (
              <Button onClick={onLibrary}>选择其他片库</Button>
            )}
            <Button variant="outline" className="detail-favorite" aria-pressed={favorite}
              disabled={!favoriteWritable} onClick={onFavorite} aria-label={favorite ? "取消收藏" : "收藏影片"}>
              {favorite ? <Check /> : <Bookmark />}<span>{favorite ? "已收藏" : "收藏"}</span>
            </Button>
            {onFindElsewhere ? (
              <Button
                className="detail-find-source"
                variant="ghost"
                onClick={onFindElsewhere}
              >
                换站找片
              </Button>
            ) : null}
          </div>
          {favoriteError ? <p className="history-notice" role="status">{favoriteError}<Button variant="ghost" onClick={() => navigate("#history&view=favorites")}>打开我的收藏</Button></p> : null}
          {!selected ? <p className="film-playback-context" role="status">
            {lines.length
                ? "当前线路没有唯一对应集数，请选择要观看的一集。"
                : "当前来源没有适用的播放入口。"}
          </p> : null}
    </>}
    synopsis={<FilmSynopsis description={film.description} mobile={mobile} />}
    episodes={showChoices ? <>
        <div className="detail-episodes" ref={choices}>
          <EpisodePicker
            descending={descending}
            onDescendingChange={onDescendingChange}
            activeLabel={selected?.id === continueEpisodeId ? "上次观看" : "待播放"}
            showFullName={!mobile}
            film={film}
            activeId={selected?.id}
            selectedLineIndex={lineIndex}
            onLineChange={changeLine}
            onPlay={onPlay}
          />
        </div>
    </> : null}
    information={<>
        {cast.length ||
        film.actors ||
        film.director ||
        metadata?.directors.length ? (
          <section className="detail-credits" aria-label="演职员">
            <div className="detail-section-heading">
              <h2>演职员</h2>
              {metadata ? (
                <a href={metadata.url} target="_blank" rel="noreferrer">
                  {metadata.attribution}
                </a>
              ) : null}
            </div>
            {film.director || metadata?.directors.length ? (
              <p className="detail-director">
                导演
                <span>{film.director || metadata?.directors.join(" / ")}</span>
              </p>
            ) : null}
            {cast.length ? (
              <div className="cast-rail">
                {cast.map((person, index) => (
                  <div className="cast-person" key={`${person.name}:${index}`}>
                    <CastPortrait
                      key={person.image}
                      image={person.image}
                      name={person.name}
                    />
                    <strong>{person.name}</strong>
                    {person.role ? <span>{person.role}</span> : null}
                  </div>
                ))}
              </div>
            ) : film.actors ? (
              <p className="detail-actor-names">{film.actors}</p>
            ) : null}
            {cast.length && film.actors ? (
              <details className="detail-source-cast">
                <summary>查看片库提供的全部主演</summary>
                <p className="detail-actor-names">{film.actors}</p>
              </details>
            ) : null}
          </section>
        ) : null}
        {metadata?.released ? (
          <p className="detail-release">
            {metadata.provider === "tvmaze" ? "首播日期" : "上映日期"} ·{" "}
            {metadata.released}
            <span>日期与版本以资料平台记录为准</span>
          </p>
        ) : null}
        {metadata ? (
          <p className="detail-data-credit">
            <a href={metadata.url} target="_blank" rel="noreferrer">
              {metadata.attribution}
            </a>
          </p>
        ) : null}
        <MetadataSearch state={enrichment} />
    </>}
    related={<>
        <FilmShelf
          title="同类内容"
          films={related.filter(
            (item) => item.id !== film.id && item.category === film.category,
          )}
          onSelect={onSelect}
        />
    </>}
  />;
}
