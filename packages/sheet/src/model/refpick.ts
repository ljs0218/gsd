// 고르기 창의 순수 규칙: 후보 목록(@ref 의 refs(kind) 또는 @enum 값) · 찾기 · 체크 차례 · 칸 칩.
import type { RefOption } from "./types.ts";

export interface PickRow {
  id: string;
  name: string;
  icon?: string;
  /** 후보에 없는 값 (지워진 것·오타) */
  missing?: boolean;
}

export const rowsOfRefs = (opts: RefOption[]): PickRow[] => opts.map((o) => ({ id: String(o.id), name: o.label ?? String(o.id), icon: o.icon }));
export const rowsOfEnum = (vals: string[]): PickRow[] => vals.map((v) => ({ id: v, name: v }));

/** 후보 + 지금 값 가운데 후보에 없는 것 (지울 수 있게 남긴다). */
export function withCurrent(rows: PickRow[], current: string[]): PickRow[] {
  const have = new Set(rows.map((r) => r.id));
  const out = [...rows];
  for (const id of current) if (!have.has(id)) (have.add(id), out.push({ id, name: id, missing: true }));
  return out;
}

export function matchRow(r: PickRow, q: string): boolean {
  const n = q.trim().toLowerCase();
  return !n || r.name.toLowerCase().includes(n) || r.id.toLowerCase().includes(n);
}

/** 고른 것(고른 차례) 먼저, 나머지는 찾기에 맞는 것을 후보 차례대로. */
export function layoutRows(rows: PickRow[], sel: string[], q: string): { picked: PickRow[]; rest: PickRow[] } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const picked = sel.map((id) => byId.get(id) ?? ({ id, name: id, missing: true } as PickRow));
  const chosen = new Set(sel);
  return { picked, rest: rows.filter((r) => !chosen.has(r.id) && matchRow(r, q)) };
}

/** 체크: 없으면 끝에 붙이고, 있으면 뺀다. 하나만 받는 칸은 그것 하나로 바꾼다. */
export function toggleId(sel: string[], id: string, multi: boolean): string[] {
  if (!multi) return [id];
  return sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
}

/** 고른 것 한 줄을 끌어 다른 자리로. */
export function moveId(sel: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= sel.length || to >= sel.length) return sel;
  const out = [...sel];
  out.splice(to, 0, out.splice(from, 1)[0]!);
  return out;
}

/** 칸 값 → 고른 id 들. */
export function idsOfValue(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return v === undefined || v === null || v === "" ? [] : [String(v)];
}

/** 칩 하나의 어림 너비 (px). */
export const chipWidth = (name: string, icon: boolean) => (icon ? 22 : 0) + name.length * 7.2 + 16;

/** 칸 너비(px) 안에 칩이 몇 개 드는가 — 넘치면 '+n' 자리를 남긴다. 하나는 늘 보인다. */
export function fitChips(widths: number[], avail: number): number {
  const plus = 30;
  const gap = 4;
  let used = 0;
  let n = 0;
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i]! + gap;
    const rest = widths.length - i - 1;
    if (used + w + (rest > 0 ? plus : 0) > avail && n > 0) break;
    used += w;
    n++;
  }
  return Math.max(1, n);
}
