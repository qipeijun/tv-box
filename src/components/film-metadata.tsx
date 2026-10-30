import { useEffect, useRef, useState } from "react";
import { Search, ExternalLink, Check, UserRound } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { api, type FilmDetail, type FilmMetadata, type MetadataProvider } from "@/lib/api";
import { decodeMetadataMatches, exactMetadata, METADATA_KEY, type MetadataMatch } from "@/lib/film-metadata";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldLabel } from "./ui/field";
import { FilmPoster } from "./film-poster";

export function useFilmMetadata(film: FilmDetail, scope: string) {
  const identity = JSON.stringify([scope, film.id, film.name, film.year]);
  const [metadata, setMetadata] = useState<FilmMetadata | null>(null);
  const [candidates, setCandidates] = useState<FilmMetadata[]>([]);
  const [provider, setProvider] = useState<MetadataProvider>(/剧|连续/.test(film.category) ? "tvmaze" : "cinemeta");
  const [query, setQuery] = useState(film.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  function persist(match: MetadataMatch | null) {
    try {
      const previous = decodeMetadataMatches(localStorage.getItem(METADATA_KEY));
      const next = previous.filter((item) => item.key !== identity);
      localStorage.setItem(METADATA_KEY, JSON.stringify({ version: 1, matches: (match ? [match, ...next] : next).slice(0, 100) }));
    } catch (reason) {
      setError(`资料可用于本次查看，但未能保存匹配：${reason instanceof Error ? reason.message : "本机存储不可用"}`);
    }
  }
  async function choose(candidate: Pick<FilmMetadata, "provider" | "id">, signal?: AbortSignal) {
    if (!signal) {
      controller.current?.abort();
      controller.current = new AbortController();
      signal = controller.current.signal;
    }
    setBusy(true);
    setError("");
    try {
      const value = await api<FilmMetadata>(`/metadata/${candidate.provider}/${candidate.id}`, { signal });
      if (signal.aborted) return;
      setMetadata(value);
      persist({ key: identity, provider: value.provider, id: value.id });
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof Error ? reason.message : "影片资料暂时无法读取。");
    } finally { if (!signal.aborted) setBusy(false); }
  }
  async function search() {
    controller.current?.abort();
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true); setError(""); setCandidates([]);
    try {
      const data = await api<{ candidates: FilmMetadata[] }>("/metadata/search", {
        method: "POST", signal, body: JSON.stringify({ provider, query }),
      });
      if (signal.aborted) return;
      setCandidates(data.candidates);
      const match = exactMetadata(data.candidates, film.name, film.year);
      if (match) await choose(match, signal);
      else if (!data.candidates.length) setError("没有找到资料，可换片名或资料类型再查找。当前影片仍可正常播放。");
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof Error ? reason.message : "资料搜索失败。");
    } finally { if (!signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    try {
      const saved = decodeMetadataMatches(localStorage.getItem(METADATA_KEY)).find((item) => item.key === identity);
      if (saved) { setProvider(saved.provider); void choose(saved); }
      else void search();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法恢复资料匹配。"); }
    return () => controller.current?.abort();
    // 组件按影片与片库身份重新挂载，用户编辑搜索条件不触发自动请求。
  }, [identity]);
  function clear() {
    controller.current?.abort(); setBusy(false); setMetadata(null); setError(""); persist(null);
  }
  return { metadata, candidates, provider, setProvider, query, setQuery, busy, error, search, choose, clear };
}

export function MetadataSearch({ state }: { state: ReturnType<typeof useFilmMetadata> }) {
  return <details className="metadata-search">
    <summary>{state.metadata ? "更正影片资料" : "补充评分与高清图片"}{state.busy ? " · 正在读取" : ""}</summary>
    <div className="metadata-search-content">
      <p>确认是同一部影片后，补充评分与图片。播放集数和线路仍来自当前片库。</p>
      <ToggleGroup.Root type="single" value={state.provider} onValueChange={(value) => {
        if (value === "cinemeta" || value === "tvmaze") state.setProvider(value);
      }} className="metadata-providers" aria-label="资料类型">
        <ToggleGroup.Item value="cinemeta">电影 · Cinemeta</ToggleGroup.Item>
        <ToggleGroup.Item value="tvmaze">剧集 · TVmaze</ToggleGroup.Item>
      </ToggleGroup.Root>
      <form onSubmit={(event) => { event.preventDefault(); void state.search(); }}>
        <Field>
          <FieldLabel htmlFor="metadata-query">影片名称</FieldLabel>
          <Input id="metadata-query" value={state.query} maxLength={120} onChange={(event) => state.setQuery(event.target.value)} />
        </Field>
        <Button variant="secondary" disabled={state.busy || !state.query.trim()}><Search data-icon="inline-start" />查找资料</Button>
      </form>
      {state.error ? <p role="status">{state.error}</p> : null}
      {state.metadata?.warnings.map((message) => <p key={message} role="status">{message}</p>)}
      {state.busy ? <p role="status">正在查找影片资料，播放不受影响…</p> : null}
      <div className="metadata-candidates">
        {state.candidates.map((item) => <button key={`${item.provider}:${item.id}`} disabled={state.busy} onClick={() => void state.choose(item)} aria-label={`采用 ${item.name} ${item.year} 的资料`}>
          <FilmPoster key={item.poster} url={item.poster} name={item.name} />
          <span><strong>{item.name}</strong><small>{item.year || "年份未提供"} · {item.provider === "cinemeta" ? "电影" : "剧集"}</small></span>
          {state.metadata?.id === item.id && state.metadata.provider === item.provider ? <Check aria-label="当前采用" /> : <span>采用</span>}
        </button>)}
      </div>
      {state.metadata ? <Button variant="ghost" onClick={state.clear}>取消资料匹配</Button> : null}
      <p className="metadata-attribution">
        {state.metadata ? <a href={state.metadata.url} target="_blank" rel="noreferrer">{state.metadata.attribution}<ExternalLink /></a> : "电影资料由 Cinemeta 提供；剧集资料由 TVmaze 提供（CC BY-SA）。"}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">TVmaze 数据许可</a>
      </p>
    </div>
  </details>;
}

export function CastPortrait({ name, image }: { name: string; image: string | null }) {
  const [failed, setFailed] = useState(false);
  return <div className="cast-portrait">{image && !failed ? <img src={image} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <UserRound aria-hidden="true" />}</div>;
}
