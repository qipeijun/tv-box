import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Library,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import type { Builtin, Site, Subscription } from "@/lib/api";
import {
  libraryKey,
  type CustomLibrary,
  type LibrarySelection,
} from "@/lib/library-state";
import { navigate, useMediaRoute } from "@/lib/navigation";

export function LibraryManager({
  open,
  onOpenChange,
  builtins,
  subscription,
  site,
  busy,
  error,
  customs,
  onLoad,
  onSite,
  onReload,
  onLive,
  selection,
  onSave,
  onRemove,
  onRetry,
  onCancel,
  storageError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  builtins: Builtin[];
  subscription: Subscription | null;
  site: Site | undefined;
  busy: boolean;
  error: string;
  customs: CustomLibrary[];
  selection: LibrarySelection;
  onSave: (draft: CustomLibrary) => Promise<boolean>;
  onRemove: (id: string) => void;
  onRetry: () => void;
  onCancel: () => void;
  storageError: string;
  onReload: () => void;
  onLive: () => void;
  onLoad: (selection: LibrarySelection) => void;
  onSite: (site: Site) => void;
}) {
  const route = useMediaRoute();
  /** list：手机片库列表；sources：当前片库详情；edit：订阅编辑。桌面同时展示列表与工作区。 */
  const view =
    route.libraryView === "sources" || route.libraryView === "edit"
      ? route.libraryView
      : "list";
  const [editor, setEditor] = useState<CustomLibrary | null>(null);
  const [editorOrigin, setEditorOrigin] = useState("list");
  const [deleting, setDeleting] = useState<CustomLibrary | null>(null);
  const [notice, setNotice] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const previous = useRef({ open, view });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (
      (previous.current.open && !open) ||
      (previous.current.view === "edit" && view !== "edit" && !!editor) ||
      (previous.current.view !== view && view === "list" && busy)
    )
      onCancel();
    if (!open || view !== "edit") setEditor(null);
    if (!open) setDeleting(null);
    if (open && view === "edit" && !editor) navigate("#library", true);
    previous.current = { open, view };
  }, [open, view]);
  useEffect(() => setSourceQuery(""), [subscription?.id]);
  useLayoutEffect(() => {
    if (!open) return;
    window.scrollTo({ top: 0, behavior: "instant" });
    if (view !== "edit") heading.current?.focus({ preventScroll: true });
  }, [open, view]);

  function changeView(next: string, replace = false) {
    navigate(`#library${next === "list" ? "" : `&view=${next}`}`, replace);
  }
  function edit(item?: CustomLibrary) {
    setEditorOrigin(view === "sources" ? "sources" : "list");
    setEditor(
      item ? { ...item } : { id: crypto.randomUUID(), name: "", url: "" },
    );
    setDeleting(null);
    setNotice("");
    changeView("edit");
  }
  function cancelEdit() {
    onCancel();
    setEditor(null);
    changeView(editorOrigin, true);
  }
  function select(next: LibrarySelection) {
    setEditor(null);
    setNotice("");
    changeView("sources");
    onLoad(next);
  }
  function leave() {
    onCancel();
    onOpenChange(false);
  }
  function back() {
    if (view === "edit") cancelEdit();
    else if (view === "sources") {
      onCancel();
      changeView("list", true);
    } else leave();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const previousItem = customs.find((item) => item.id === editor.id);
    const inactive =
      previousItem &&
      libraryKey(selection) !== libraryKey({ url: previousItem.url });
    if (await onSave(editor)) {
      setEditor(null);
      setNotice("订阅已保存。");
      changeView(inactive ? editorOrigin : "sources", true);
    }
  }
  function confirmRemove(item: CustomLibrary) {
    onRemove(item.id);
    setDeleting(null);
    setNotice(`已移除“${item.name}”。`);
  }
  if (!open) return null;
  const selectedCustom =
    "url" in selection
      ? customs.find((item) => item.url === selection.url)
      : undefined;
  const sources =
    subscription?.sites.filter(
      (item) =>
        item.supported &&
        item.name.toLowerCase().includes(sourceQuery.trim().toLowerCase()),
    ) ?? [];
  return (
    <main id="content" className="library-page" data-view={view}>
      <div className="library-page-topbar">
        <Button
          className="library-desktop-back"
          variant="ghost"
          onClick={leave}
        >
          <ArrowLeft />
          返回观影
        </Button>
        <Button className="library-mobile-back" variant="ghost" onClick={back}>
          <ArrowLeft />
          {view === "list"
            ? "返回观影"
            : view === "edit"
              ? "取消编辑"
              : "全部片库"}
        </Button>
        <span className="library-page-kicker">
          <Library />
          订阅与内容来源
        </span>
      </div>
      <header className="library-page-heading">
        <h1 ref={heading} tabIndex={-1}>
          <span className="library-desktop-title">你的片库</span>
          <span className="library-mobile-title">
            {view === "list"
              ? "你的片库"
              : view === "edit"
                ? customs.some((item) => item.id === editor?.id)
                  ? "编辑订阅"
                  : "添加订阅"
                : subscription?.name || "打开片库"}
          </span>
        </h1>
        <p>选择内容来源，或管理自己的订阅。</p>
      </header>
      {notice ? (
        <p className="source-notice" role="status">
          {notice}
        </p>
      ) : null}
      {storageError ? (
        <p className="manager-error" role="status">
          {storageError}
        </p>
      ) : null}
      <div className="library-page-layout">
        <section className="library-collection" aria-label="片库列表">
          <h2>内置片库</h2>
          <div className="library-list">
            {builtins.map((item, index) => (
              <button
                className="library-item"
                key={item.id}
                aria-pressed={
                  libraryKey(selection) === libraryKey({ builtinId: item.id })
                }
                onClick={() => select({ builtinId: item.id })}
              >
                <span className="library-icon">
                  {index === 0 ? "映" : item.name[0]}
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
                {libraryKey(selection) ===
                libraryKey({ builtinId: item.id }) ? (
                  <Check />
                ) : (
                  <ChevronRight />
                )}
              </button>
            ))}
          </div>
          <section className="custom-library-section">
            <div className="manager-section-title">
              <h2>
                我的订阅 <span>{customs.length}</span>
              </h2>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => edit()}
              >
                <Plus />
                添加
              </Button>
            </div>
            {!customs.length ? (
              <p className="source-hint">
                内置片库已可使用，也可以添加自己的订阅。
              </p>
            ) : null}
            <div className="library-list">
              {customs.map((item) => (
                <div className="custom-library-row" key={item.id}>
                  <button
                    className="library-item"
                    aria-pressed={
                      libraryKey(selection) === libraryKey({ url: item.url })
                    }
                    onClick={() => select({ url: item.url })}
                  >
                    <span className="library-icon">{item.name[0]}</span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{new URL(item.url).hostname}</small>
                    </span>
                    {libraryKey(selection) === libraryKey({ url: item.url }) ? (
                      <Check />
                    ) : (
                      <ChevronRight />
                    )}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`编辑${item.name}`}
                    disabled={busy}
                    onClick={() => edit(item)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`删除${item.name}`}
                    disabled={busy}
                    onClick={() =>
                      setDeleting(deleting?.id === item.id ? null : item)
                    }
                  >
                    <Trash2 />
                  </Button>
                  {deleting?.id === item.id ? (
                    <div
                      className="library-delete-confirm"
                      role="group"
                      aria-label={`确认删除${item.name}`}
                    >
                      <h3>移除“{item.name}”？</h3>
                      <p>
                        {libraryKey(selection) === libraryKey({ url: item.url })
                          ? "删除后会使用映场精选片库。"
                          : "移除本机保存的这个订阅。"}
                      </p>
                      <div>
                        <Button
                          autoFocus
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleting(null)}
                        >
                          取消
                        </Button>
                        <Button size="sm" onClick={() => confirmRemove(item)}>
                          确认删除
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </section>
        <section
          className="library-workspace"
          aria-label={editor ? "编辑订阅" : "当前片库"}
        >
          {editor && view === "edit" ? (
            <form
              className="library-editor"
              onSubmit={(event) => void submit(event)}
            >
              <div>
                <p className="library-workspace-eyebrow">我的订阅</p>
                <h2>
                  {customs.some((item) => item.id === editor.id)
                    ? `编辑${customs.find((item) => item.id === editor.id)?.name || "订阅"}`
                    : "添加新的片库"}
                </h2>
                <p className="library-workspace-description">
                  保存前会检查订阅配置。取消后不保留本次修改。
                </p>
              </div>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="custom-name">片库名称</FieldLabel>
                  <Input
                    id="custom-name"
                    autoFocus
                    required
                    maxLength={60}
                    value={editor.name}
                    disabled={busy}
                    placeholder="给片库起个名字"
                    onChange={(event) =>
                      setEditor({ ...editor, name: event.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="custom-url">订阅地址</FieldLabel>
                  <Input
                    id="custom-url"
                    type="url"
                    required
                    maxLength={2048}
                    placeholder="https://example.com/tvbox.json"
                    value={editor.url}
                    disabled={busy}
                    onChange={(event) =>
                      setEditor({ ...editor, url: event.target.value })
                    }
                  />
                </Field>
              </FieldGroup>
              <div className="library-editor-actions">
                <Button type="button" variant="ghost" onClick={cancelEdit}>
                  取消
                </Button>
                <Button type="submit" disabled={busy}>
                  {customs.some((item) => item.id === editor.id)
                    ? "保存修改"
                    : "添加并打开"}
                </Button>
              </div>
            </form>
          ) : subscription ? (
            <div className="library-source-detail">
              <div className="library-workspace-eyebrow">当前片库</div>
              <div className="library-workspace-heading">
                <h2>{subscription.name}</h2>
                {selectedCustom ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`编辑当前${selectedCustom.name}`}
                    disabled={busy}
                    onClick={() => edit(selectedCustom)}
                  >
                    <Pencil />
                  </Button>
                ) : null}
              </div>
              <p className="library-updated">
                上次成功读取{" "}
                <time dateTime={subscription.fetchedAt}>
                  {new Date(subscription.fetchedAt).toLocaleString("zh-CN", {
                    hour12: false,
                  })}
                </time>
              </p>
              <div className="library-source-actions">
                <Button disabled={busy} onClick={() => onOpenChange(false)}>
                  开始浏览
                  <ChevronRight />
                </Button>
                <Button variant="outline" disabled={busy} onClick={onReload}>
                  <RefreshCw />
                  手动更新
                </Button>
              </div>
              <section className="library-sites">
                <div className="manager-section-title">
                  <h3>内容来源</h3>
                  <span>
                    {subscription.sites.filter((item) => item.supported).length}{" "}
                    个网页接口
                  </span>
                </div>
                {subscription.sites.filter((item) => item.supported).length >
                8 ? (
                  <Input
                    aria-label="查找内容来源"
                    value={sourceQuery}
                    onChange={(event) => setSourceQuery(event.target.value)}
                    placeholder="查找内容来源"
                  />
                ) : null}
                <div className="site-options">
                  {sources.map((item) => (
                    <button
                      key={item.key}
                      aria-pressed={site?.key === item.key}
                      disabled={busy}
                      onClick={() => onSite(item)}
                    >
                      {item.name}
                      {site?.key === item.key ? <Check /> : null}
                    </button>
                  ))}
                </div>
                {!subscription.sites.some((item) => item.supported) ? (
                  <p className="source-hint">
                    这个订阅中的点播站点暂不兼容网页播放。可以查看原因，或选择其他片库。
                  </p>
                ) : null}
                {sourceQuery && !sources.length ? (
                  <p className="source-hint">
                    没有找到这个来源，试试其他关键词。
                  </p>
                ) : null}
                {subscription.livePlaylists.length ? (
                  <Button variant="outline" onClick={onLive}>
                    查看订阅中的直播
                  </Button>
                ) : null}
                {subscription.sites.some((item) => !item.supported) ? (
                  <details className="unsupported-sites">
                    <summary>查看暂不支持的来源</summary>
                    {subscription.sites
                      .filter((item) => !item.supported)
                      .map((item) => (
                        <p key={item.key}>
                          <strong>{item.name}</strong>
                          <span>{item.reason}</span>
                        </p>
                      ))}
                  </details>
                ) : null}
              </section>
            </div>
          ) : (
            <div className="library-source-detail">
              <Library />
              <h2>{busy ? "正在连接片库" : "选择一个片库"}</h2>
              <p className="library-workspace-description">
                选择内置片库，或添加自己的订阅地址。
              </p>
            </div>
          )}
          {busy ? (
            <p className="manager-status" role="status">
              <LoaderCircle className="animate-spin" />
              正在读取，可以返回列表选择其他片库。
            </p>
          ) : null}
          {error ? (
            <div className="manager-error" role="alert">
              <p>{error}</p>
              {!editor ? (
                <Button variant="outline" disabled={busy} onClick={onRetry}>
                  重试这次读取
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
