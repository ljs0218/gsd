// 고치기: 모델 + 칸 글/값 → 값 트리에 적용할 Edit 들. 값 트리를 직접 만지지 않고 (경로, 새 값) 쌍으로만 말한다.
import { writeGsd } from "@gsd/core";
import { blockOfRow, parentBlock } from "./book.ts";
import { defaultOf, parseCell, recDefault } from "./codec.ts";
import { clone, deref, getIn, isObj, setIn } from "./tree.ts";
import type { Schema, SheetBlock, T, Tok } from "./types.ts";
import { cellSpec, cellValue, type CellSpec, type SCol, type SRow, type SheetModel } from "./view.ts";

/** 경로의 값을 새 값으로 (undefined = 키 지움). */
export interface Edit {
  path: Tok[];
  value: unknown;
}

export const applyEdits = (root: unknown, edits: Edit[]): unknown => edits.reduce((r, e) => setIn(r, e.path, e.value), root);

export type Planned = { ok: true; edits: Edit[] } | { ok: false; why: string };
const fail = (why: string): Planned => ({ ok: false, why });

/** 변형을 바꾼 새 값: 같은 이름·같은 타입 필드는 이어받고 나머지는 기본값. */
function switchVariant(sumT: Extract<T, { k: "sum" }>, old: unknown, to: number, schema: Schema): unknown {
  const fields = sumT.variants[to] ?? [];
  const fresh = recDefault(fields, schema);
  if (isObj(old)) for (const f of fields) if (f.name in old && typeof old[f.name] === typeof fresh[f.name]) fresh[f.name] = old[f.name];
  return fresh;
}

/** 칸 하나에 글을 쓴다 (고치기 상자·붙여넣기·고르기 공용). */
export function planCellText(model: SheetModel, row: SRow, col: SCol, text: string, schema: Schema, refOk: (k: string) => boolean): Planned {
  const spec = cellSpec(model, row, col, schema, refOk);
  if (!spec) return fail("this cell does not apply to the row");
  if (spec.ro) return fail("read-only cell");
  if (col.role === "key") return planRenameKey(model, row, text);
  if (col.role === "variant" || row.id === "@variant") return planVariant(model, row, text, schema);
  const p = parseCell(text, spec.t, spec.optional, schema);
  if (!p.ok) return fail(p.why);
  return planCellValue(row, col, spec, p.value);
}

/** 칸 하나에 값을 쓴다 (체크·고르기 창의 결과). */
export function planCellValue(row: SRow, col: SCol, spec: CellSpec, value: unknown): Planned {
  if (value === undefined && !spec.optional) return fail("this cell is required");
  const path = col.role === "value" ? row.path : [...row.path, ...col.rel];
  return { ok: true, edits: [{ path, value }] };
}

function planRenameKey(model: SheetModel, row: SRow, text: string): Planned {
  const to = text.trim() === "" && text === "" ? "" : text;
  if (to === "") return fail("the key cannot be empty");
  if (row.mapKey === undefined || to === row.mapKey) return { ok: true, edits: [] };
  const cur = model.rows.map((r) => r.mapKey!);
  if (cur.includes(to)) return fail(`'${to}' already exists`);
  // 키 차례를 지키며 이름만 바꾼다
  const container = row.path.slice(0, -1);
  const obj: Record<string, unknown> = {};
  for (const r of model.rows) obj[r.mapKey === row.mapKey ? to : r.mapKey!] = r.value;
  return { ok: true, edits: [{ path: container, value: obj }] };
}

function planVariant(model: SheetModel, row: SRow, name: string, schema: Schema): Planned {
  const names = model.variants ?? [];
  const to = names.indexOf(name);
  if (to < 0) return fail(`not one of: ${names.join(", ")}`);
  if (to === row.variant) return { ok: true, edits: [] };
  const sumT = sumOf(model, row, schema);
  if (!sumT) return fail("not a sum type");
  return { ok: true, edits: [{ path: row.path, value: switchVariant(sumT, row.value, to, schema) }] };
}

function sumOf(model: SheetModel, row: SRow, schema: Schema): Extract<T, { k: "sum" }> | undefined {
  // 표: 모델의 줄 타입 / kv: 줄이 합 타입 값 자신 (@variant 줄)
  const t = model.elem ? deref(model.elem, schema) : undefined;
  if (t?.k === "sum") return t;
  return undefined;
}

// ───────── 줄 더하기·복제·지우기 ─────────

const freshName = (taken: Iterable<string>, base: string) => {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}${i}`)) return `${base}${i}`;
};

/** 시트 블록 줄의 기본 값: 필수 열은 기본값, 하위 시트 필드는 [], 키 열은 안 겹치는 새 키. */
function newElement(model: SheetModel, schema: Schema, key?: string): unknown {
  const e = model.elem ? deref(model.elem, schema) : ({ k: "any" } as T);
  let v: unknown = e.k === "rec" ? recDefault(e.fields, schema) : defaultOf(e, schema);
  if (model.keyCol && isObj(v)) {
    const kc = model.cols.find((c) => c.rel.length === 1 && c.rel[0] === model.keyCol);
    const taken = model.rows.map((r) => String(getIn(r.value, [model.keyCol!])));
    const val = key ?? (kc?.type.k === "int" ? String(Math.max(-1, ...taken.map(Number).filter(Number.isFinite)) + 1) : freshName(taken, "new"));
    v = { ...v, [model.keyCol]: kc?.type.k === "int" ? Number(val) : val };
  }
  return v;
}

/** at 번째 앞에 새 줄 (undefined = 끝). 맵은 새 키를 끝에. */
export function planAddRow(model: SheetModel, schema: Schema, at?: number): Planned {
  if (!model.addable) return fail("rows cannot be added here");
  const c = model.loc.path;
  if (model.kind === "map") {
    const k = freshName(model.rows.map((r) => r.mapKey!), "new");
    const obj: Record<string, unknown> = {};
    for (const r of model.rows) obj[r.mapKey!] = r.value;
    obj[k] = newElement(model, schema);
    return { ok: true, edits: [{ path: c, value: obj }] };
  }
  const arr = model.rows.map((r) => r.value);
  const i = at === undefined ? arr.length : Math.max(0, Math.min(arr.length, at));
  arr.splice(i, 0, newElement(model, schema));
  return { ok: true, edits: [{ path: c, value: arr }] };
}

/** 줄 복제: 바로 아래에. 키 열·맵 키는 안 겹치게 새로. */
export function planDuplicate(model: SheetModel, schema: Schema, row: SRow): Planned {
  if (!model.addable) return fail("rows cannot be added here");
  const copy = clone(row.value);
  const c = model.loc.path;
  if (model.kind === "map") {
    const k = freshName(model.rows.map((r) => r.mapKey!), `${row.mapKey}_copy`);
    const obj: Record<string, unknown> = {};
    for (const r of model.rows) {
      obj[r.mapKey!] = r.value;
      if (r === row) obj[k] = copy;
    }
    return { ok: true, edits: [{ path: c, value: obj }] };
  }
  if (model.keyCol && isObj(copy)) {
    const old = String(copy[model.keyCol]);
    const kc = model.cols.find((x) => x.rel.length === 1 && x.rel[0] === model.keyCol);
    const taken = model.rows.map((r) => String(getIn(r.value, [model.keyCol!])));
    copy[model.keyCol] = kc?.type.k === "int" ? Math.max(...taken.map(Number)) + 1 : freshName(taken, `${old}_copy`);
  }
  const arr = model.rows.map((r) => r.value);
  arr.splice(model.rows.indexOf(row) + 1, 0, copy);
  return { ok: true, edits: [{ path: c, value: arr }] };
}

export function planDelete(model: SheetModel, rows: SRow[]): Planned {
  if (!model.addable) return fail("rows cannot be removed here");
  const gone = new Set(rows);
  const c = model.loc.path;
  if (model.kind === "map") {
    const obj: Record<string, unknown> = {};
    for (const r of model.rows) if (!gone.has(r)) obj[r.mapKey!] = r.value;
    return { ok: true, edits: [{ path: c, value: obj }] };
  }
  return { ok: true, edits: [{ path: c, value: model.rows.filter((r) => !gone.has(r)).map((r) => r.value) }] };
}

// ───────── 적용 전 검사·글 만들기 ─────────

/** 줄 키(key=) 가 비거나 겹치면 첫 문제를 글로. 하위 시트는 부모 줄마다 따로 본다. */
export function keyProblem(root: unknown, schema: Schema): string | null {
  const check = (bi: number, rows: unknown[], where: string): string | null => {
    const b = schema.blocks[bi] as SheetBlock;
    if (b.key === undefined) return null;
    const seen = new Set<string>();
    for (const r of rows) {
      const k = getIn(r, [b.key]);
      if (k === undefined || k === null || k === "") return `${where}: the key column '${b.key}' is empty`;
      if (seen.has(String(k))) return `${where}: duplicate key '${String(k)}'`;
      seen.add(String(k));
    }
    return null;
  };
  const visit = (bi: number, rows: unknown[], where: string): string | null => {
    const e = check(bi, rows, where);
    if (e) return e;
    for (let j = 0; j < schema.blocks.length; j++) {
      if (parentBlock(schema, j) !== bi) continue;
      const f = (schema.blocks[j] as SheetBlock).path.slice(-1)[0]!;
      for (const [i, r] of rows.entries()) {
        const sub = getIn(r, [f]);
        if (Array.isArray(sub)) {
          const ee = visit(j, sub, `${where}[${i}].${f}`);
          if (ee) return ee;
        }
      }
    }
    return null;
  };
  for (let i = 0; i < schema.blocks.length; i++) {
    const b = schema.blocks[i]!;
    if (b.kind !== "sheet" || parentBlock(schema, i) >= 0 || b.map !== undefined) continue;
    const rows = getIn(root, b.path);
    const e = Array.isArray(rows) ? visit(i, rows, b.path.join(".") || "(root)") : null;
    if (e) return e;
  }
  return null;
}

export type Commit = { ok: true; value: unknown; text: string } | { ok: false; why: string };

/** Edit 들을 적용하고 키 검사 + 정규 출력까지. 쓸 수 없는 값이면 까닭을 돌려준다. */
export function commit(root: unknown, schema: Schema, edits: Edit[]): Commit {
  const value = applyEdits(root, edits);
  const kp = keyProblem(value, schema);
  if (kp) return { ok: false, why: kp };
  try {
    return { ok: true, value, text: writeGsd(value, schema) };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}

export { blockOfRow, cellValue };
