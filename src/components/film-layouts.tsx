import type { ReactNode, RefObject } from "react";

type FilmLayoutProps = {
  title: string;
  compactArtwork?: boolean;
  hasArtwork?: boolean;
  artworkRef?: RefObject<HTMLDivElement | null>;
  backdrop?: ReactNode;
  ambientBackdrop?: ReactNode;
  artwork: ReactNode;
  identity: ReactNode;
  facts?: ReactNode;
  actions: ReactNode;
  synopsis?: ReactNode;
  episodes?: ReactNode;
  information?: ReactNode;
  related?: ReactNode;
};

/** 手机以海报开场，主操作紧随片名，简介与选集按阅读顺序展开。 */
export function MobileFilmLayout(props: FilmLayoutProps) {
  return <div ref={props.artworkRef} className="film-mobile" data-has-artwork={props.hasArtwork !== false} data-compact-artwork={props.compactArtwork || undefined}>
    <section className="film-mobile-hero" aria-label={props.title}>
      <div className="film-mobile-cover">{props.artwork}</div>
      <div className="film-mobile-summary">{props.identity}{props.facts}{props.actions}</div>
    </section>
    <div className="film-mobile-content">
      {props.synopsis}{props.episodes}{props.information}{props.related}
    </div>
  </div>;
}

/** PC 的通栏画面与前景信息各占固定区域，补充图片不切换首屏结构。 */
export function DesktopFilmLayout(props: FilmLayoutProps) {
  return <div ref={props.artworkRef} className="film-desktop" data-has-artwork={props.hasArtwork !== false}>
    <section className="film-desktop-hero" aria-label={props.title}>
      <div className="film-desktop-scene" aria-hidden="true">{props.backdrop || props.ambientBackdrop}</div>
      <div className="film-desktop-intro">
        {props.hasArtwork !== false ? <div className="film-desktop-poster">{props.artwork}</div> : null}
        <div className="film-desktop-copy">
          <div className="film-desktop-description">{props.identity}{props.facts}{props.synopsis}</div>
          <div className="film-desktop-play">{props.actions}</div>
        </div>
      </div>
    </section>
    <div className="film-desktop-content">
      {props.episodes}
      <div className="film-desktop-information">{props.information}</div>
      {props.related}
    </div>
  </div>;
}
