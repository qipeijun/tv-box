import { useState } from 'react';
import { useRemovalFocus } from '@/lib/use-removal-focus';
import { Bookmark, ArrowLeft, ArrowUpRight, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { FilmPoster } from './film-poster';
import { navigate } from '@/lib/navigation';
import type { Favorite } from '@/lib/favorites';

export function Favorites({records, full = false, error, writable, openingId, onOpen, onRemove, onReset, onFind, onViewAll}: {
  records: Favorite[]; full?: boolean; error: string; writable: boolean; openingId: string;
  onOpen: (record: Favorite) => void; onRemove: (id: string) => void;
  onReset: () => void; onFind: (name: string) => void;
  onViewAll?: (trigger: HTMLButtonElement) => void;
}) {
  const [resetting, setResetting] = useState(false);
  const items = full ? records : records.slice(0, 12);
  const { root, remove } = useRemovalFocus(items.map(record => record.id), onRemove);
  if (!full && !records.length && !error) return null;
  const content = <>
    {error ? <p className="history-notice" role="status">{error}</p> : null}
    <div className={full ? 'favorite-grid' : 'favorite-rail'}>
      {items.map(record => <article className="favorite-card" key={record.id}>
        <button data-record-open className="favorite-open" onClick={() => onOpen(record)} aria-busy={openingId === record.id} aria-label={`查看收藏 ${record.film.name}，${record.siteName}`}>
          <div className="favorite-art"><FilmPoster url={record.film.poster} name={record.film.name} /><span className="favorite-mark"><Bookmark fill="currentColor" /></span></div>
          <h3>{record.film.name}</h3>
          <p>{record.film.year || record.film.category || '影片'}<span>{record.siteName}</span></p>
          {openingId === record.id ? <small role="status">正在核对影片入口…</small> : <small>{record.libraryName}</small>}
        </button>
        <div className="favorite-card-actions">
          <Button variant="ghost" size="icon" onClick={() => onFind(record.film.name)} aria-label={`换站查找 ${record.film.name}`}><ArrowUpRight /></Button>
          <Button variant="ghost" size="icon" disabled={!writable} onClick={() => remove(record.id)} aria-label={`移除收藏 ${record.film.name}`}><Trash2 /></Button>
        </div>
      </article>)}
    </div>
    {full && !records.length && !error ? <section className="media-empty"><Bookmark /><h2>把想看的留在这里</h2><p>在影片详情点击收藏，下次从这里回来。</p><Button onClick={() => navigate('#browse')}>浏览影片</Button></section> : null}
    {full && !writable ? <div className="favorite-reset">{resetting ? <><p>重建会清空此浏览器的全部收藏，观看记录不受影响。</p><Button variant="outline" onClick={() => {onReset();setResetting(false);}}>清空并重建收藏</Button><Button variant="ghost" onClick={() => setResetting(false)}>取消</Button></> : <Button variant="outline" onClick={() => setResetting(true)}>重建本机收藏</Button>}</div> : null}
  </>;
  return full ? <main ref={root} className="history-page favorites-page" id="content"><Button variant="ghost" onClick={() => navigate('')}><ArrowLeft />现在观看</Button><header><p>想看的，留到下一次。</p><h1>我的收藏</h1></header>{content}</main> : <section ref={root} className="favorite-shelf" aria-label="我的收藏"><div className="shelf-heading"><div><h2>我的收藏</h2><p>为下一次观影留的位置。</p></div><Button variant="ghost" onClick={(event) => onViewAll ? onViewAll(event.currentTarget) : navigate('#history&view=favorites')}>全部收藏</Button></div>{content}</section>;
}
