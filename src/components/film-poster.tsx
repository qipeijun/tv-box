import { useState } from "react";
import { Film as FilmIcon } from "lucide-react";

export function FilmPoster({
  url,
  name,
}: {
  url: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="film-poster">
      {url && !failed ? (
        <img
          src={url}
          alt={name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="poster-fallback">
          <FilmIcon aria-hidden="true" />
          <span>{name}</span>
        </div>
      )}
    </div>
  );
}
