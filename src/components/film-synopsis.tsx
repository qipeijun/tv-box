import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/** 仅在正文超过折叠行数时提供展开；宽度变化后重新测量。 */
export function FilmSynopsis({ description, mobile }: { description: string; mobile: boolean }) {
  const id = useId();
  const text = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const lines = mobile ? 4 : 3;
  useLayoutEffect(() => {
    const element = text.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      setOverflowing(element.scrollHeight > lineHeight * lines + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [description, lines]);
  if (!description.trim()) return <p className="detail-no-synopsis">暂无剧情简介</p>;
  return <section className="detail-synopsis" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>剧情简介</h2>
    <p ref={text} id={id} className={expanded ? "synopsis-expanded" : "synopsis-collapsed"}
      style={expanded ? undefined : { WebkitLineClamp: lines }}>
      {description}
    </p>
    {overflowing ? <button aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      {expanded ? "收起简介" : "展开简介"}<ChevronDown aria-hidden="true" />
    </button> : null}
  </section>;
}
