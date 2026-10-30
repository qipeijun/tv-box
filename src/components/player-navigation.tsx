import type { PointerEventHandler } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "./ui/button";

type NavigationProps = {
  title: string;
  subtitle: string;
  onBack: () => void;
  live: boolean;
  visible: boolean;
  onPointerEnter: PointerEventHandler<HTMLElement>;
  onPointerLeave: PointerEventHandler<HTMLElement>;
};

export function MobilePlayerNavigation({ title, subtitle, onBack, live, visible, onPointerEnter, onPointerLeave }: NavigationProps) {
  return <header className="player-mobile-navigation" data-visible={visible} inert={!visible} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
    <Button variant="ghost" size="icon" onClick={onBack} aria-label={live ? "返回点播" : "返回影片"}><ArrowLeft /></Button>
    <div><h1 title={title}>{title}</h1><p>{subtitle}</p></div>
  </header>;
}

export function DesktopPlayerNavigation({ title, subtitle, onBack, live, visible, onPointerEnter, onPointerLeave }: NavigationProps) {
  return <header className="player-desktop-navigation" data-visible={visible} inert={!visible} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
    <Button variant="ghost" onClick={onBack}><ArrowLeft /><span>{live ? "返回点播" : "返回影片"}</span></Button>
    <div className="player-desktop-title"><h1 title={title}>{title}</h1><p>{subtitle}</p></div>
  </header>;
}
