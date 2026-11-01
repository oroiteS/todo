import { afterEach, describe, expect, it, vi } from "vitest";

const key = "todolite.taskSort";
function storage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(key, initial);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}
async function load() {
  vi.resetModules();
  return (await import("./ui")).useUiStore;
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("task sort preference", () => {
  it("defaults on missing or invalid stored value", async () => {
    vi.stubGlobal("localStorage", storage());
    expect((await load()).getState().taskSort).toBe("dueDate");
    vi.stubGlobal("localStorage", storage("invalid"));
    expect((await load()).getState().taskSort).toBe("dueDate");
  });
  it("persists a selected sort across reload", async () => {
    vi.stubGlobal("localStorage", storage());
    (await load()).getState().setTaskSort("priority");
    expect((await load()).getState().taskSort).toBe("priority");
  });
  it("survives unavailable storage and still changes in memory", async () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
    const store = await load();
    expect(store.getState().taskSort).toBe("dueDate");
    store.getState().setTaskSort("title");
    expect(store.getState().taskSort).toBe("title");
  });
});
