// 값 트리 + 스키마 → 화면에 그릴 표 (열·줄). 하위 시트는 값 트리를 따라 들어간 자리의 표로 그린다.
import { blockOfRow, dotted, parentBlock, resolveLoc, rowType, type Loc } from "./book.ts";
import { kindOf, summary, cellText, type Kind } from "./codec.ts";
import { deref, getIn, isObj, variantIndex } from "./tree.ts";
import { docOf, enumValues, type Field, type Schema, type SheetBlock, type T, type Tok, type XT } from "./types.ts";

export interface SCol {
  id: string;
  label: string;
  /** 줄 값 안의 경로 ([] = 줄 값 자체) */
  rel: Tok[];
  type: T;
  optional: boolean;
  doc?: string;
  /** 이름 끝에서 읽은 단위 (ms·bp·% …) */
  unit?: string | null;
  /** key: 맵의 키 열 · variant: 합 타입 변형 고르기 · field: 필드 이름(보기만) · value: 줄마다 타입이 다른 값 열 */
  role?: "key" | "variant" | "field" | "value";
}

export interface SRow {
  /** 화면 안에서 안 겹치는 열쇠 */
  id: string;
  /** 줄 값의 절대 경로 */
  path: Tok[];
  label: string;
  value: unknown;
  /** kv·props 줄의 값 타입 */
  type?: XT;
  optional?: boolean;
  /** 맵 줄의 키 */
  mapKey?: string;
  /** 이 줄의 합 타입 변형 (번호) */
  variant?: number;
  /** props 줄의 이름·설명 */
  doc?: string;
}

export type ModelKind = "table" | "map" | "list" | "kv" | "props";

export interface SheetModel {
  kind: ModelKind;
  loc: Loc;
  cols: SCol[];
  rows: SRow[];
  /** 줄을 더하고 지울 수 있는가 (표·맵·목록) */
  addable: boolean;
  /** 새 줄의 타입 (표·목록) */
  elem?: XT;
  /** 시트 블록의 줄이면 그 블록 번호 */
  block?: number;
  /** 줄 키 열 (key=) */
  keyCol?: string;
  /** 합 타입 줄의 변형들 (첫 키 이름) */
  variants?: string[];
  /** 이 표의 identity — 바뀌면 선택·정렬을 처음으로 */
  key: string;
  /** 이 표의 줄 이름 (탭 이름 · 빵부스러기) */
  title: string;
}

/** 칸 이름 끝의 단위. 소문자 단위는 이름 전체이거나 _ . 뒤에서만, 대문자 시작은 낙타 이름 끝. */
export function unitOf(name: string): string | null {
  const m = /(?:^|[_.])(ms|bp|pct|ppm|permille)$|(?<=[a-z0-9])(Ms|Bp|Pct|Ppm|Permille)$/.exec(name);
  if (!m) return null;
  const u = (m[1] ?? m[2])!.toLowerCase();
  return u === "ms" ? "ms" : u === "bp" ? "bp" : u === "pct" ? "%" : u === "ppm" ? "ppm" : "‰";
}

const idOf = (p: readonly Tok[]) => p.join("\u0001");

const docFor = (schema: Schema, sheet: readonly Tok[], col: string) => docOf(schema, sheet, col);

function colOfField(schema: Schema, f: Field, rel: Tok[], sheet?: readonly Tok[]): SCol {
  const label = rel.join(".");
  return { id: idOf(rel), label, rel, type: f.type, optional: f.optional, unit: unitOf(String(rel[rel.length - 1] ?? "")), doc: sheet ? docFor(schema, sheet, label) : undefined };
}

/** 줄 값의 한 줄 이름: 키 열 → 글 열 → "row N". */
export function rowLabel(value: unknown, i: number, cols: SCol[], keyCol?: string, mapKey?: string): string {
  if (mapKey !== undefined) return mapKey;
  if (isObj(value)) {
    if (keyCol !== undefined && value[keyCol] !== undefined && value[keyCol] !== null) return String(value[keyCol]);
    for (const c of cols) {
      if (c.type.k === "str" && c.rel.length === 1) {
        const v = value[String(c.rel[0])];
        if (typeof v === "string" && v !== "") return v.length > 24 ? v.slice(0, 24) + "…" : v;
      }
    }
  } else if (typeof value === "string" || typeof value === "number") return String(value);
  return `row ${i + 1}`;
}

/** 자리 → 표. 풀리지 않거나 들어갈 표가 아닌 값이면 null. */
export function buildModel(root: unknown, schema: Schema, loc: Loc): SheetModel | null {
  const r = resolveLoc(root, schema, loc);
  if (!r) return null;
  const b = schema.blocks[loc.tab]!;
  const key = JSON.stringify([loc.tab, loc.path]);
  const mk = (m: Omit<SheetModel, "loc" | "key" | "title">): SheetModel => ({ ...m, loc, key, title: m.kind === "props" ? "@props" : "" });

  if (r.propsTable && b.kind === "props") {
    const rows: SRow[] = b.entries.map((e, i) => {
      const p = [...b.path, ...e.path];
      return { id: String(i), path: p, label: e.path.length ? e.path.join(".") : "(root)", value: getIn(root, p), type: deref(e.type, schema), optional: false, doc: docFor(schema, b.path, e.path.join(".")) };
    });
    const cols: SCol[] = [
      { id: "@field", label: "Key", rel: [], type: { k: "str" }, optional: false, role: "field" },
      { id: "@value", label: "Value", rel: [], type: { k: "any" }, optional: false, role: "value" },
    ];
    return mk({ kind: "props", cols, rows, addable: false });
  }

  const t = r.type;
  const v = r.value;
  const blockCols = (bi: number): { cols: SCol[]; keyCol?: string; sheet: Tok[] } => {
    const sb = schema.blocks[bi] as SheetBlock;
    const cols = sb.columns.map((c) => colOfField(schema, { name: "", type: c.type, optional: c.optional }, c.path, sb.path));
    const rt = rowType(schema, bi);
    // 하위 시트 필드는 칸 하나 ([줄] 목록)
    for (const f of rt.fields) {
      if (sb.columns.some((c) => c.path[0] === f.name)) continue;
      cols.push({ id: idOf([f.name]), label: f.name, rel: [f.name], type: f.type, optional: f.optional });
    }
    return { cols, keyCol: sb.key, sheet: sb.path };
  };

  if (t.k === "map") {
    const bi = blockOfRow(t.of)!;
    const { cols, keyCol } = blockCols(bi);
    const sb = schema.blocks[bi] as SheetBlock;
    const keyHead: SCol = { id: "@key", label: sb.map ?? "key", rel: [], type: { k: "str" }, optional: false, role: "key" };
    const obj = isObj(v) ? v : {};
    const all = [keyHead, ...cols];
    const rows: SRow[] = Object.keys(obj).map((k, i) => ({ id: k, path: [...r.path, k], label: rowLabel(obj[k], i, cols, keyCol, k), value: obj[k], mapKey: k }));
    return mk({ kind: "map", cols: all, rows, addable: true, elem: t.of, block: bi, keyCol });
  }

  if (t.k === "list" || (t.k === "any" && Array.isArray(v))) {
    const arr = Array.isArray(v) ? v : [];
    const of = t.k === "list" ? deref(t.of, schema) : ({ k: "any" } as T);
    const mkRows = (cols: SCol[], keyCol?: string, variantsOf?: (x: unknown) => number): SRow[] =>
      arr.map((x, i) => ({ id: String(i), path: [...r.path, i], label: rowLabel(x, i, cols, keyCol), value: x, variant: variantsOf?.(x) }));
    const bi = blockOfRow(of);
    if (bi !== undefined) {
      const { cols, keyCol } = blockCols(bi);
      return mk({ kind: "table", cols, rows: mkRows(cols, keyCol), addable: true, elem: of, block: bi, keyCol });
    }
    if (of.k === "rec") {
      const cols = of.fields.map((f) => colOfField(schema, f, [f.name]));
      return mk({ kind: "table", cols, rows: mkRows(cols), addable: true, elem: t.k === "list" ? t.of : of });
    }
    if (of.k === "sum") {
      const names = of.variants.map((vt) => vt[0]?.name ?? "");
      const seen = new Map<string, Field>();
      for (const vt of of.variants) for (const f of vt) if (!seen.has(f.name)) seen.set(f.name, f);
      const cols: SCol[] = [{ id: "@variant", label: "kind", rel: [], type: { k: "str" }, optional: false, role: "variant" }];
      for (const f of seen.values()) cols.push(colOfField(schema, f, [f.name]));
      return mk({ kind: "table", cols, rows: mkRows(cols, undefined, (x) => variantIndex(of, x)), addable: true, elem: t.k === "list" ? t.of : of, variants: names });
    }
    const col: SCol = { id: "@value", label: "value", rel: [], type: of.k === "map" ? { k: "any" } : of, optional: false, role: "value" };
    return mk({ kind: "list", cols: [col], rows: mkRows([col]), addable: true, elem: t.k === "list" ? t.of : of });
  }

  // 한 레코드·합 타입 값·any 객체: 필드 / 값 줄
  const kvCols: SCol[] = [
    { id: "@field", label: "Field", rel: [], type: { k: "str" }, optional: false, role: "field" },
    { id: "@value", label: "Value", rel: [], type: { k: "any" }, optional: false, role: "value" },
  ];
  const obj = isObj(v) ? v : {};
  if (t.k === "rec") {
    const rows: SRow[] = t.fields.map((f) => ({ id: f.name, path: [...r.path, f.name], label: f.name, value: obj[f.name], type: f.type, optional: f.optional, doc: undefined }));
    return mk({ kind: "kv", cols: kvCols, rows, addable: false });
  }
  if (t.k === "sum") {
    const vi = variantIndex(t, v);
    const names = t.variants.map((vt) => vt[0]?.name ?? "");
    const head: SRow = { id: "@variant", path: [...r.path], label: "(kind)", value: v, type: { k: "str" }, optional: false, variant: vi };
    const fields = t.variants[vi] ?? [];
    const rows = [head, ...fields.map((f): SRow => ({ id: f.name, path: [...r.path, f.name], label: f.name, value: obj[f.name], type: f.type, optional: f.optional }))];
    return mk({ kind: "kv", cols: kvCols, rows, addable: false, variants: names, elem: t });
  }
  if (t.k === "any" && isObj(v)) {
    const rows: SRow[] = Object.keys(obj).map((k) => ({ id: k, path: [...r.path, k], label: k, value: obj[k], type: { k: "any" }, optional: false }));
    return mk({ kind: "kv", cols: kvCols, rows, addable: false });
  }
  return null;
}

// ───────── 칸 하나의 모양 ─────────

export interface CellSpec {
  t: XT;
  optional: boolean;
  kind: Kind;
  ro: boolean;
  /** enum 고르기 후보 (변형 고르기 포함) */
  options?: string[];
  /** ref 종류 (고르기 창) */
  refKind?: string;
  /** 목록 칸 (체크 여럿) */
  multi?: boolean;
}

/** 줄·열이 만나는 칸의 타입·종류. 그 줄에는 없는 칸(합 타입의 다른 변형 필드)이면 null. */
export function cellSpec(model: SheetModel, row: SRow, col: SCol, schema: Schema, refOk: (kind: string) => boolean): CellSpec | null {
  if (col.role === "field") return { t: { k: "str" }, optional: false, kind: "text", ro: true };
  if (col.role === "key") return { t: { k: "str" }, optional: false, kind: "text", ro: false };
  if (col.role === "variant" || (col.role === "value" && row.id === "@variant")) return { t: { k: "str" }, optional: false, kind: "enum", ro: false, options: model.variants };
  let t: XT = col.type;
  let optional = col.optional;
  if (col.role === "value" && row.type) {
    t = row.type;
    optional = !!row.optional;
  } else if (row.variant !== undefined && model.variants) {
    // 합 타입 줄: 이 줄의 변형에 있는 필드만
    const sumT = model.elem ? deref(model.elem, schema) : undefined;
    const f = sumT?.k === "sum" ? sumT.variants[row.variant]?.find((x) => x.name === col.rel[0]) : undefined;
    if (!f) return null;
    t = f.type;
    optional = f.optional;
  }
  const kind = kindOf(t, row.value === undefined ? undefined : getIn(row.value, col.role === "value" ? [] : col.rel), schema, refOk);
  const d = deref(t, schema);
  const spec: CellSpec = { t, optional, kind, ro: false };
  if (kind === "enum" && d.k === "enum") spec.options = enumValues(schema, d.name);
  if (kind === "ref" && d.k === "ref") spec.refKind = d.name;
  if (kind === "reflist" && d.k === "list") {
    const o = deref(d.of, schema);
    spec.multi = true;
    if (o.k === "ref") spec.refKind = o.name;
    else if (o.k === "enum") spec.options = enumValues(schema, o.name);
  }
  return spec;
}

/** 칸의 값: 줄 값 안의 rel 자리 (value 열은 줄 값 자체). */
export function cellValue(row: SRow, col: SCol): unknown {
  if (col.role === "key") return row.mapKey;
  if (col.role === "field") return row.label;
  if (col.role === "variant" || row.id === "@variant") return undefined; // 변형 이름은 모델의 variants[row.variant]
  return col.role === "value" ? row.value : getIn(row.value, col.rel);
}

/** 칸 글(복사·찾기). */
export function textOfCell(model: SheetModel, row: SRow, col: SCol, schema: Schema, refOk: (k: string) => boolean): string {
  const spec = cellSpec(model, row, col, schema, refOk);
  if (!spec) return "";
  if (col.role === "key") return row.mapKey ?? "";
  if (col.role === "field") return row.label;
  if (spec.options && (col.role === "variant" || row.id === "@variant")) return model.variants?.[row.variant ?? -1] ?? "";
  return cellText(spec.t, cellValue(row, col), spec.optional, schema);
}

/** 칸에 보이는 글 (요약). */
export function shownOfCell(model: SheetModel, row: SRow, col: SCol, schema: Schema, refOk: (k: string) => boolean): string {
  const spec = cellSpec(model, row, col, schema, refOk);
  if (!spec) return "";
  if (col.role === "key") return row.mapKey ?? "";
  if (col.role === "field") return row.label;
  if (col.role === "variant" || row.id === "@variant") return model.variants?.[row.variant ?? -1] ?? "?";
  return summary(spec.t, cellValue(row, col), spec.optional, schema);
}

export { dotted, parentBlock };
