/*
  시트 화면: 표 모델 하나(SheetModel)를 격자로. 줄은 보이는 것만 그린다.
  - 칸 고르기·범위(Shift/끌기)·화살표·Tab/Enter, 더블클릭·타이핑으로 고치기, 고를 값은 찾기 달린 고르기 창.
  - ⌘C/⌘X/⌘V 는 탭 구분 글 (스프레드시트와 주고받는다).
  - 목록·레코드·합 타입 칸은 `[3] ▸` 요약, 마우스를 잠깐 두면 하위 시트 판 (CellPop), 누르면 그 칸의 하위 시트로 들어감.
  - 정렬(머리 누르기)·찾기·열 너비 끌기·머리 줄과 첫 열 고정.
  되돌리기(⌘Z)·저장(⌘S) 키는 먹지 않고 앱으로 올려 보낸다.
*/
import { typeText } from "@gsd/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { CellPop, usePopStack, type PopApi } from "./CellPop.tsx";
import { useBook, type GridMemo } from "./ctx.ts";
import { planAddRow, planCellText, planCellValue, planDelete, planDuplicate, type Edit } from "./model/edit.ts";
import { chipWidth, fitChips, idsOfValue, rowsOfEnum, rowsOfRefs, type PickRow } from "./model/refpick.ts";
import { arrange, nextSort, type SortState } from "./model/sort.ts";
import { parseTsv, planPaste, rangeText } from "./model/tsv.ts";
import { buildModel, cellSpec, cellValue, shownOfCell, textOfCell, type SCol, type SheetModel, type SRow } from "./model/view.ts";
import { Icon, RefPicker } from "./RefPicker.tsx";

const HEAD_H = 34;
const GUTTER_W = 46;
const ROW_H = 28;

type Pos = { r: number; c: number };
interface Sel {
  a: Pos;
  b: Pos;
}
const box = (s: Sel) => ({ r0: Math.min(s.a.r, s.b.r), r1: Math.max(s.a.r, s.b.r), c0: Math.min(s.a.c, s.b.c), c1: Math.max(s.a.c, s.b.c) });
const ZERO: Sel = { a: { r: 0, c: 0 }, b: { r: 0, c: 0 } };

/** 칸 위의 타입 배지 글 (짧게) */
function badge(t: SCol["type"]): string {
  const s = typeText(t);
  return s.length > 16 ? s.slice(0, 15) + "…" : s;
}

function defaultWidth(model: SheetModel, col: SCol, text: (r: SRow, c: SCol) => string): number {
  if (col.role === "field") return 160;
  let n = 0;
  for (const r of model.rows.slice(0, 40)) n = Math.max(n, text(r, col).length);
  const head = col.label.length + (col.unit ? col.unit.length + 1 : 0) + 6;
  return Math.max(70, Math.min(280, Math.max(n * 7.4, head * 8) + 26));
}

// ------------------------------------------------------------------ 칸 고치기 상자

function Editor({ initial, replace, onDone }: { initial: string; replace: boolean; onDone: (text: string | null, move: "down" | "right" | "left" | "stay") => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (replace) el.setSelectionRange(el.value.length, el.value.length);
    else el.select();
  }, [replace]);
  const finish = (t: string | null, move: "down" | "right" | "left" | "stay") => {
    if (done.current) return;
    done.current = true;
    onDone(t, move);
  };
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") return finish(null, "stay");
    if (e.key === "Enter") return (e.preventDefault(), finish(text, e.shiftKey ? "stay" : "down"));
    if (e.key === "Tab") return (e.preventDefault(), finish(text, e.shiftKey ? "left" : "right"));
  };
  return (
    <div className="sh-edit">
      <input ref={ref} className="sh-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={() => finish(text, "stay")} onMouseDown={(e) => e.stopPropagation()} />
    </div>
  );
}

// ------------------------------------------------------------------ 시트

export interface GridProps {
  model: SheetModel;
  /** 칸 판 안의 시트: 층(메인 시트 0, 판 i 는 i+1)과 판 스택. 내용에 맞는 크기로, 찾기는 없다. */
  embedded?: { level: number; api: PopApi };
}

export function Grid({ model, embedded }: GridProps) {
  const book = useBook();
  const { schema, refOk, readOnly } = book;
  const cols = model.cols;
  const key = model.key;
  const memo = embedded ? undefined : book.memo.get(key);
  const [q, setQ] = useState(memo?.q ?? "");
  const [sort, setSort] = useState<SortState | null>(memo?.sort ?? null);
  const [sel, setSel] = useState<Sel>(memo?.sel ?? ZERO);
  const [edit, setEdit] = useState<{ r: number; c: number; initial: string; replace: boolean } | null>(null);
  const [pick, setPick] = useState<{ r: number; c: number; q0: string } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(500);
  const [widths, setWidths] = useState<Record<string, number>>(() => book.widths.get(key));
  const [menu, setMenu] = useState<{ x: number; y: number; row: SRow } | null>(null);
  const [confirmDel, setConfirmDel] = useState<SRow[] | null>(null);
  const ownPops = usePopStack();
  const pops = embedded?.api ?? ownPops;
  const level = embedded?.level ?? 0;
  const scroller = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const latest = useRef<GridMemo | null>(null);
  const busy = !!(edit || pick || menu || confirmDel);
  useEffect(() => {
    if (!busy) return;
    pops.hold(1);
    return () => pops.hold(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const text = (r: SRow, c: SCol) => textOfCell(model, r, c, schema, refOk);
  const shown = (r: SRow, c: SCol) => shownOfCell(model, r, c, schema, refOk);

  // 시트가 바뀌면 (다른 칸으로 들어감) 기억해 둔 자리로
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      const m = book.memo.get(key);
      if (m && scroller.current) {
        scroller.current.scrollTop = m.scrollTop;
        scroller.current.scrollLeft = m.scrollLeft;
      }
      return;
    }
    const m = embedded ? undefined : book.memo.get(key);
    setQ(m?.q ?? "");
    setSort(m?.sort ?? null);
    setSel(m?.sel ?? ZERO);
    setEdit(null);
    setPick(null);
    pops.closeFrom(level);
    setMenu(null);
    setConfirmDel(null);
    setWidths(book.widths.get(key));
    setScrollTop(m?.scrollTop ?? 0);
    scroller.current?.scrollTo(m?.scrollLeft ?? 0, m?.scrollTop ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // 떠날 때 (키가 바뀌거나 닫힐 때) 선택·정렬·스크롤을 책에 맡긴다
  latest.current = { sel, sort, q, scrollTop, scrollLeft: scroller.current?.scrollLeft ?? 0 };
  useEffect(() => {
    if (embedded) return;
    const m = book.memo;
    const k = key;
    return () => {
      if (latest.current) m.set(k, latest.current);
    };
  }, [key, embedded, book.memo]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const colW = (c: SCol) => widths[c.id] ?? defaultWidth(model, c, text);
  const rows = useMemo(
    () => arrange(model.rows, (r, id) => { const c = cols.find((x) => x.id === id); return c ? text(r, c) : ""; }, cols.map((c) => c.id), q, sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.rows, cols, q, sort, schema],
  );
  // 선택이 줄 수 밖으로 나가면 당긴다 (줄이 줄었을 때)
  const nR = rows.length;
  useEffect(() => {
    setSel((s) => (s.a.r < nR && s.b.r < nR) || nR === 0 ? s : { a: { r: Math.min(s.a.r, nR - 1), c: s.a.c }, b: { r: Math.min(s.b.r, nR - 1), c: s.b.c } });
  }, [nR]);

  const totalW = GUTTER_W + cols.reduce((n, c) => n + colW(c), 0);
  const nF = 1;
  const leftOf = (c: number) => (c < nF ? GUTTER_W + cols.slice(0, c).reduce((n, x) => n + colW(x), 0) : undefined);
  const frozenW = GUTTER_W + cols.slice(0, nF).reduce((n, x) => n + colW(x), 0);
  const rowTop = (i: number) => i * ROW_H;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 6);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + 6);
  const rowAt = (r: number) => rows[r];
  const specOf = (row: SRow | undefined, col: SCol | undefined) => (row && col ? cellSpec(model, row, col, schema, refOk) : null);
  const editable = (row: SRow | undefined, col: SCol | undefined) => {
    const s = specOf(row, col);
    return !!s && !s.ro && !readOnly;
  };
  const cellPath = (row: SRow, col: SCol) => (col.role === "value" ? row.path : [...row.path, ...col.rel]);

  // ---- 고침 적용
  const run = (edits: Edit[]): string | null => (edits.length ? book.apply(edits) : null);
  const setCell = (row: SRow, col: SCol, t: string): string | null => {
    const p = planCellText(model, row, col, t, schema, refOk);
    if (!p.ok) return p.why;
    return run(p.edits);
  };

  // ---- 움직이기
  const clamp = (p: Pos): Pos => ({ r: Math.max(0, Math.min(rows.length - 1, p.r)), c: Math.max(0, Math.min(cols.length - 1, p.c)) });
  const reveal = (p: Pos) => {
    const el = scroller.current;
    if (!el) return;
    const top = rowTop(p.r);
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight - HEAD_H) el.scrollTop = top + ROW_H - el.clientHeight + HEAD_H;
    let x = GUTTER_W;
    for (let i = 0; i < p.c; i++) x += colW(cols[i]!);
    const w = colW(cols[p.c]!);
    if (p.c >= nF) {
      if (x - frozenW < el.scrollLeft && x - GUTTER_W > 0) el.scrollLeft = Math.max(0, x - frozenW);
      else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
    }
  };
  const move = (dr: number, dc: number, extend: boolean) => {
    const f = clamp({ r: sel.b.r + dr, c: sel.b.c + dc });
    setSel(extend ? { a: sel.a, b: f } : { a: f, b: f });
    reveal(f);
  };
  const goto = (p: Pos) => {
    const f = clamp(p);
    setSel({ a: f, b: f });
    reveal(f);
  };

  const open = (row: SRow, col: SCol) => {
    pops.closeFrom(0);
    book.drill(cellPath(row, col));
  };
  const openRow = (row: SRow) => {
    if (!buildModel(book.value, schema, { tab: book.tab, path: row.path })) return;
    pops.closeFrom(0);
    book.drill(row.path);
  };
  const startEdit = (r: number, c: number, initial?: string) => {
    const row = rowAt(r);
    const col = cols[c];
    const s = specOf(row, col);
    if (!row || !col || !s) return;
    if (s.kind === "drill") return open(row, col);
    if (!editable(row, col) || s.kind === "bool") return;
    if (s.kind === "enum" || s.kind === "ref" || s.kind === "reflist") return setPick({ r, c, q0: initial ?? "" });
    setEdit({ r, c, initial: initial ?? text(row, col), replace: initial !== undefined });
  };
  const toggleBool = (r: number, c: number) => {
    const row = rowAt(r);
    const col = cols[c];
    const s = specOf(row, col);
    if (!row || !col || !s || s.kind !== "bool" || !editable(row, col)) return false;
    const p = planCellValue(row, col, s, cellValue(row, col) !== true);
    if (p.ok) run(p.edits);
    return true;
  };

  // ---- 글 복사·붙이기
  const selText = () => {
    const b = box(sel);
    return rangeText(model, rows.slice(b.r0, b.r1 + 1), cols.slice(b.c0, b.c1 + 1), schema, refOk);
  };
  const clearSel = () => {
    const b = box(sel);
    const edits: Edit[] = [];
    for (let r = b.r0; r <= b.r1; r++)
      for (let c = b.c0; c <= b.c1; c++) {
        const row = rowAt(r);
        const col = cols[c];
        const s = specOf(row, col);
        if (!row || !col || !s || !editable(row, col) || !s.optional || col.role) continue;
        edits.push({ path: cellPath(row, col), value: undefined });
      }
    const why = run(edits);
    if (why) book.toast(why, "err");
  };
  const paste = (t: string) => {
    let grid = parseTsv(t);
    if (!grid.length) return;
    const b = box(sel);
    if (grid.length === 1 && grid[0]!.length === 1 && (b.r1 > b.r0 || b.c1 > b.c0)) grid = Array.from({ length: b.r1 - b.r0 + 1 }, () => Array.from({ length: b.c1 - b.c0 + 1 }, () => grid[0]![0]!));
    const plan = planPaste(model, schema, refOk, rows, cols, b.r0, b.c0, grid);
    if (plan.errors.length) return book.toast(`Nothing pasted — ${plan.errors.slice(0, 3).join(" / ")}${plan.errors.length > 3 ? ` (+${plan.errors.length - 3} more)` : ""}`, "err");
    const why = run(plan.edits);
    if (why) return book.toast(why, "err");
    book.toast(`Pasted ${plan.edits.length} cell${plan.edits.length === 1 ? "" : "s"}${plan.overflow ? ` (${plan.overflow} outside the sheet were dropped)` : ""}`, plan.overflow ? "info" : "ok");
  };

  // ---- 키
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (edit || pick) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (mod && "zZsSfFrR".includes(k) && k.length === 1) return; // 되돌리기·저장·찾기는 앱이
    if (mod && (k === "a" || k === "A")) {
      e.preventDefault();
      setSel({ a: { r: 0, c: 0 }, b: { r: rows.length - 1, c: cols.length - 1 } });
      return;
    }
    if (mod && (k === "c" || k === "x" || k === "v")) return;
    if (k === "ArrowDown") return (e.preventDefault(), mod ? goto({ r: rows.length - 1, c: sel.b.c }) : move(1, 0, e.shiftKey));
    if (k === "ArrowUp") return (e.preventDefault(), mod ? goto({ r: 0, c: sel.b.c }) : move(-1, 0, e.shiftKey));
    if (k === "ArrowRight") return (e.preventDefault(), move(0, 1, e.shiftKey));
    if (k === "ArrowLeft") return (e.preventDefault(), move(0, -1, e.shiftKey));
    if (k === "PageDown") return (e.preventDefault(), move(15, 0, e.shiftKey));
    if (k === "PageUp") return (e.preventDefault(), move(-15, 0, e.shiftKey));
    if (k === "Home") return (e.preventDefault(), goto({ r: mod ? 0 : sel.b.r, c: 0 }));
    if (k === "End") return (e.preventDefault(), goto({ r: mod ? rows.length - 1 : sel.b.r, c: cols.length - 1 }));
    if (k === "Tab") return (e.preventDefault(), move(0, e.shiftKey ? -1 : 1, false));
    const row = rowAt(sel.b.r);
    const col = cols[sel.b.c];
    if (!row || !col) return;
    if (k === "Enter" || k === "F2") {
      e.preventDefault();
      if (k === "Enter" && toggleBool(sel.b.r, sel.b.c)) return;
      return startEdit(sel.b.r, sel.b.c);
    }
    if (k === " " && toggleBool(sel.b.r, sel.b.c)) return e.preventDefault();
    if (k === "Delete" || k === "Backspace") return (e.preventDefault(), clearSel());
    if (k === "Escape") return setSel({ a: sel.b, b: sel.b });
    if (!mod && !e.altKey && k.length === 1) {
      e.preventDefault();
      startEdit(sel.b.r, sel.b.c, k);
    }
  };

  const anchorOf = (r: number, c: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    const b = el?.getBoundingClientRect();
    return b ? { left: b.left, right: b.right, top: b.top, bottom: b.bottom } : { left: 120, right: 300, top: 120, bottom: 150 };
  };

  // 고르기 창의 후보 (ref → refs(kind), enum → 값)
  const pickRows = (s: NonNullable<ReturnType<typeof specOf>>): PickRow[] => (s.refKind ? rowsOfRefs(book.refOpts(s.refKind)) : rowsOfEnum(s.options ?? []));
  const onPickDone = (selIds: string[] | null) => {
    const at = pick!;
    setPick(null);
    scroller.current?.focus();
    if (selIds === null) return;
    const row = rowAt(at.r);
    const col = cols[at.c];
    const s = specOf(row, col);
    if (!row || !col || !s) return;
    if (col.role === "variant" || row.id === "@variant") {
      const why = setCell(row, col, selIds[0] ?? "");
      return why ? book.toast(`${col.label}: ${why}`, "err") : undefined;
    }
    const p = s.multi ? planCellValue(row, col, s, selIds) : planCellValue(row, col, s, selIds[0] === undefined ? undefined : selIds[0]);
    if (!p.ok) return book.toast(`${col.label}: ${p.why}`, "err");
    const why = run(p.edits);
    if (why) book.toast(`${col.label}: ${why}`, "err");
  };
  const onEditDone = (t: string | null, mv: "down" | "right" | "left" | "stay") => {
    const at = edit!;
    setEdit(null);
    scroller.current?.focus();
    if (t === null) return;
    const row = rowAt(at.r);
    const col = cols[at.c];
    if (!row || !col) return;
    const why = setCell(row, col, t);
    if (why) {
      book.toast(`${col.label}: ${why}`, "err");
      return setEdit({ ...at, initial: t, replace: true });
    }
    if (mv === "down") goto({ r: at.r + 1, c: at.c });
    else if (mv === "right") goto({ r: at.r, c: at.c + 1 });
    else if (mv === "left") goto({ r: at.r, c: at.c - 1 });
  };

  // ---- 마우스
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    const closeMenu = () => setMenu(null);
    window.addEventListener("mousedown", closeMenu);
    return () => (window.removeEventListener("mouseup", up), window.removeEventListener("mousedown", closeMenu));
  }, []);
  const onCellDown = (e: React.MouseEvent, r: number, c: number) => {
    if (e.button !== 0) return;
    scroller.current?.focus();
    moved.current = false;
    dragging.current = true;
    const p = { r, c };
    setSel(e.shiftKey ? { a: sel.a, b: p } : { a: p, b: p });
  };
  const onCellHoverPop = (e: React.MouseEvent, row: SRow, col: SCol) => {
    if (dragging.current || edit || pick) return;
    const s = specOf(row, col);
    const el = e.currentTarget as HTMLElement;
    const path = cellPath(row, col);
    const drillCell = !!s && s.kind === "drill";
    pops.enterCell(level, drillCell ? path : null, () => {
      const b = el.getBoundingClientRect();
      // 판 안의 칸이면 앞 판의 옆에 붙는다 (가로는 앞 판, 세로는 이 칸)
      const host = scroller.current?.closest("[data-pop]")?.getBoundingClientRect() ?? b;
      return { path, title: `${row.label} › ${col.label}`, ro: !editable(row, col), anchor: { left: host.left, right: host.right, top: b.top, bottom: b.bottom } };
    });
  };
  const onCellLeavePop = (e: React.MouseEvent) => {
    const surface = (e.currentTarget as HTMLElement).closest("[data-pop]");
    pops.leaveCell(surface && surface.contains(e.relatedTarget as Node | null) ? level : 0);
  };
  const onCellEnter = (r: number, c: number) => {
    if (!dragging.current) return;
    moved.current = true;
    setSel((s) => ({ a: s.a, b: { r, c } }));
  };
  const onCellClick = (e: React.MouseEvent, r: number, c: number) => {
    if (moved.current || e.shiftKey) return;
    const row = rowAt(r);
    const col = cols[c];
    const s = specOf(row, col);
    if (!row || !col || !s) return;
    if (s.kind === "drill") open(row, col);
    else if (s.kind === "bool" && e.target instanceof HTMLInputElement) toggleBool(r, c);
    else if ((s.kind === "ref" || s.kind === "reflist" || s.kind === "enum") && editable(row, col)) startEdit(r, c);
  };
  const dragResize = (e: React.MouseEvent, col: SCol) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = colW(col);
    const mv = (ev: MouseEvent) => setWidths((w) => ({ ...w, [col.id]: Math.max(50, Math.min(900, w0 + ev.clientX - x0)) }));
    const upH = () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", upH);
      setWidths((w) => (book.widths.set(key, w), w));
    };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", upH);
  };

  // ---- 줄 일
  const b = box(sel);
  const selRows = useMemo(() => {
    const out: SRow[] = [];
    for (let r = b.r0; r <= b.r1; r++) if (rows[r]) out.push(rows[r]!);
    return out;
  }, [b.r0, b.r1, rows]);
  const curRow = rowAt(sel.b.r);
  const canAdd = !readOnly && model.addable;
  const doAdd = () => {
    const p = planAddRow(model, schema);
    if (!p.ok) return book.toast(p.why, "err");
    const why = run(p.edits);
    if (why) return book.toast(why, "err");
    // 새 줄(끝)로 가서 보인다
    window.setTimeout(() => {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  };
  const doDup = (row: SRow) => {
    const p = planDuplicate(model, schema, row);
    if (!p.ok) return book.toast(p.why, "err");
    const why = run(p.edits);
    if (why) book.toast(why, "err");
  };
  const doDel = (list: SRow[]) => {
    const p = planDelete(model, list);
    if (!p.ok) return book.toast(p.why, "err");
    const why = run(p.edits);
    if (why) book.toast(why, "err");
  };

  const fit: React.CSSProperties | undefined = embedded
    ? { flex: "none", width: Math.min(totalW + 14, Math.min(640, window.innerWidth * 0.9)), height: Math.min(HEAD_H + Math.max(rows.length * ROW_H, 40) + 14, Math.min(360, window.innerHeight * 0.55)) }
    : undefined;

  const cellEl = (row: SRow, r: number, col: SCol, c: number) => {
    const s = specOf(row, col);
    const v = s ? cellValue(row, col) : undefined;
    const inSel = r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1;
    const cur = r === sel.b.r && c === sel.b.c;
    const ro = !s || !editable(row, col);
    let content: React.ReactNode = null;
    let title = "";
    if (!s) {
      content = <span className="gsd-muted">—</span>;
    } else if (s.kind === "bool") {
      content = <input type="checkbox" checked={v === true} disabled={ro} readOnly onChange={() => undefined} />;
    } else if (s.kind === "reflist") {
      const ids = idsOfValue(v);
      const opts = s.refKind ? book.refOpts(s.refKind) : [];
      const byId = new Map(opts.map((o) => [String(o.id), o]));
      const names = ids.map((id) => byId.get(id)?.label ?? id);
      const hasIcon = opts.some((o) => o.icon);
      const n = fitChips(names.map((x) => chipWidth(x, hasIcon)), colW(col) - 16);
      const known = s.refKind ? (id: string) => byId.has(id) : (id: string) => (s.options ?? []).includes(id);
      content = (
        <span className="rp-chips">
          {ids.slice(0, n).map((id, i) => (
            <span key={`${id}.${i}`} className={`rp-chip${known(id) ? "" : " miss"}`} title={known(id) ? id : `Not found: ${id}`}>
              <Icon icon={byId.get(id)?.icon} size={16} />
              <span>{names[i]}</span>
            </span>
          ))}
          {ids.length > n && <span className="rp-more">+{ids.length - n}</span>}
          {ids.length === 0 && <span className="gsd-muted">—</span>}
        </span>
      );
    } else if (s.kind === "drill") {
      content = <span className="sh-drill">{shown(row, col)}</span>;
    } else if (s.kind === "ref" && typeof v === "string") {
      const o = book.refOpts(s.refKind!).find((x) => String(x.id) === v);
      const gone = !o && v !== "" && book.refOpts(s.refKind!).length > 0;
      content = (
        <>
          <Icon icon={o?.icon} size={18} />
          <span className={`sh-txt${gone ? " rp-gone" : ""}`}>{v}</span>
          {o?.label && o.label !== v && <span className="sh-sub gsd-muted">{o.label}</span>}
        </>
      );
      if (gone) title = `Not found: ${v}`;
    } else {
      const t = shown(row, col);
      content = <span className={`sh-txt${col.role === "field" ? " sh-field" : ""}`}>{t}</span>;
      if (col.role === "field" && row.doc) title = row.doc;
      else if (t.length > 24) title = t;
    }
    return (
      <div
        key={col.id}
        data-r={r}
        data-c={c}
        className={`sh-cell${c < nF ? " frozen" : ""}${inSel ? " sel" : ""}${cur ? " cur" : ""}${s?.kind === "drill" ? " drillc" : ""}${ro ? " ro" : ""}${s && (s.t.k === "int" || s.t.k === "num") ? " num" : ""}`}
        style={{ width: colW(col), left: leftOf(c) }}
        title={title || undefined}
        onMouseDown={(e) => onCellDown(e, r, c)}
        onMouseEnter={(e) => (onCellEnter(r, c), onCellHoverPop(e, row, col))}
        onMouseLeave={onCellLeavePop}
        onClick={(e) => onCellClick(e, r, c)}
        onDoubleClick={() => startEdit(r, c)}
      >
        {edit && edit.r === r && edit.c === c ? <Editor initial={edit.initial} replace={edit.replace} onDone={onEditDone} /> : content}
      </div>
    );
  };

  const pickCol = pick ? cols[pick.c] : undefined;
  const pickRow = pick ? rowAt(pick.r) : undefined;
  const pickSpec = specOf(pickRow, pickCol);

  return (
    <div className="pane sheet-pane">
      {(!embedded || canAdd) && (
        <div className="toolbar">
          {!embedded && <input ref={book.searchRef} type="search" placeholder="Find in this sheet" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find in this sheet" style={{ width: 200 }} />}
          {!embedded && <span className="gsd-muted small">{rows.length === model.rows.length ? `${rows.length} rows` : `${rows.length} / ${model.rows.length} rows`}</span>}
          <span className="spacer" />
          {!embedded && curRow && model.kind === "table" && (
            <button onClick={() => openRow(curRow)} title="Open this row as a field list">
              Open row
            </button>
          )}
          {model.addable && (
            <>
              <button disabled={!canAdd} onClick={doAdd} title="Add a row at the end">
                + Row
              </button>
              <button disabled={!canAdd || !curRow} onClick={() => curRow && doDup(curRow)}>
                Duplicate
              </button>
              <button className="danger" disabled={!canAdd || !curRow} onClick={() => setConfirmDel(selRows)}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
      <div
        className="sheet"
        style={fit}
        ref={scroller}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => (setScrollTop(e.currentTarget.scrollTop), pops.closeFrom(level))}
        onCopy={(e) => {
          if ((e.target as HTMLElement).matches?.("input, textarea")) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", selText());
        }}
        onCut={(e) => {
          if ((e.target as HTMLElement).matches?.("input, textarea")) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", selText());
          clearSel();
        }}
        onPaste={(e) => {
          if ((e.target as HTMLElement).matches?.("input, textarea")) return;
          e.preventDefault();
          if (readOnly) return book.toast("Read-only", "err");
          paste(e.clipboardData.getData("text/plain"));
        }}
      >
        <div className="sh-head" style={{ width: totalW, height: HEAD_H }}>
          <div className="sh-hc gutter" style={{ width: GUTTER_W }} onClick={() => setSel({ a: { r: 0, c: 0 }, b: { r: rows.length - 1, c: cols.length - 1 } })} title="Select all">
            #
          </div>
          {cols.map((c, ci) => (
            <div
              key={c.id}
              className={`sh-hc${ci < nF ? " frozen" : ""}${sort?.col === c.id ? " on" : ""}`}
              style={{ width: colW(c), left: leftOf(ci) }}
              title={[c.doc, `${c.label}${c.role ? "" : ": " + typeText(c.type)}${c.optional ? " (optional)" : ""}`].filter(Boolean).join("\n")}
              onClick={() => setSort(nextSort(sort, c.id))}
            >
              <span className="sh-hn">{c.label}</span>
              {!c.role && <span className="sh-ty">{badge(c.type)}{c.optional ? "?" : ""}</span>}
              {c.unit && <span className="sh-unit">{c.unit}</span>}
              {c.doc && <span className="sh-doc">i</span>}
              {sort?.col === c.id ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              <span className="sh-rz" onMouseDown={(e) => dragResize(e, c)} onClick={(e) => e.stopPropagation()} />
            </div>
          ))}
        </div>
        <div style={{ height: rows.length * ROW_H, width: totalW, position: "relative" }}>
          {rows.slice(start, end).map((row, n) => {
            const r = start + n;
            const inRows = r >= b.r0 && r <= b.r1;
            return (
              <div key={row.id} className={`sh-row${inRows ? " rsel" : ""}`} style={{ top: rowTop(r), height: ROW_H, width: totalW }}>
                <div
                  className="sh-gutter"
                  style={{ width: GUTTER_W }}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    scroller.current?.focus();
                    setSel(e.shiftKey ? { a: sel.a, b: { r, c: cols.length - 1 } } : { a: { r, c: 0 }, b: { r, c: cols.length - 1 } });
                  }}
                  onDoubleClick={() => openRow(row)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, row });
                  }}
                >
                  {model.kind === "kv" || model.kind === "props" ? "" : r + 1}
                </div>
                {cols.map((col, c) => cellEl(row, r, col, c))}
              </div>
            );
          })}
        </div>
        {!rows.length && <div className="empty-note">{model.rows.length ? "No matching rows" : canAdd ? "No rows — use + Row" : "No rows"}</div>}
      </div>
      {menu && (
        <div className="sh-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {model.kind === "table" && <div onClick={() => (openRow(menu.row), setMenu(null))}>Open row</div>}
          {canAdd && <div onClick={() => (doDup(menu.row), setMenu(null))}>Duplicate</div>}
          {canAdd && <div onClick={() => (setConfirmDel([menu.row]), setMenu(null))}>Delete</div>}
          <div
            onClick={() => {
              void navigator.clipboard?.writeText(JSON.stringify(menu.row.value, null, 2));
              book.toast("Copied as JSON", "info");
              setMenu(null);
            }}
          >
            Copy as JSON
          </div>
        </div>
      )}
      {pick && pickRow && pickCol && pickSpec && (
        <RefPicker
          title={pickCol.label}
          hint={pickSpec.refKind ? `ref(${pickSpec.refKind})` : "enum"}
          rows={pickRows(pickSpec)}
          multi={!!pickSpec.multi}
          initial={pickCol.role === "variant" || pickRow.id === "@variant" ? [model.variants?.[pickRow.variant ?? -1] ?? ""].filter(Boolean) : idsOfValue(cellValue(pickRow, pickCol))}
          q0={pick.q0}
          anchor={anchorOf(pick.r, pick.c)}
          clearable={pickSpec.optional || !!pickSpec.multi}
          onDone={onPickDone}
        />
      )}
      {!embedded && pops.stack.map((spec, i) => <CellPop key={`${i}:${spec.path.join("\u0001")}`} index={i} spec={spec} api={pops} />)}
      {confirmDel && (
        <div className="gsd-scrim" onMouseDown={() => setConfirmDel(null)}>
          <div className="gsd-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && setConfirmDel(null)}>
            <div className="gsd-dialog-title">Delete rows</div>
            <div className="gsd-muted">Delete {confirmDel.length} selected row{confirmDel.length === 1 ? "" : "s"}? Undo restores them.</div>
            <div className="gsd-dialog-foot">
              <button autoFocus onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="danger" onClick={() => (doDel(confirmDel), setConfirmDel(null))}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
