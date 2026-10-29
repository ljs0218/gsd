/*
  고르기 창: @ref 의 후보(아이콘·이름·id) 또는 @enum 값 중에서 고른다.
  - 목록 칸: 체크박스 여럿. 고른 것이 위에 고른 차례로 (끌어 바꾸기), 아래에 나머지.
  - 낱값 칸: 하나 누르면 닫힌다.
  키: ↑↓ 움직임 · Space 체크(찾기가 빌 때) · Enter 확정 · Esc 취소. 바깥을 누르면 목록 칸은 확정, 낱값 칸은 취소.
  규칙은 model/refpick.ts, 이 파일은 그리기만 한다.
*/
import { useEffect, useMemo, useRef, useState } from "react";
import { layoutRows, moveId, toggleId, withCurrent, type PickRow } from "./model/refpick.ts";
import type { Rect } from "./model/popstack.ts";

export function Icon({ icon, size }: { icon?: string; size: number }) {
  if (!icon) return null;
  if (/^(https?:|data:|\/|\.\/)/.test(icon)) return <img className="gsd-icon" src={icon} width={size} height={size} alt="" />;
  return (
    <span className="gsd-icon txt" style={{ width: size, height: size, fontSize: Math.round(size * 0.8) }}>
      {icon}
    </span>
  );
}

export interface RefPickerProps {
  title: string;
  /** 위쪽 작은 글 (ref 종류 이름) */
  hint?: string;
  rows: PickRow[];
  multi: boolean;
  initial: string[];
  q0?: string;
  anchor: Rect;
  /** 낱값 칸의 비움을 허용하는가 */
  clearable: boolean;
  /** 고르기 끝: 고른 id 들 (비움은 []) / null = 취소 */
  onDone: (sel: string[] | null) => void;
}

const POP_W = 380;
const POP_H = 420;

export function RefPicker({ title, hint, rows: base, multi, initial, q0 = "", anchor, clearable, onDone }: RefPickerProps) {
  const [sel, setSel] = useState<string[]>(initial);
  const [q, setQ] = useState(q0);
  const [cur, setCur] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listEl = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const done = useRef(false);

  const rows = useMemo(() => withCurrent(base, initial), [base, initial]);
  const { picked, rest } = useMemo(() => layoutRows(rows, sel, q), [rows, sel, q]);
  const shownRest = rest.slice(0, 150);
  const flat: PickRow[] = useMemo(() => [...picked, ...shownRest], [picked, shownRest]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setCur((c) => Math.min(c, Math.max(0, flat.length - 1))), [flat.length]);
  useEffect(() => {
    listEl.current?.querySelector<HTMLElement>(`[data-i="${cur}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cur]);

  const finish = (v: string[] | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  const pick = (r: PickRow) => (multi ? setSel((s) => toggleId(s, r.id, true)) : finish([r.id]));

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") return (e.preventDefault(), finish(null));
    if (e.key === "ArrowDown") return (e.preventDefault(), setCur((c) => Math.min(flat.length - 1, c + 1)));
    if (e.key === "ArrowUp") return (e.preventDefault(), setCur((c) => Math.max(0, c - 1)));
    if (e.key === " " && q === "" && flat[cur]) return (e.preventDefault(), pick(flat[cur]!));
    if (e.key === "Enter") {
      e.preventDefault();
      if (multi) return finish(sel);
      return flat[cur] ? finish([flat[cur]!.id]) : finish(null);
    }
  };

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - POP_W - 8));
  const below = window.innerHeight - anchor.bottom;
  const top = below >= POP_H + 8 || below >= anchor.top ? anchor.bottom + 2 : Math.max(8, anchor.top - POP_H - 2);
  const maxH = Math.min(POP_H, (top > anchor.top ? below : anchor.top) - 12);

  const row = (r: PickRow, i: number, isPicked: boolean) => (
    <div
      key={`${isPicked ? "p" : "r"}.${r.id}`}
      data-i={i}
      className={`rp-row${i === cur ? " cur" : ""}${r.missing ? " miss" : ""}${isPicked ? " picked" : ""}`}
      draggable={multi && isPicked}
      onDragStart={() => (drag.current = i)}
      onDragOver={(e) => multi && isPicked && drag.current !== null && e.preventDefault()}
      onDrop={() => {
        if (drag.current !== null && multi && isPicked) setSel((s) => moveId(s, drag.current!, i));
        drag.current = null;
      }}
      onMouseEnter={() => setCur(i)}
      onClick={() => pick(r)}
    >
      {multi ? <input type="checkbox" checked={isPicked} readOnly tabIndex={-1} /> : <span className={`rp-radio${isPicked ? " on" : ""}`} />}
      <Icon icon={r.icon} size={22} />
      <span className="rp-name">{r.name}</span>
      <span className="rp-id">{r.missing ? "not found" : r.name === r.id ? "" : r.id}</span>
      {multi && isPicked && <span className="rp-grip" title="Drag to reorder">⠿</span>}
    </div>
  );

  return (
    <div className="rp-back" onMouseDown={() => (multi ? finish(sel) : finish(null))}>
      <div className="rp" style={{ left, top, width: POP_W, maxHeight: maxH }} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="rp-head">
          <span className="rp-title">{title}</span>
          <span className="gsd-muted small">
            {hint}
            {multi ? ` · ${sel.length} selected` : ""}
          </span>
        </div>
        <input ref={input} className="rp-q" placeholder="Search by name or id" value={q} onChange={(e) => (setQ(e.target.value), setCur(picked.length))} />
        <div className="rp-list" ref={listEl}>
          {picked.map((r, i) => row(r, i, true))}
          {picked.length > 0 && rest.length > 0 && <div className="rp-sep">Not selected</div>}
          {shownRest.map((r, i) => row(r, picked.length + i, false))}
          {rest.length > shownRest.length && <div className="rp-more-note">… {rest.length - shownRest.length} more (narrow with the search)</div>}
          {!picked.length && !rest.length && <div className="rp-more-note">No matches</div>}
        </div>
        <div className="rp-foot">
          <span className="gsd-muted small">{multi ? "↑↓ move · Space check · Enter confirm · Esc cancel" : "↑↓ move · Enter pick · Esc cancel"}</span>
          <span className="spacer" />
          {clearable && <button onClick={() => finish([])}>Clear</button>}
          {multi && (
            <button className="primary" onClick={() => finish(sel)}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
