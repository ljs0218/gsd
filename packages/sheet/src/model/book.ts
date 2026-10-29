// 책 = 스키마의 블록들. 탭 = 상위 시트·props, 하위 시트(`^`)는 부모 줄의 칸으로만 들어간다.
// 자리(Loc) = 블록 번호 + 값 트리의 절대 경로. 값 트리가 바뀌어도 자리는 그대로 다시 풀린다.
import type { Block, Field, PropsBlock, Schema, SheetBlock, T, Tok, XT } from "./types.ts";
import { deref, getIn, samePath, startsWith, walkType } from "./tree.ts";

export interface Loc {
  tab: number;
  path: Tok[];
}

export interface Tab {
  /** schema.blocks 의 번호 */
  block: number;
  name: string;
  kind: "sheet" | "props";
  /** 이 탭의 뿌리가 값 트리의 어디인가 (시트는 줄 배열/맵, props 는 블록 경로) */
  path: string[];
}

export const keyText = (k: string) => (k.length > 0 && !/[\s=;{}\[\]"|:.#@~()?,\\]/u.test(k) ? k : JSON.stringify(k));
export const dotted = (p: readonly Tok[]) => p.map(String).join(".");

/** 하위 시트의 부모 블록 번호 (없으면 -1). core 의 읽기와 같은 규칙: 앞선 시트 가운데 경로가 한 칸 짧은 것. */
export function parentBlock(schema: Schema, i: number): number {
  const b = schema.blocks[i];
  if (!b || b.kind !== "sheet" || b.path.length === 0) return -1;
  const pp = b.path.slice(0, -1);
  for (let j = i - 1; j >= 0; j--) {
    const o = schema.blocks[j]!;
    if (o.kind === "sheet" && samePath(o.path, pp)) return j;
  }
  return -1;
}

export function childBlocks(schema: Schema, i: number): number[] {
  const out: number[] = [];
  schema.blocks.forEach((_, j) => {
    if (parentBlock(schema, j) === i) out.push(j);
  });
  return out;
}

export function tabsOf(schema: Schema): Tab[] {
  const raw: Tab[] = [];
  schema.blocks.forEach((b, i) => {
    if (parentBlock(schema, i) >= 0) return;
    const name = b.kind === "sheet" ? (b.path.length ? b.path.join(".") : "(root)") : b.path.length ? `@props ${b.path.join(".")}` : "@props";
    raw.push({ block: i, name, kind: b.kind, path: b.path });
  });
  // 같은 이름이면 번호를 붙여 가른다
  const seen = new Map<string, number>();
  return raw.map((t) => {
    const n = (seen.get(t.name) ?? 0) + 1;
    seen.set(t.name, n);
    return n > 1 ? { ...t, name: `${t.name} (${n})` } : t;
  });
}

// ───────── 줄 타입 (열을 점 경로로 편 것을 다시 레코드로) ─────────

const rowTypes = new WeakMap<Schema, Map<number, Extract<T, { k: "rec" }>>>();
/** 줄 타입 → 블록 번호 (이 레코드 타입이 시트 줄의 것이다) */
const blockOfRec = new WeakMap<object, number>();

/** 블록 하나의 줄 레코드 타입: 열(점 경로는 중첩 레코드로) + 하위 시트 필드(`[줄 타입]`). */
export function rowType(schema: Schema, i: number): Extract<T, { k: "rec" }> {
  let per = rowTypes.get(schema);
  if (!per) rowTypes.set(schema, (per = new Map()));
  const hit = per.get(i);
  if (hit) return hit;
  const b = schema.blocks[i] as SheetBlock;
  const root: Extract<T, { k: "rec" }> = { k: "rec", fields: [] };
  for (const c of b.columns) {
    let cur = root;
    c.path.slice(0, -1).forEach((seg) => {
      let f = cur.fields.find((x) => x.name === seg);
      if (!f) cur.fields.push((f = { name: seg, type: { k: "rec", fields: [] }, optional: false }));
      cur = f.type as Extract<T, { k: "rec" }>;
    });
    cur.fields.push({ name: c.path[c.path.length - 1] ?? "", type: c.type, optional: c.optional });
  }
  for (const j of childBlocks(schema, i)) {
    const cb = schema.blocks[j] as SheetBlock;
    root.fields.push({ name: cb.path[cb.path.length - 1]!, type: { k: "list", of: rowType(schema, j) }, optional: !!cb.opt });
  }
  per.set(i, root);
  blockOfRec.set(root, i);
  return root;
}

/** 이 (낱) 타입이 시트 줄이면 그 블록 번호. */
export function blockOfRow(t: XT): number | undefined {
  return t.k === "rec" ? blockOfRec.get(t) : undefined;
}

// ───────── 자리 풀기 ─────────

export interface Resolved {
  /** 자리의 값 (없으면 undefined — 선택 칸이 비어 있는 경우) */
  value: unknown;
  /** 풀어 낸 타입 (이름 붙은 타입은 푼다) */
  type: XT;
  /** 탭·값 트리에서의 절대 경로 */
  path: Tok[];
  /** props 탭의 표 자체 (type 은 쓰지 않는다) */
  propsTable?: boolean;
}

/** 탭의 표(뿌리 자리)의 타입. props 탭은 표라서 타입이 없다 (any). */
function tabType(schema: Schema, b: Block, i: number): XT {
  if (b.kind === "props") return { k: "any" };
  return b.map !== undefined ? { k: "map", of: rowType(schema, i) } : { k: "list", of: rowType(schema, i) };
}

/** 자리 → 값·타입. 값 트리나 스키마가 바뀌어 풀리지 않으면 null. */
export function resolveLoc(root: unknown, schema: Schema, loc: Loc): Resolved | null {
  const b = schema.blocks[loc.tab];
  if (!b || parentBlock(schema, loc.tab) >= 0) return null;
  if (!startsWith(loc.path, b.path)) return null;
  if (b.kind === "props") {
    if (loc.path.length === b.path.length) return { value: undefined, type: { k: "any" }, path: [...loc.path], propsTable: true };
    const rel = loc.path.slice(b.path.length);
    // 점 하나(뿌리 값 전체)는 path [] 라서 어떤 rel 과도 맞는다 — 더 긴(구체적인) 항목을 먼저 고른다
    const best = b.entries.filter((x) => startsWith(rel, x.path)).sort((p, q) => q.path.length - p.path.length)[0];
    if (!best) return null;
    return walk(root, schema, [...b.path, ...best.path], best.type, loc.path);
  }
  return walk(root, schema, b.path, tabType(schema, b, loc.tab), loc.path);
}

function walk(root: unknown, schema: Schema, from: Tok[], t0: XT, to: Tok[]): Resolved | null {
  let t = deref(t0, schema);
  let v = getIn(root, from);
  for (const tok of to.slice(from.length)) {
    const nt = walkType(t, v, tok, schema);
    if (!nt) return null;
    v = getIn(v, [tok]);
    if (v === undefined && typeof tok === "number") return null; // 없는 줄 번호
    t = deref(nt, schema);
  }
  return { value: v, type: t, path: [...to] };
}

/** 점으로 이은 글 경로("items.2.drops")를 자리로. 탭 경로를 가장 길게 맞춘 뒤 나머지는 값 트리를 보고 번호·키로 읽는다. */
export function locFromText(root: unknown, schema: Schema, text: string): Loc | null {
  const segs = text.split(".").filter((s) => s !== "");
  const tabs = tabsOf(schema);
  let best: Tab | undefined;
  for (const t of tabs) {
    if (t.path.length <= segs.length && t.path.every((s, i) => s === segs[i]) && (!best || t.path.length > best.path.length)) best = t;
  }
  if (!best) return text === "" && tabs[0] ? { tab: tabs[0].block, path: [...tabs[0].path] } : null;
  const path: Tok[] = [...best.path];
  let v = getIn(root, path);
  for (const s of segs.slice(best.path.length)) {
    if (Array.isArray(v)) {
      const n = Number(s);
      if (!Number.isInteger(n)) return { tab: best.block, path };
      path.push(n);
    } else path.push(s);
    v = getIn(v, [path[path.length - 1]!]);
  }
  return { tab: best.block, path };
}

// 열·필드 목록 도우미
export const fieldsOf = (t: Extract<T, { k: "rec" }>): Field[] => t.fields;
export type { PropsBlock, SheetBlock };
