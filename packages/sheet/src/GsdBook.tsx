/*
  책 = .gsd 파일 하나. 탭 = @sheet·@props 블록, 칸 ▸ 로 들어가면 하위 시트 (빵부스러기).
  text 가 바뀌면 다시 읽되 선택·스크롤·열린 자리는 지킨다. 고칠 때마다 값 트리를 바꿔 writeGsd 의 정규 글을 onChange 로 올린다.
  되돌리기·저장은 앱이 맡는다 (앱이 글 이력을 쥐고 text 를 바꿔 준다).
*/
import { GsdError, parseGsd, type ParsedGsd } from "@gsd/core";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Ctx, type BookCtx, type GridMemo } from "./ctx.ts";
import { Grid } from "./Grid.tsx";
import { locFromText, tabsOf, type Loc } from "./model/book.ts";
import { commit, type Edit } from "./model/edit.ts";
import { getIn } from "./model/tree.ts";
import type { RefOption, Tok } from "./model/types.ts";
import { buildModel, rowLabel } from "./model/view.ts";

export interface GsdBookHandle {
  /** 시트의 찾기 칸으로 포커스 */
  focusSearch(): void;
  /** "items", "items.2.drops" 처럼 점으로 이은 자리를 연다 (탭 경로 + 줄 번호/키 + 필드) */
  openPath(path: string): void;
}

export interface GsdBookProps {
  /** 머리·오류 표시용 */
  path: string;
  /** 파일 글 전체 */
  text: string;
  /** 사용자가 고칠 때마다 정규 출력 글 하나 */
  onChange: (next: string) => void;
  /** ref(kind) 칸의 후보 (없으면 글 칸) */
  refs?: (kind: string) => RefOption[];
  readOnly?: boolean;
  theme?: "dark" | "light";
}

type Read = { ok: true; parsed: ParsedGsd } | { ok: false; error: GsdError | Error };

function readText(text: string): Read {
  try {
    return { ok: true, parsed: parseGsd(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

const storeKey = (path: string, key: string) => `gsd.sheet.w.${path}.${key}`;

export const GsdBook = forwardRef<GsdBookHandle, GsdBookProps>(function GsdBook({ path, text, onChange, refs, readOnly = false, theme = "dark" }, handle) {
  // 우리가 방금 내보낸 글이면 다시 읽지 않는다
  const seeded = useRef<{ text: string; value: unknown } | null>(null);
  const read = useMemo<Read>(() => {
    const r = readText(text);
    if (r.ok && seeded.current?.text === text) return { ok: true, parsed: { ...r.parsed, value: seeded.current.value } };
    return r;
  }, [text]);

  const [loc, setLoc] = useState<Loc>({ tab: -1, path: [] });
  const [showSrc, setShowSrc] = useState(false);
  const [toast, setToastState] = useState<{ id: number; msg: string; kind: string } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const memo = useRef(new Map<string, GridMemo>()).current;
  const widthMem = useRef(new Map<string, Record<string, number>>()).current;

  const setToast = useCallback((msg: string, kind: "ok" | "err" | "info" = "info") => {
    window.clearTimeout(toastTimer.current);
    setToastState({ id: Date.now(), msg, kind });
    toastTimer.current = window.setTimeout(() => setToastState(null), 4500);
  }, []);

  const refCache = useMemo(() => new Map<string, RefOption[]>(), [refs, text]); // eslint-disable-line react-hooks/exhaustive-deps
  const refOpts = useCallback(
    (kind: string): RefOption[] => {
      if (!refs) return [];
      let v = refCache.get(kind);
      if (!v) {
        try {
          v = refs(kind) ?? [];
        } catch {
          v = [];
        }
        refCache.set(kind, v);
      }
      return v;
    },
    [refs, refCache],
  );

  const parsed = read.ok ? read.parsed : null;
  const tabs = useMemo(() => (parsed ? tabsOf(parsed.schema) : []), [parsed]);

  // 열린 자리가 지금 글에서 풀리지 않으면 풀리는 데까지 올라간다
  const eff = useMemo<Loc | null>(() => {
    if (!parsed || tabs.length === 0) return null;
    const tab = tabs.find((t) => t.block === loc.tab) ?? tabs[0]!;
    let path: Tok[] = loc.tab === tab.block ? loc.path : [...tab.path];
    while (path.length > tab.path.length && !buildModel(parsed.value, parsed.schema, { tab: tab.block, path })) path = path.slice(0, -1);
    if (path.length < tab.path.length) path = [...tab.path];
    return { tab: tab.block, path };
  }, [parsed, tabs, loc]);

  useImperativeHandle(
    handle,
    () => ({
      focusSearch() {
        searchRef.current?.focus();
        searchRef.current?.select();
      },
      openPath(p: string) {
        if (!parsed) return;
        const l = locFromText(parsed.value, parsed.schema, p);
        if (l) setLoc(l);
      },
    }),
    [parsed],
  );

  if (!parsed || !eff) {
    return (
      <div className="gsd" data-theme={theme}>
        {read.ok ? <div className="gsd-empty">This file has no sheets or properties yet.</div> : <ErrorView path={path} text={text} error={read.error} showSrc={showSrc} setShowSrc={setShowSrc} />}
      </div>
    );
  }

  const { schema, value } = parsed;
  const model = buildModel(value, schema, eff);
  const tab = tabs.find((t) => t.block === eff.tab)!;

  const apply = (edits: Edit[]): string | null => {
    if (readOnly) return "Read-only";
    const c = commit(value, schema, edits);
    if (!c.ok) return c.why;
    if (c.text !== text) {
      seeded.current = { text: c.text, value: c.value };
      onChange(c.text);
    }
    return null;
  };

  const ctx: BookCtx = {
    schema,
    value,
    tab: eff.tab,
    readOnly,
    refOk: (k) => refOpts(k).length > 0,
    refOpts,
    apply,
    toast: setToast,
    drill: (p) => setLoc({ tab: eff.tab, path: p }),
    memo,
    widths: {
      get: (key) => {
        const k = storeKey(path, key);
        const m = widthMem.get(k);
        if (m) return m;
        try {
          const j = JSON.parse(localStorage.getItem(k) ?? "{}") as Record<string, number>;
          widthMem.set(k, j);
          return j;
        } catch {
          return {};
        }
      },
      set: (key, w) => {
        const k = storeKey(path, key);
        widthMem.set(k, w);
        try {
          localStorage.setItem(k, JSON.stringify(w));
        } catch {
          /* 저장 못 해도 된다 */
        }
      },
    },
    searchRef,
  };

  // 빵부스러기: 탭 뿌리 뒤의 자리마다 하나
  const crumbs: { label: string; path: Tok[] }[] = [];
  for (let i = tab.path.length; i < eff.path.length; i++) {
    const tok = eff.path[i]!;
    let label = String(tok);
    if (typeof tok === "number") {
      const pm = buildModel(value, schema, { tab: eff.tab, path: eff.path.slice(0, i) });
      label = pm?.rows[tok]?.label ?? rowLabel(getIn(value, eff.path.slice(0, i + 1)), tok, []);
    }
    crumbs.push({ label, path: eff.path.slice(0, i + 1) });
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className="gsd" data-theme={theme}>
        <div className="gsd-top">
          <span className="gsd-file" title={path}>{path}</span>
          <div className="gsd-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.block} role="tab" aria-selected={t.block === eff.tab} className={`gsd-tab${t.block === eff.tab ? " on" : ""}`} onClick={() => setLoc({ tab: t.block, path: [...t.path] })}>
                {t.name}
              </button>
            ))}
          </div>
        </div>
        {crumbs.length > 0 && (
          <div className="gsd-crumbs">
            <button className="gsd-crumb" onClick={() => setLoc({ tab: eff.tab, path: [...tab.path] })}>{tab.name}</button>
            {crumbs.map((c, i) => (
              <span key={i} className="gsd-crumb-wrap">
                <span className="gsd-sep">›</span>
                <button className={`gsd-crumb${i === crumbs.length - 1 ? " last" : ""}`} onClick={() => setLoc({ tab: eff.tab, path: c.path })}>{c.label}</button>
              </span>
            ))}
          </div>
        )}
        <div className="gsd-body">{model ? <Grid model={model} /> : <div className="gsd-empty">Nothing to show here.</div>}</div>
        {toast && <div className={`gsd-toast ${toast.kind}`} role="status">{toast.msg}</div>}
      </div>
    </Ctx.Provider>
  );
});

function ErrorView({ path, text, error, showSrc, setShowSrc }: { path: string; text: string; error: Error; showSrc: boolean; setShowSrc: (b: boolean) => void }) {
  const line = error instanceof GsdError ? error.line : 0;
  const lines = text.split("\n");
  const from = showSrc ? 1 : Math.max(1, line - 3);
  const to = showSrc ? lines.length : Math.min(lines.length, line + 3);
  const shown = [];
  for (let n = from; n <= to; n++) shown.push(n);
  return (
    <div className="gsd-error">
      <div className="gsd-error-title">Can't read {path}</div>
      <div className="gsd-error-msg">{error.message}</div>
      {line > 0 && <div className="gsd-muted small">Line {line}</div>}
      <pre className="gsd-src">
        {shown.map((n) => (
          <div key={n} className={n === line ? "bad" : ""}>
            <span className="no">{n}</span>
            {lines[n - 1]}
          </div>
        ))}
      </pre>
      <button onClick={() => setShowSrc(!showSrc)}>{showSrc ? "Show only the nearby lines" : "View whole source"}</button>
    </div>
  );
}
