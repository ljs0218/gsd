// 값 트리 읽기·불변 고치기, 타입 걷기. 화면 없이 도는 순수 함수.
import type { Schema, T, Tok, XT } from "./types.ts";

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function setKey(o: Record<string, unknown>, k: string, v: unknown) {
  if (k === "__proto__") Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  else o[k] = v;
}

export function getIn(v: unknown, path: readonly Tok[]): unknown {
  let cur = v;
  for (const t of path) {
    if (Array.isArray(cur)) cur = typeof t === "number" ? cur[t] : undefined;
    else if (isObj(cur) && has(cur, String(t))) cur = cur[String(t)];
    else return undefined;
  }
  return cur;
}

/** 경로의 값을 바꾼 새 트리 (바뀐 가지만 복사). value 가 undefined 면 키를 지운다 (배열 원소는 못 지운다). */
export function setIn(root: unknown, path: readonly Tok[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [Tok, ...Tok[]];
  if (Array.isArray(root)) {
    if (typeof head !== "number") throw new Error(`배열에 키 ${head} 를 쓸 수 없다`);
    const out = root.slice();
    out[head] = rest.length ? setIn(root[head], rest, value) : value;
    return out;
  }
  const o: Record<string, unknown> = isObj(root) ? { ...root } : {};
  const k = String(head);
  if (rest.length === 0 && value === undefined) {
    delete o[k];
    return o;
  }
  setKey(o, k, rest.length ? setIn(isObj(root) ? root[k] : undefined, rest, value) : value);
  return o;
}

export const clone = <V>(v: V): V => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as V));

export const samePath = (a: readonly Tok[], b: readonly Tok[]) => a.length === b.length && a.every((t, i) => t === b[i]);
export const startsWith = (p: readonly Tok[], pre: readonly Tok[]) => pre.length <= p.length && pre.every((t, i) => t === p[i]);

// ───────── 타입 ─────────

/** 이름 붙은 타입을 풀어 낱 타입으로. 순환 정의는 any. */
export function deref(t: XT, schema: Schema): XT {
  let cur = t;
  for (let n = 0; n < 32 && cur.k === "named"; n++) {
    const d = schema.types.get(cur.name);
    if (!d) return { k: "any" };
    cur = d;
  }
  return cur.k === "named" ? { k: "any" } : cur;
}

/** 합 타입에서 값이 가리키는 변형 번호 (첫 키로 가린다). 없으면 -1. */
export function variantIndex(t: Extract<T, { k: "sum" }>, value: unknown): number {
  if (!isObj(value)) return -1;
  return t.variants.findIndex((v) => v[0] && has(value, v[0].name));
}

/** 타입 t 의 값 v 안의 tok 자리의 타입. 못 걸으면 undefined. */
export function walkType(t: XT, v: unknown, tok: Tok, schema: Schema): XT | undefined {
  const d = deref(t, schema);
  switch (d.k) {
    case "list":
      return typeof tok === "number" ? d.of : undefined;
    case "map":
      return typeof tok === "string" ? d.of : undefined;
    case "rec":
      return d.fields.find((f) => f.name === String(tok))?.type;
    case "sum": {
      const vi = variantIndex(d, v);
      return d.variants[vi]?.find((f) => f.name === String(tok))?.type;
    }
    case "any":
      return { k: "any" };
    default:
      return undefined;
  }
}

/** 값 하나를 한 줄 글로 줄여 본 모양 — 합 타입 요약 등에 쓰기 전 거르기용. */
export function isScalarT(t: T): boolean {
  return t.k === "int" || t.k === "num" || t.k === "str" || t.k === "bool" || t.k === "enum" || t.k === "ref";
}
