import { browseHash } from "@/lib/browse-location";
import { navigate } from "@/lib/navigation";
export function SearchScope({
  cross,
  query,
  site,
}: {
  cross: boolean;
  query: string;
  site?: string;
}) {
  return (
    <div className="search-scope" role="group" aria-label="搜索范围">
      {[false, true].map((all) => (
        <button
          key={String(all)}
          aria-pressed={cross === all}
          onClick={() =>
            navigate(
              browseHash({
                searching: true,
                crossSearching: all,
                query,
                category: "",
                page: 1,
              }),
            )
          }
        >
          {all ? "整个片库" : site || "当前来源"}
        </button>
      ))}
    </div>
  );
}
