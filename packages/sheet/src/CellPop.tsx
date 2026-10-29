/*
  객체·배열 칸에 마우스를 두면 뜨는 판 (Grid 가 띄운다). 판 안은 하위 시트와 같은 격자 — Grid 를 작게 다시 쓴다.
  판 안의 {}·[] 칸에 마우스를 두면 그 판의 오른쪽(모자라면 왼쪽)에 판이 하나 더 — 계단식. 열고 닫는 규칙은 model/popstack.ts.
  고침은 책의 apply (되돌리기·저장이 걸리는 길). 읽기 전용이면 보기만.
*/
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useBook } from "./ctx.ts";
import { Grid } from "./Grid.tsx";
import { dotted } from "./model/book.ts";
import { closeTop, keepFirst, openAt, samePlace, settle, type PopSpec } from "./model/popstack.ts";
import type { Tok } from "./model/types.ts";
import { buildModel } from "./model/view.ts";

const OPEN_MS = 300;
const CLOSE_MS = 250;

export interface PopApi {
  stack: PopSpec[];
  /** 층 level 의 칸 위로 들어옴. cell = 판을 열 칸의 자리 (null 이면 판을 열 칸이 아니다), make = 열 때의 판. */
  enterCell: (level: number, cell: Tok[] | null, make: () => PopSpec) => void;
  leaveCell: (level: number) => void;
  enterPop: (index: number) => void;
  leavePop: () => void;
  /** 층 n 이후의 판을 닫는다 (closeFrom(0) = 모두) */
  closeFrom: (n: number) => void;
  /** 입력·고르기가 열려 있는 동안 닫지 않는다 (+1 / -1) */
  hold: (d: 1 | -1) => void;
}

/** 판 스택의 상태·타이머. 메인 시트가 하나 갖고, 판 안 시트는 그걸 받아 쓴다. */
export function usePopStack(): PopApi {
  const [stack, setStack] = useState<PopSpec[]>([]);
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const t = useRef<{ open?: number; close?: number }>({});
  const hover = useRef(0);
  const holds = useRef(0);

  const focusLevel = () => {
    const el = (document.activeElement as HTMLElement | null)?.closest?.("[data-pop]");
    return el ? Number(el.getAttribute("data-pop")) + 1 : 0;
  };
  const settleLater = useCallback(() => {
    window.clearTimeout(t.current.close);
    t.current.close = window.setTimeout(() => {
      if (holds.current > 0) return;
      setStack((s) => settle(s, hover.current, focusLevel()));
    }, CLOSE_MS);
  }, []);
  const closeFrom = useCallback((n: number) => {
    window.clearTimeout(t.current.open);
    window.clearTimeout(t.current.close);
    if (n <= 0) hover.current = 0;
    setStack((s) => keepFirst(s, n));
  }, []);

  const enterCell = useCallback<PopApi["enterCell"]>(
    (level, cell, make) => {
      window.clearTimeout(t.current.close);
      window.clearTimeout(t.current.open);
      const cur = stackRef.current[level];
      if (cell && cur && samePlace(cur, { path: cell })) {
        hover.current = level + 1;
        return;
      }
      hover.current = level;
      if (!cell) return settleLater();
      t.current.open = window.setTimeout(() => {
        hover.current = level + 1;
        setStack((s) => openAt(s, level, make()));
      }, OPEN_MS);
    },
    [settleLater],
  );
  const leaveCell = useCallback(
    (level: number) => {
      window.clearTimeout(t.current.open);
      hover.current = level;
      settleLater();
    },
    [settleLater],
  );
  const enterPop = useCallback((index: number) => {
    window.clearTimeout(t.current.close);
    hover.current = index + 1;
  }, []);
  const leavePop = useCallback(() => {
    hover.current = 0;
    settleLater();
  }, [settleLater]);
  const hold = useCallback(
    (d: 1 | -1) => {
      holds.current = Math.max(0, holds.current + d);
      if (holds.current === 0) settleLater();
    },
    [settleLater],
  );

  const open = stack.length > 0;
  useEffect(() => {
    if (!open) return;
    // Esc 는 맨 위 판 하나 (글을 고치는 중이면 그쪽 Esc 가 먼저)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
      setStack((s) => closeTop(s));
    };
    const out = () => settleLater();
    window.addEventListener("keydown", esc, true);
    document.addEventListener("focusout", out);
    return () => (window.removeEventListener("keydown", esc, true), document.removeEventListener("focusout", out));
  }, [open, settleLater]);
  useEffect(() => () => (window.clearTimeout(t.current.open), window.clearTimeout(t.current.close)), []);

  return useMemo(() => ({ stack, enterCell, leaveCell, enterPop, leavePop, closeFrom, hold }), [stack, enterCell, leaveCell, enterPop, leavePop, closeFrom, hold]);
}

export interface CellPopProps {
  index: number;
  spec: PopSpec;
  api: PopApi;
}

export function CellPop({ index, spec, api }: CellPopProps) {
  const book = useBook();
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const model = useMemo(() => buildModel(book.value, book.schema, { tab: book.tab, path: spec.path }), [book.value, book.schema, book.tab, spec.path]);
  // 값이 없어졌으면 (되돌리기 …) 이 판과 아래는 닫는다
  useEffect(() => {
    if (!model) api.closeFrom(index);
  }, [model, api, index]);

  // 첫 판은 칸 아래 (화면 밖이면 위·왼쪽으로 뒤집기), 다음 판들은 앞 판의 오른쪽 (모자라면 왼쪽)
  useLayoutEffect(() => {
    const e = el.current;
    if (!e) return;
    const w = e.offsetWidth;
    const h = e.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const a = spec.anchor;
    let left: number;
    let top: number;
    if (index === 0) {
      top = a.bottom + 2;
      if (top + h > vh - 8) top = a.top - h - 2 >= 8 ? a.top - h - 2 : Math.max(8, vh - h - 8);
      left = a.left;
      if (left + w > vw - 8) left = a.right - w >= 8 ? a.right - w : Math.max(8, vw - w - 8);
    } else {
      left = a.right + 2;
      if (left + w > vw - 8) left = a.left - w - 2 >= 8 ? a.left - w - 2 : Math.max(8, vw - w - 8);
      top = Math.max(8, Math.min(a.top, vh - h - 8));
    }
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  });
  if (!model) return null;

  return (
    <div
      ref={el}
      data-pop={index}
      className="cell-pop"
      style={{ left: pos?.left ?? spec.anchor.left, top: pos?.top ?? spec.anchor.bottom + 2, visibility: pos ? "visible" : "hidden" }}
      onMouseEnter={() => api.enterPop(index)}
      onMouseLeave={() => api.leavePop()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="cp-head">
        <span className="cp-title" title={dotted(spec.path)}>{spec.title}</span>
        <span className="gsd-muted small">{spec.ro || book.readOnly ? "view only" : ""}</span>
        <span className="spacer" />
        <button
          className="cp-mini"
          onClick={() => {
            api.closeFrom(0);
            book.drill(spec.path);
          }}
          title="Open this cell as a sub-sheet"
        >
          Open sub-sheet ▸
        </button>
      </div>
      <Grid model={model} embedded={{ level: index + 1, api }} />
    </div>
  );
}
