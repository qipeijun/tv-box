import { test } from "node:test";
import assert from "node:assert/strict";
import { navigate, goBack, setNavigationContext } from "./navigation.ts";

test("直接打开播放链接后换集，返回仍进入影片，不跳出应用", (t) => {
  const globals = globalThis as unknown as Record<string, unknown>;
  const keys = ["window", "history", "location", "PopStateEvent"];
  const saved = keys.map((key) => globals[key]);
  t.after(() =>
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete globals[key];
      else globals[key] = saved[i];
    }),
  );
  const location = {
    pathname: "/",
    search: "",
    hash: "#watch=movie&episode=0%3A47",
  };
  let back = 0;
  const update = (url: string) => {
    location.hash = url.startsWith("#") ? url : "";
  };
  type Entry = null | { mediaApp: boolean; mediaContext: string };
  const history = {
    state: null as Entry,
    pushState(state: Entry, _: string, url: string) {
      this.state = state;
      update(url);
    },
    replaceState(state: Entry, _: string, url: string) {
      this.state = state;
      update(url);
    },
    back() {
      back++;
    },
  };
  Object.assign(globals, {
    window: { history, dispatchEvent() {} },
    history,
    location,
    PopStateEvent: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  });
  setNavigationContext("source");
  navigate("#watch=movie&episode=1%3A46", true);
  assert.equal(history.state?.mediaApp, false);
  goBack();
  assert.equal(back, 0);
  assert.equal(
    new URLSearchParams(location.hash.slice(1)).get("film"),
    "movie",
  );
  assert.equal(
    new URLSearchParams(location.hash.slice(1)).get("episode"),
    "1:46",
  );
  goBack();
  assert.equal(location.hash, "");
  assert.equal(back, 0);
  navigate("#film=movie");
  assert.equal(history.state?.mediaApp, true);
  navigate("#watch=movie&episode=0%3A0");
  goBack();
  assert.equal(back, 1);
  history.state = null;
  location.hash = "#history=&view=favorites&film=7";
  goBack();
  assert.equal(location.hash, "#history&view=favorites");
});
