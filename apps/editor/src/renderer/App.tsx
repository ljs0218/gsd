import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppInfo, MenuAction, Theme } from "../shared/api";
import { decideExternal } from "../shared/external";
import { canRedo, canUndo, createHistory, isDirty, loadExternal, markSaved, push, redo, undo } from "../shared/history";
import { basename, dirname, relTo, wsKey } from "../shared/paths";
import { GsdBook, checkRefs, loadWorkspace, refOptions, type GsdBookHandle } from "./gsd";
import { GSD_TEMPLATE, countLines, type Doc, type RefIssue } from "./model";
import { Palette } from "./Palette";
import { Problems } from "./Problems";
import { Sidebar } from "./Sidebar";
import { SourceView } from "./SourceView";
import { Start } from "./Start";

const api = window.gsd;

interface S {
  root: string | null;
  disk: Record<string, string>;
  docs: Record<string, Doc>;
  tabs: string[];
  active: string | null;
  collapsed: Set<string>;
  sidebar: boolean;
  palette: boolean;
  problems: boolean;
  toast: string | null;
}

const init: S = { root: null, disk: {}, docs: {}, tabs: [], active: null, collapsed: new Set(), sidebar: true, palette: false, problems: false, toast: null };
const isAbs = (p: string) => p.startsWith("/") || /^[A-Za-z]:/.test(p);

export function App() {
  // 상태는 ref 에 두고 바꿀 때마다 다시 그린다 — 비동기 핸들러가 늘 최신 값을 읽는다.
  const ref = useRef<S>(init);
  const [, tick] = useState(0);
  const set = useCallback((p: Partial<S> | ((s: S) => Partial<S>)) => {
    ref.current = { ...ref.current, ...(typeof p === "function" ? p(ref.current) : p) };
    tick((n) => n + 1);
  }, []);
  const s = ref.current;

  const [info, setInfo] = useState<AppInfo | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>("system");
  const [sysDark, setSysDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const [wsFiles, setWsFiles] = useState<Record<string, string>>({});
  const book = useRef<GsdBookHandle>(null);
  const toastTimer = useRef<number | null>(null);
  const asking = useRef(new Set<string>());

  const toast = (msg: string) => {
    set({ toast: msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => set({ toast: null }), 4000);
  };

  // ───────── 시작 ─────────
  useEffect(() => {
    void api.info().then((i) => {
      setInfo(i);
      setRecents(i.recents);
      setTheme(i.theme);
    });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const f = () => setSysDark(mq.matches);
    mq.addEventListener("change", f);
    void api.takePendingOpen().then((ps) => ps.forEach((p) => void openFile(p)));
    return () => mq.removeEventListener("change", f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolved: "light" | "dark" = theme === "system" ? (sysDark ? "dark" : "light") : theme;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  // ───────── 폴더·파일 열기 ─────────
  async function openFolder(root: string) {
    const disk = await api.readAll(root);
    set({ root, disk, collapsed: new Set() });
    void api.watch(root);
    setRecents(await api.addRecent(root));
  }

  async function pickFolder() {
    const p = await api.pickFolder();
    if (p) await openFolder(p);
  }

  async function openFile(path: string, goto?: number) {
    if (!ref.current.docs[path]) {
      const r = await api.read(path);
      if (!r) return toast(`Could not read ${basename(path)}`);
      set((st) => ({ docs: { ...st.docs, [path]: { path, hist: createHistory(r.text), view: "book" } }, tabs: st.tabs.includes(path) ? st.tabs : [...st.tabs, path] }));
    }
    set({ active: path, palette: false, problems: false });
    if (goto) patchDoc(path, { view: "source", goto: { line: goto, n: Date.now() } });
    if (ref.current.root === null) await openFolder(dirname(path));
  }

  async function pickFile() {
    const p = await api.pickFile();
    if (p) await openFile(p);
  }

  const patchDoc = (path: string, p: Partial<Doc>) => set((st) => (st.docs[path] ? { docs: { ...st.docs, [path]: { ...st.docs[path]!, ...p } } } : {}));

  // ───────── 고치기·이력 ─────────
  const edit = (path: string, next: string, group: "book" | "text") =>
    set((st) => {
      const d = st.docs[path];
      return d ? { docs: { ...st.docs, [path]: { ...d, hist: push(d.hist, next, Date.now(), group) } } } : {};
    });
  const doUndo = () => {
    const a = ref.current.active;
    if (a) set((st) => ({ docs: { ...st.docs, [a]: { ...st.docs[a]!, hist: undo(st.docs[a]!.hist) } } }));
  };
  const doRedo = () => {
    const a = ref.current.active;
    if (a) set((st) => ({ docs: { ...st.docs, [a]: { ...st.docs[a]!, hist: redo(st.docs[a]!.hist) } } }));
  };

  // ───────── 저장 ─────────
  async function save(path: string): Promise<boolean> {
    const d = ref.current.docs[path];
    if (!d) return true;
    const text = d.hist.present;
    const r = await api.write(path, text);
    if (!r.ok) {
      toast(`Save failed: ${r.error}`);
      return false;
    }
    set((st) => (st.docs[path] ? { docs: { ...st.docs, [path]: { ...st.docs[path]!, hist: markSaved(st.docs[path]!.hist, text) } }, disk: { ...st.disk, [path]: text } } : {}));
    return true;
  }
  async function saveAll(): Promise<boolean> {
    let ok = true;
    for (const d of Object.values(ref.current.docs)) if (isDirty(d.hist)) ok = (await save(d.path)) && ok;
    return ok;
  }
  async function saveAs() {
    const a = ref.current.active;
    const d = a && ref.current.docs[a];
    if (!a || !d) return;
    const to = await api.pickSavePath(a);
    if (!to) return;
    if (to === a) return void (await save(a));
    const text = d.hist.present;
    const r = await api.write(to, text);
    if (!r.ok) return toast(`Save failed: ${r.error}`);
    set((st) => {
      const docs = { ...st.docs };
      delete docs[a];
      docs[to] = { path: to, hist: createHistory(text), view: d.view };
      return { docs, disk: { ...st.disk, [to]: text }, tabs: st.tabs.map((t) => (t === a ? to : t)).filter((t, i, arr) => arr.indexOf(t) === i), active: to };
    });
  }
  async function newFile() {
    const base = ref.current.root ?? ref.current.active ? dirname(ref.current.active ?? "") : "";
    const dir = ref.current.root ?? base;
    const to = await api.pickSavePath(dir ? `${dir}/untitled.gsd` : "untitled.gsd");
    if (!to) return;
    const r = await api.write(to, GSD_TEMPLATE);
    if (!r.ok) return toast(`Could not create file: ${r.error}`);
    set((st) => ({ disk: { ...st.disk, [to]: GSD_TEMPLATE } }));
    await openFile(to);
  }

  async function closeTab(path: string) {
    const d = ref.current.docs[path];
    if (d && isDirty(d.hist)) {
      const r = await api.confirm({ message: `Save changes to ${basename(path)}?`, detail: "Your changes will be lost if you don't save them.", buttons: ["Save", "Don't Save", "Cancel"], danger: true });
      if (r === 2) return;
      if (r === 0 && !(await save(path))) return;
    }
    set((st) => {
      const i = st.tabs.indexOf(path);
      const tabs = st.tabs.filter((t) => t !== path);
      const docs = { ...st.docs };
      delete docs[path];
      return { docs, tabs, active: st.active === path ? (tabs[Math.min(i, tabs.length - 1)] ?? null) : st.active };
    });
  }

  // ───────── 바깥 변경 ─────────
  async function onFsChanged(paths: string[]) {
    let refreshAll = false;
    for (const p of paths) {
      if (!p.toLowerCase().endsWith(".gsd")) {
        refreshAll = true; // 폴더가 생기거나 사라졌다
        continue;
      }
      const r = await api.read(p);
      if (!r) {
        set((st) => {
          const disk = { ...st.disk };
          delete disk[p];
          return { disk };
        });
        continue;
      }
      set((st) => ({ disk: { ...st.disk, [p]: r.text } }));
      const d = ref.current.docs[p];
      if (!d) continue;
      const act = decideExternal(d.hist.saved, r.text, d.hist.present);
      if (act === "reload") patchDoc(p, { hist: loadExternal(d.hist, r.text) });
      else if (act === "adopt") patchDoc(p, { hist: markSaved(d.hist, r.text) });
      else if (act === "ask" && !asking.current.has(p)) {
        asking.current.add(p);
        const pick = await api.confirm({ message: `${basename(p)} changed on disk`, detail: "You also have unsaved changes in the editor.", buttons: ["Reload from Disk", "Keep My Changes"], danger: true });
        asking.current.delete(p);
        const cur = ref.current.docs[p];
        if (!cur) continue;
        patchDoc(p, { hist: pick === 0 ? loadExternal(cur.hist, r.text) : markSaved(cur.hist, r.text) });
      }
    }
    const root = ref.current.root;
    if (refreshAll && root) set({ disk: await api.readAll(root) });
  }
  useEffect(() => api.onFsChanged((ps) => void onFsChanged(ps)));
  useEffect(() => api.onOpenPath((p) => void openFile(p)));

  // ───────── 메뉴 ─────────
  const onMenu = (a: MenuAction) => {
    const st = ref.current;
    if (st.palette && a !== "palette") return;
    switch (a) {
      case "openFolder": return void pickFolder();
      case "openFile": return void pickFile();
      case "newFile": return void newFile();
      case "save": return void (st.active && save(st.active));
      case "saveAll": return void saveAll();
      case "saveAs": return void saveAs();
      case "closeTab": return void (st.active && closeTab(st.active));
      case "undo": return doUndo();
      case "redo": return doRedo();
      case "toggleSource": return void (st.active && patchDoc(st.active, { view: st.docs[st.active]?.view === "source" ? "book" : "source" }));
      case "palette": return set({ palette: !st.palette });
      case "toggleSidebar": return set({ sidebar: !st.sidebar });
      case "theme:system": case "theme:light": case "theme:dark": return changeTheme(a.slice(6) as Theme);
      case "saveAllThenClose": return void saveAll().then((ok) => ok && api.closeNow());
    }
  };
  const menuRef = useRef(onMenu);
  menuRef.current = onMenu;
  useEffect(() => api.onMenu((a) => menuRef.current(a)), []);

  function changeTheme(t: Theme) {
    setTheme(t);
    void api.setTheme(t);
  }

  // ───────── 파생 값 ─────────
  const dirtyPaths = Object.values(s.docs).filter((d) => isDirty(d.hist)).map((d) => d.path);
  useEffect(() => api.setDirty(dirtyPaths.length), [dirtyPaths.length]);

  // 작업 공간 글: 열린 파일은 편집 중인 글, 나머지는 디스크 글. 타자마다 다시 풀지 않게 잠깐 늦춘다.
  useEffect(() => {
    const t = setTimeout(() => {
      const st = ref.current;
      const out: Record<string, string> = {};
      for (const [p, text] of Object.entries(st.disk)) out[wsKey(st.root, p)] = st.docs[p]?.hist.present ?? text;
      for (const d of Object.values(st.docs)) out[wsKey(st.root, d.path)] = d.hist.present;
      setWsFiles(out);
    }, 200);
    return () => clearTimeout(t);
  }, [s.docs, s.disk, s.root]);
  const ws = useMemo(() => loadWorkspace(wsFiles), [wsFiles]);
  const issues: RefIssue[] = useMemo(() => checkRefs(ws), [ws]);

  const activeDoc = s.active ? s.docs[s.active] : undefined;
  const activeKey = s.active ? wsKey(s.root, s.active) : null;
  const refs = useCallback((kind: string) => (activeKey ? refOptions(ws, activeKey, kind) : []), [ws, activeKey]);
  const activeErr = activeKey ? ws.get(activeKey)?.error : undefined;
  const treePaths = useMemo(() => Object.keys(s.disk).map((p) => relTo(s.root, p)).filter((p): p is string => p !== null), [s.disk, s.root]);
  const dirtyRel = new Set(dirtyPaths.map((p) => relTo(s.root, p) ?? p));

  const goIssue = (i: RefIssue) => void openFile(isAbs(i.file) || !s.root ? i.file : `${s.root}/${i.file}`, i.line);
  const openRel = (rel: string) => void openFile(isAbs(rel) || !s.root ? rel : `${s.root}/${rel}`);

  // ───────── 그리기 ─────────
  return (
    <div className="app">
      <div className="main">
        {s.sidebar && s.root && (
          <Sidebar
            rootName={basename(s.root)}
            paths={treePaths}
            collapsed={s.collapsed}
            toggle={(d) => set((st) => ({ collapsed: new Set(st.collapsed.has(d) ? [...st.collapsed].filter((x) => x !== d) : [...st.collapsed, d]) }))}
            active={s.active ? relTo(s.root, s.active) : null}
            dirty={dirtyRel}
            onOpen={openRel}
          />
        )}
        <div className="center">
          {s.tabs.length > 0 && (
            <div className="tabbar" data-testid="tabbar">
              <div className="tabs">
                {s.tabs.map((t) => {
                  const d = s.docs[t]!;
                  return (
                    <div key={t} className={`tab${t === s.active ? " active" : ""}`} title={t} data-tab={basename(t)} onClick={() => set({ active: t })} onAuxClick={(e) => e.button === 1 && void closeTab(t)}>
                      <span>{basename(t)}</span>
                      {isDirty(d.hist) ? <span className="dot" title="Unsaved changes" /> : null}
                      <button
                        className="x"
                        title="Close"
                        onClick={(e) => {
                          e.stopPropagation();
                          void closeTab(t);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
              {activeDoc && (
                <div className="tab-actions">
                  <button title="Undo" data-testid="undo" disabled={!canUndo(activeDoc.hist)} onClick={doUndo}>
                    ↶
                  </button>
                  <button title="Redo" data-testid="redo" disabled={!canRedo(activeDoc.hist)} onClick={doRedo}>
                    ↷
                  </button>
                  <button className={activeDoc.view === "source" ? "on" : ""} data-testid="toggle-source" title="Show the file as text" onClick={() => patchDoc(activeDoc.path, { view: activeDoc.view === "source" ? "book" : "source" })}>
                    Source
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="editor-area">
            {activeDoc ? (
              <>
                {activeErr && activeDoc.view === "book" && (
                  <div className="banner" data-testid="parse-banner">
                    <span>
                      Line {activeErr.line}: {activeErr.message.replace(/^줄 \d+:칸 \d+ — /, "")}
                    </span>
                    <button onClick={() => patchDoc(activeDoc.path, { view: "source", goto: { line: activeErr.line, n: Date.now() } })}>Fix in source view</button>
                  </div>
                )}
                {activeDoc.view === "source" ? (
                  <SourceView key={activeDoc.path} text={activeDoc.hist.present} goto={activeDoc.goto} onChange={(t) => edit(activeDoc.path, t, "text")} />
                ) : (
                  <GsdBook key={activeDoc.path} ref={book} path={relTo(s.root, activeDoc.path) ?? activeDoc.path} text={activeDoc.hist.present} theme={resolved} refs={refs} onChange={(t) => edit(activeDoc.path, t, "book")} />
                )}
              </>
            ) : (
              <Start
                recents={recents}
                examplesDir={info?.examplesDir ?? null}
                onOpenFolder={() => void pickFolder()}
                onOpenFile={() => void pickFile()}
                onOpenRecent={(p) => void openFolder(p)}
                onForget={(p) => void api.removeRecent(p).then(setRecents)}
              />
            )}
          </div>
        </div>
      </div>
      <div className="statusbar" data-testid="statusbar">
        <span className="sb-path" data-testid="sb-path">{s.active ? (relTo(s.root, s.active) ?? s.active) : s.root ?? "No file open"}</span>
        {activeDoc && (
          isDirty(activeDoc.hist) ? (
            <button className="sb-btn warn" data-testid="sb-state" title="Save (Cmd/Ctrl+S)" onClick={() => void save(activeDoc.path)}>
              Edited — Save
            </button>
          ) : (
            <span data-testid="sb-state">Saved</span>
          )
        )}
        {dirtyPaths.length > 0 && <span className="warn" data-testid="sb-dirty">{dirtyPaths.length} unsaved</span>}
        <span className="grow" />
        {activeErr && <span className="err" data-testid="sb-parse">Syntax error</span>}
        <button className={`sb-btn${issues.length ? " err" : ""}`} data-testid="sb-refs" disabled={issues.length === 0} onClick={() => set({ problems: !s.problems })}>
          {issues.length === 0 ? "No reference errors" : `${issues.length} reference error${issues.length === 1 ? "" : "s"}`}
        </button>
        {activeDoc && <span data-testid="sb-lines">{countLines(activeDoc.hist.present)} lines</span>}
        <button className="sb-btn" title="Theme" data-testid="sb-theme" onClick={() => changeTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system")}>
          {theme === "system" ? "Theme: System" : theme === "light" ? "Theme: Light" : "Theme: Dark"}
        </button>
      </div>
      {s.problems && issues.length > 0 && <Problems issues={issues} onGo={goIssue} onClose={() => set({ problems: false })} />}
      {s.palette && <Palette paths={treePaths} onPick={openRel} onClose={() => set({ palette: false })} />}
      {s.toast && <div className="toast" data-testid="toast">{s.toast}</div>}
    </div>
  );
}
