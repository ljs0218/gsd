// 칸 글 ↔ 값. 낱값(수·참거짓·글)은 여기서 읽고, 목록·레코드·합 타입·any 는 core 의 읽기/쓰기를 작은 문서로 빌려 쓴다
// (`@type` 줄들 + `@props` 한 줄) — 칸 문법을 두 군데 구현하지 않으려고. core 가 칸 단위 API 를 내면 이 파일만 바꾼다.
import { GsdError, parseGsd, quoteStr, typeText, writeGsd } from "@gsd/core";
import type { Schema, T, XT } from "./types.ts";
import { deref, isObj } from "./tree.ts";
import { enumValues } from "./types.ts";

export type Parse = { ok: true; value: unknown } | { ok: false; why: string };

const INT_RE = /^-?(0|[1-9]\d*)$/;
const NUM_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/** 글 하나를 따옴표로 쓰는 게 나은가 (정규 출력의 맨글 규칙 중 칸 하나에 해당하는 것). */
export function needsQuote(s: string): boolean {
  return s === "" || s === "~" || /^[\s]|[\s]$/.test(s) || s.startsWith('"') || /[\u0000-\u001f\u007f]/.test(s);
}

const prefixes = new WeakMap<Schema, string>();
const typeLines = (schema: Schema): string => {
  let p = prefixes.get(schema);
  if (p === undefined) {
    p = writeGsd({}, { types: schema.types, enums: new Map(), refs: new Map(), docs: [], blocks: [] });
    prefixes.set(schema, p);
  }
  return p;
};

const cut = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return e instanceof GsdError ? (m.split(" — ").slice(1).join(" — ") || m) : m;
};

/** 타입 t 의 칸 글을 core 의 읽기로 읽는다. */
function parseTyped(text: string, t: T, schema: Schema): Parse {
  if (/[\r\n]/.test(text)) return { ok: false, why: "line breaks are not allowed in a cell (use \\n inside quotes)" };
  try {
    const doc = `${typeLines(schema)}\n@props\nx: ${typeText(t)} = ${text}\n`;
    const v = parseGsd(doc).value as Record<string, unknown>;
    return { ok: true, value: v["x"] };
  } catch (e) {
    return { ok: false, why: cut(e) };
  }
}

const serCache = new Map<string, string>();
/** 타입 t 의 값을 칸 글로 (core 쓰기). 못 쓰면 null. */
function serTyped(v: unknown, t: T, schema: Schema): string | null {
  const key = `${typeText(t)}\u0000${JSON.stringify(v)}`;
  const hit = serCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const out = writeGsd({ x: v }, { types: schema.types, enums: new Map(), refs: new Map(), docs: [], blocks: [{ kind: "props", path: [], entries: [{ path: ["x"], type: t, optional: false }] }] });
    const head = `x: ${typeText(t)} = `;
    const line = out.split("\n").find((l) => l.startsWith(head));
    if (line === undefined) return null;
    const s = line.slice(head.length);
    if (serCache.size > 3000) serCache.clear();
    serCache.set(key, s);
    return s;
  } catch {
    return null;
  }
}

/** 칸을 글로 고치는 열인가, 따로 고르는/들어가는 열인가. */
export type Kind = "bool" | "text" | "num" | "enum" | "ref" | "reflist" | "drill";

export interface CellType {
  t: XT;
  optional: boolean;
}

/** 칸의 종류. refs/enums 의 유무는 호출하는 쪽이 정한다 (refOk: 이 ref 종류의 후보를 풀 수 있다). */
export function kindOf(t0: XT, v: unknown, schema: Schema, refOk: (kind: string) => boolean): Kind {
  const t = deref(t0, schema);
  switch (t.k) {
    case "bool":
      return "bool";
    case "int":
    case "num":
      return "num";
    case "enum":
      return enumValues(schema, t.name) ? "enum" : "text";
    case "ref":
      return refOk(t.name) ? "ref" : "text";
    case "list": {
      const o = deref(t.of, schema);
      if ((o.k === "ref" && refOk(o.name)) || (o.k === "enum" && enumValues(schema, o.name))) return "reflist";
      return "drill";
    }
    case "rec":
    case "sum":
      return "drill";
    case "any":
      return Array.isArray(v) || isObj(v) ? "drill" : "text";
    case "map":
      return "drill";
    default:
      return "text";
  }
}

/** 칸 글 전체 (복사·찾기·고치기 상자의 처음 글). 값이 없으면 "". */
export function cellText(t0: XT, v: unknown, optional: boolean, schema: Schema): string {
  if (v === undefined) return "";
  if (v === null) return "~";
  const t = deref(t0, schema);
  switch (t.k) {
    case "str":
    case "enum":
    case "ref":
      return typeof v === "string" ? (needsQuote(v) && (v !== "" || optional) ? quoteStr(v) : v) : String(v);
    case "int":
    case "num":
    case "bool":
      return String(v);
    case "map":
      return JSON.stringify(v);
    default:
      return serTyped(v, t0 as T, schema) ?? JSON.stringify(v);
  }
}

/** 칸에 보이는 줄인 글: 목록·레코드는 요약, 나머지는 칸 글. 합 타입은 짧은 쓰기가 짧으면 그대로. */
export function summary(t0: XT, v: unknown, optional: boolean, schema: Schema): string {
  const t = deref(t0, schema);
  if (v === undefined) return "";
  if (v === null) return "~";
  if (t.k === "list" || (t.k === "any" && Array.isArray(v))) return `[${(v as unknown[]).length}] ▸`;
  if (t.k === "rec" || (t.k === "any" && isObj(v))) return `{${Object.keys(v as object).length}} ▸`;
  if (t.k === "sum") {
    const s = serTyped(v, t0 as T, schema);
    if (s !== null && s.length <= 60 && !s.startsWith("{")) return s;
    const first = isObj(v) ? Object.keys(v)[0] : undefined;
    return `${first ?? "?"} … ▸`;
  }
  if (t.k === "str" && typeof v === "string" && v === "" && optional) return '""';
  return cellText(t, v, optional, schema);
}

/** 칸 글 → 값. 빈 칸은 선택 열이면 "키 없음"(undefined), 아니면 그 타입의 빈 글/오류. */
export function parseCell(text: string, t0: XT, optional: boolean, schema: Schema): Parse {
  const t = deref(t0, schema);
  const s = text.trim();
  if (s === "" && t.k !== "str" && t.k !== "enum" && t.k !== "ref") {
    return optional ? { ok: true, value: undefined } : { ok: false, why: "this cell is required" };
  }
  if (s === "~") return { ok: true, value: null };
  switch (t.k) {
    case "int":
      if (!INT_RE.test(s)) return { ok: false, why: "not an integer" };
      return Number.isSafeInteger(Number(s)) ? { ok: true, value: Number(s) } : { ok: false, why: "integer out of the safe range" };
    case "num":
      return NUM_RE.test(s) && Number.isFinite(Number(s)) ? { ok: true, value: Number(s) } : { ok: false, why: "not a number" };
    case "bool": {
      const l = s.toLowerCase();
      return l === "true" || l === "false" ? { ok: true, value: l === "true" } : { ok: false, why: "use true or false" };
    }
    case "str":
    case "enum":
    case "ref": {
      let v = text;
      if (text.startsWith('"')) {
        const q = parseTyped(text.trim(), { k: "str" }, schema);
        if (q.ok) v = q.value as string;
      }
      if (v === "" && optional && !text.trim().startsWith('"')) return { ok: true, value: undefined };
      if (t.k === "enum") {
        const opts = enumValues(schema, t.name);
        if (opts && !opts.includes(v)) return { ok: false, why: `not one of: ${opts.slice(0, 6).join(", ")}${opts.length > 6 ? ", …" : ""}` };
      }
      return { ok: true, value: v };
    }
    case "map":
      return { ok: false, why: "cannot edit this cell as text" };
    default:
      return parseTyped(s, t0 as T, schema); // 합 타입은 이름 붙은 채로 (core 는 합 타입을 @type 맨 위에서만 읽는다)
  }
}

// ───────── 새 값의 기본 ─────────

/** 타입의 기본 값 (새 줄의 필수 열 채우기). */
export function defaultOf(t0: XT, schema: Schema, depth = 0): unknown {
  const t = deref(t0, schema);
  switch (t.k) {
    case "int":
    case "num":
      return 0;
    case "bool":
      return false;
    case "str":
    case "ref":
      return "";
    case "enum":
      return enumValues(schema, t.name)?.[0] ?? "";
    case "list":
      return [];
    case "rec":
      return recDefault(t.fields, schema, depth);
    case "sum":
      return depth > 8 || !t.variants[0] ? {} : recDefault(t.variants[0], schema, depth);
    case "map":
      return {};
    default:
      return null;
  }
}

export function recDefault(fields: { name: string; type: T; optional: boolean }[], schema: Schema, depth = 0): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (depth > 8) return o;
  for (const f of fields) if (!f.optional) o[f.name] = defaultOf(f.type, schema, depth + 1);
  return o;
}
