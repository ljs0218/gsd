// GSD 읽기·쓰기·스키마 추정. 명세는 SPEC.md — 이 파일은 그 명세의 TS 구현이다.
// 읽으면 JSON 과 같은 트리(객체·배열·글·수·참거짓·null)가 나오고, 쓰기는 늘 같은 정규 출력이다.
// 게임 코드를 import 하지 않는다 (나중에 따로 떼어 낼 수 있게).

// ───────── 타입 모델 ─────────

export type T =
  | { k: "int" | "num" | "str" | "bool" | "any" }
  | { k: "enum" | "ref"; name: string }
  | { k: "list"; of: T }
  | { k: "rec"; fields: Field[] }
  | { k: "named"; name: string }
  | { k: "sum"; variants: Field[][] }; // @type 정의의 맨 위에서만

export interface Field {
  name: string;
  type: T;
  optional: boolean;
}

/** 시트의 열 / props 의 항목. path 는 점 경로 조각 (props 항목은 [] = 뿌리). */
export interface Column {
  path: string[];
  type: T;
  optional: boolean;
}

export interface PropsBlock {
  kind: "props";
  /** 이 블록 바로 위의 `#` 주석 줄 (정규 출력이 그대로 다시 쓴다; 블록 안쪽 주석은 버린다) */
  comments?: string[];
  path: string[];
  entries: Column[];
}

export interface SheetBlock {
  kind: "sheet";
  comments?: string[];
  path: string[];
  /** 하위 시트가 부모 줄을 가리킬 때 쓰는 키 열 이름 */
  key?: string;
  /** map 시트면 키 열의 이름 (첫 열, 레코드에는 안 들어간다) */
  map?: string;
  /** 하위 시트: 줄이 없는 부모 줄에는 키가 아예 없다 (아니면 빈 배열 []) */
  opt?: boolean;
  columns: Column[];
}

export type Block = PropsBlock | SheetBlock;

/** `@enum 이름 = a | b | c` — `enum(이름)` 열이 고를 값 */
export interface EnumDecl {
  name: string;
  values: string[];
  comments?: string[];
}

/** `@ref 종류 = 파일#시트경로.키열 [label=열] [icon=열]` — `ref(종류)` 열이 가리키는 곳 */
export interface RefDecl {
  kind: string;
  /** 작업 공간 기준 상대 경로. 빈 글 = 같은 파일 */
  file: string;
  /** 가리키는 시트의 경로 ([] = 뿌리 배열) */
  sheet: string[];
  key: string;
  label?: string;
  icon?: string;
  /** 선언된 줄 (읽을 때만 채운다) */
  line?: number;
  comments?: string[];
}

/** `@doc 시트경로.열 = 설명` — 열 설명 */
export interface DocDecl {
  sheet: string[];
  col: string;
  text: string;
  comments?: string[];
}

export interface Schema {
  types: Map<string, T>;
  /** 읽기 전용 꼬리표 (값 트리에는 영향 없음). 정규 출력은 @type 다음, 블록 앞에 쓴다 */
  enums: Map<string, EnumDecl>;
  refs: Map<string, RefDecl>;
  docs: DocDecl[];
  blocks: Block[];
  /** @type 줄 바로 위의 주석 */
  typeComments?: Map<string, string[]>;
  /** 마지막 블록 뒤의 주석 */
  trailing?: string[];
}

export class GsdError extends Error {
  line: number;
  col: number;
  constructor(line: number, col: number, msg: string) {
    super(`줄 ${line}:칸 ${col} — ${msg}`);
    this.name = "GsdError";
    this.line = line;
    this.col = col;
  }
}

const ANY: T = { k: "any" };
const INT: T = { k: "int" };
const NUM: T = { k: "num" };
const STR: T = { k: "str" };
const BOOL: T = { k: "bool" };

const SAFE = Number.MAX_SAFE_INTEGER;
const KEY_BAD = /[\s=;{}\[\]"|:.#@~()?,\\]/u;
const isBareKey = (s: string) => s.length > 0 && !KEY_BAD.test(s);
const isSp = (ch: string | undefined) => ch === " " || ch === "\t";
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function setKey(o: Record<string, unknown>, k: string, v: unknown) {
  if (k === "__proto__") Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  else o[k] = v;
}

// ───────── 글로 내보내기 (타입·경로·글) ─────────

export function quoteStr(s: string): string {
  let o = '"';
  for (const ch of s) {
    const n = ch.codePointAt(0)!;
    if (ch === '"') o += '\\"';
    else if (ch === "\\") o += "\\\\";
    else if (ch === "\n") o += "\\n";
    else if (ch === "\r") o += "\\r";
    else if (ch === "\t") o += "\\t";
    else if (n < 0x20 || n === 0x7f) o += "\\u" + n.toString(16).padStart(4, "0");
    else o += ch;
  }
  return o + '"';
}

const keyText = (s: string) => (isBareKey(s) ? s : quoteStr(s));
const pathText = (p: string[]) => (p.length ? p.map(keyText).join(".") : ".");

function fieldText(f: Field): string {
  return `${keyText(f.name)}:${typeText(f.type)}${f.optional ? "?" : ""}`;
}

export function typeText(t: T): string {
  switch (t.k) {
    case "enum":
    case "ref":
      return `${t.k}(${t.name})`;
    case "list":
      return `[${typeText(t.of)}]`;
    case "rec":
      return `{${t.fields.map(fieldText).join(" ")}}`;
    case "named":
      return t.name;
    case "sum":
      return t.variants.map((v) => typeText({ k: "rec", fields: v })).join(" | ");
    default:
      return t.k;
  }
}

function needsQuote(s: string, nested: boolean): boolean {
  if (s === "" || s === "~") return true;
  if (isSp(s[0]) || isSp(s[s.length - 1])) return true;
  if (s[0] === '"' || s[0] === "#" || s[0] === "@") return true;
  if (/[\u0000-\u001f\u007f|]/.test(s)) return true;
  return nested && /[;{}\[\]=]/.test(s);
}

const strText = (s: string, nested: boolean) => (needsQuote(s, nested) ? quoteStr(s) : s);

// ───────── 커서와 오류 ─────────

class Cur {
  s: string;
  i: number;
  line: number;
  constructor(s: string, line: number, i = 0) {
    this.s = s;
    this.line = line;
    this.i = i;
  }
  get eol() {
    return this.i >= this.s.length;
  }
  peek(): string | undefined {
    return this.s[this.i];
  }
  skip() {
    while (this.i < this.s.length && isSp(this.s[this.i])) this.i++;
  }
  fail(msg: string, at = this.i): never {
    throw new GsdError(this.line, at + 1, msg);
  }
  expect(ch: string) {
    if (this.s[this.i] !== ch) this.fail(`\`${ch}\` 가 와야 한다`);
    this.i++;
  }
}

function readQuoted(c: Cur): string {
  const st = c.i;
  c.i++;
  let o = "";
  for (;;) {
    if (c.eol) c.fail("닫는 따옴표가 없다", st);
    const ch = c.s[c.i]!;
    if (ch === '"') {
      c.i++;
      return o;
    }
    if (ch === "\\") {
      const e = c.s[c.i + 1];
      if (e === '"' || e === "\\" || e === "/") o += e;
      else if (e === "n") o += "\n";
      else if (e === "r") o += "\r";
      else if (e === "t") o += "\t";
      else if (e === "u") {
        const h = c.s.slice(c.i + 2, c.i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(h)) c.fail("\\u 뒤에 16진수 네 자리가 와야 한다");
        o += String.fromCharCode(parseInt(h, 16));
        c.i += 4;
      } else c.fail("모르는 이스케이프 (\\\" \\\\ \\n \\r \\t \\uXXXX 만)");
      c.i += 2;
      continue;
    }
    o += ch;
    c.i++;
  }
}

function readKey(c: Cur): string {
  if (c.peek() === '"') return readQuoted(c);
  const st = c.i;
  while (!c.eol && !KEY_BAD.test(c.s[c.i]!)) c.i++;
  if (c.i === st) c.fail("이름이 와야 한다 (특수문자가 든 이름은 따옴표로)");
  return c.s.slice(st, c.i);
}

function readPath(c: Cur): string[] {
  if (c.peek() === ".") {
    const n = c.s[c.i + 1];
    if (n === undefined || isSp(n) || n === ":") {
      c.i++;
      return [];
    }
  }
  const segs = [readKey(c)];
  while (c.peek() === ".") {
    c.i++;
    segs.push(readKey(c));
  }
  return segs;
}

// ───────── 타입 읽기 ─────────

const BUILTIN = new Set(["int", "num", "str", "bool", "any"]);
const TYPE_WORD_BAD = /[\s()\[\]{}:?|=",]/;

function readWord(c: Cur): string {
  const st = c.i;
  while (!c.eol && !TYPE_WORD_BAD.test(c.s[c.i]!)) c.i++;
  if (c.i === st) c.fail("타입이 와야 한다");
  return c.s.slice(st, c.i);
}

function readType(c: Cur): T {
  c.skip();
  const ch = c.peek();
  if (ch === "[") {
    c.i++;
    const of = readType(c);
    c.skip();
    c.expect("]");
    return { k: "list", of };
  }
  if (ch === "{") {
    c.i++;
    const fields: Field[] = [];
    for (;;) {
      c.skip();
      if (c.peek() === "}") {
        c.i++;
        break;
      }
      if (c.eol) c.fail("`}` 가 와야 한다");
      const at = c.i;
      const name = readKey(c);
      if (fields.some((f) => f.name === name)) c.fail(`레코드 타입에 같은 이름 ${name}`, at);
      c.skip();
      c.expect(":");
      const type = readType(c);
      let optional = false;
      if (c.peek() === "?") {
        c.i++;
        optional = true;
      }
      fields.push({ name, type, optional });
    }
    return { k: "rec", fields };
  }
  const word = readWord(c);
  if (word === "enum" || word === "ref") {
    c.skip();
    c.expect("(");
    c.skip();
    const name = readWord(c);
    c.skip();
    c.expect(")");
    return { k: word, name };
  }
  if (BUILTIN.has(word)) return { k: word } as T;
  return { k: "named", name: word };
}

/** 열·필드 하나의 타입: 타입 뒤에 `?` 가 붙을 수 있다 */
function readColType(c: Cur): { type: T; optional: boolean } {
  const type = readType(c);
  let optional = false;
  if (c.peek() === "?") {
    c.i++;
    optional = true;
  }
  return { type, optional };
}

function readTypeDef(c: Cur): T {
  const first = readType(c);
  c.skip();
  if (c.peek() !== "|") return first;
  const alts = [first];
  while (c.peek() === "|") {
    c.i++;
    alts.push(readType(c));
    c.skip();
  }
  const variants: Field[][] = [];
  for (const a of alts) {
    if (a.k !== "rec" || a.fields.length === 0) c.fail("합 타입의 변형은 비지 않은 레코드 {…} 여야 한다");
    if (a.fields[0]!.optional) c.fail("합 타입 변형의 첫 키는 ? 를 못 붙인다");
    if (variants.some((v) => v[0]!.name === a.fields[0]!.name)) c.fail(`합 타입 변형의 첫 키 ${a.fields[0]!.name} 가 겹친다`);
    variants.push(a.fields);
  }
  return { k: "sum", variants };
}

function resolveC(c: Cur, t: T, types: Map<string, T>): T {
  let n = 0;
  while (t.k === "named") {
    const r = types.get(t.name);
    if (!r) c.fail(`모르는 타입 ${t.name} (@type 을 먼저 정의해야 한다)`);
    t = r;
    if (++n > 64) c.fail("타입이 서로를 끝없이 가리킨다");
  }
  return t;
}

function resolveW(t: T, types: Map<string, T>): T {
  let n = 0;
  while (t.k === "named") {
    const r = types.get(t.name);
    if (!r) throw new Error(`모르는 타입 ${t.name}`);
    t = r;
    if (++n > 64) throw new Error("타입이 서로를 끝없이 가리킨다");
  }
  return t;
}

// ───────── 값 읽기 ─────────

interface Ctx {
  nested: boolean;
  ws: boolean;
}
const TOP: Ctx = { nested: false, ws: false };
const NESTED: Ctx = { nested: true, ws: false };

function atEnd(c: Cur, x: Ctx): boolean {
  if (c.eol) return true;
  const ch = c.s[c.i]!;
  if (x.ws && isSp(ch)) return true;
  return x.nested ? ch === ";" || ch === "]" || ch === "}" : ch === "|";
}

function readBare(c: Cur, x: Ctx): string {
  const st = c.i;
  while (!atEnd(c, x)) c.i++;
  let e = c.i;
  while (e > st && isSp(c.s[e - 1])) e--;
  return c.s.slice(st, e);
}

const RE_INT = /-?(0|[1-9][0-9]*)/y;
const RE_NUM = /-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;

function readInt(c: Cur): number {
  RE_INT.lastIndex = c.i;
  const m = RE_INT.exec(c.s);
  if (!m) c.fail("정수가 와야 한다");
  const nx = c.s[c.i + m[0].length];
  if (nx === "." || nx === "e" || nx === "E") c.fail("정수 칸에 소수점·지수는 못 쓴다 (num 열이어야 한다)");
  const n = Number(m[0]);
  if (!Number.isSafeInteger(n)) c.fail("정수가 안전 범위(±2^53-1)를 벗어난다");
  c.i += m[0].length;
  return n === 0 ? 0 : n;
}

function readNum(c: Cur): number {
  RE_NUM.lastIndex = c.i;
  const m = RE_NUM.exec(c.s);
  if (!m) c.fail("수가 와야 한다");
  const n = Number(m[0]);
  if (!Number.isFinite(n)) c.fail("수가 너무 크다");
  if (!m[2] && !m[3] && !Number.isSafeInteger(n)) c.fail("정수가 안전 범위(±2^53-1)를 벗어난다");
  c.i += m[0].length;
  return n;
}

function parseAny(c: Cur): unknown {
  c.skip();
  const ch = c.peek();
  if (ch === "~") {
    c.i++;
    return null;
  }
  if (ch === '"') return readQuoted(c);
  if (ch === "[") {
    c.i++;
    const arr: unknown[] = [];
    c.skip();
    if (c.peek() === "]") {
      c.i++;
      return arr;
    }
    for (;;) {
      arr.push(parseAny(c));
      c.skip();
      if (c.peek() === ";") {
        c.i++;
        c.skip();
        if (c.peek() === "]") {
          c.i++;
          return arr;
        }
        continue;
      }
      if (c.peek() === "]") {
        c.i++;
        return arr;
      }
      c.fail("`;` 또는 `]` 가 와야 한다");
    }
  }
  if (ch === "{") {
    c.i++;
    const o: Record<string, unknown> = {};
    c.skip();
    if (c.peek() === "}") {
      c.i++;
      return o;
    }
    for (;;) {
      c.skip();
      const at = c.i;
      const k = readKey(c);
      if (Object.prototype.hasOwnProperty.call(o, k)) c.fail(`키 ${k} 가 겹친다`, at);
      c.skip();
      c.expect("=");
      setKey(o, k, parseAny(c));
      c.skip();
      if (c.peek() === ";") {
        c.i++;
        c.skip();
        if (c.peek() === "}") {
          c.i++;
          return o;
        }
        continue;
      }
      if (c.peek() === "}") {
        c.i++;
        return o;
      }
      c.fail("`;` 또는 `}` 가 와야 한다");
    }
  }
  if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) return readNum(c);
  if (c.s.startsWith("true", c.i) && /[\s;\]}|]|^$/.test(c.s[c.i + 4] ?? "")) {
    c.i += 4;
    return true;
  }
  if (c.s.startsWith("false", c.i) && /[\s;\]}|]|^$/.test(c.s[c.i + 5] ?? "")) {
    c.i += 5;
    return false;
  }
  return c.fail("any 칸에는 ~ true false 수 \"글\" [목록] {객체} 만 온다 (글은 따옴표)");
}

function parseRecFull(c: Cur, t: T & ({ k: "rec" } | { k: "sum" }), types: Map<string, T>): Record<string, unknown> {
  const open = c.i;
  c.expect("{");
  let fields: Field[] | null = t.k === "rec" ? t.fields : null;
  const o: Record<string, unknown> = {};
  c.skip();
  if (c.peek() === "}") c.i++;
  else {
    for (;;) {
      c.skip();
      const at = c.i;
      const key = readKey(c);
      if (fields === null) {
        const v = (t as { variants: Field[][] }).variants.find((vv) => vv[0]!.name === key);
        if (!v) c.fail(`합 타입 변형 중에 첫 키가 ${key} 인 것이 없다`, at);
        fields = v;
      }
      const f = fields.find((ff) => ff.name === key);
      if (!f) c.fail(`모르는 키 ${key}`, at);
      if (Object.prototype.hasOwnProperty.call(o, key)) c.fail(`키 ${key} 가 겹친다`, at);
      c.skip();
      c.expect("=");
      c.skip();
      if (c.eol || c.peek() === ";" || c.peek() === "}") c.fail("값이 없다");
      setKey(o, key, parseVal(c, f.type, NESTED, types));
      c.skip();
      if (c.peek() === ";") {
        c.i++;
        c.skip();
        if (c.peek() === "}") {
          c.i++;
          break;
        }
        continue;
      }
      if (c.peek() === "}") {
        c.i++;
        break;
      }
      c.fail("`;` 또는 `}` 가 와야 한다");
    }
  }
  if (fields === null) c.fail("합 타입 레코드가 비었다", open);
  for (const f of fields) if (!f.optional && !Object.prototype.hasOwnProperty.call(o, f.name)) c.fail(`필수 키 ${f.name} 가 없다`, open);
  return o;
}

/** 합 타입의 짧은 쓰기: `gold 650`, `item wooden_sword 1` — 첫 키 이름 뒤에 값이 필드 차례로 */
function parseShort(c: Cur, t: { k: "sum"; variants: Field[][] }, x: Ctx, types: Map<string, T>): Record<string, unknown> {
  const at = c.i;
  const key = readKey(c);
  const v = t.variants.find((vv) => vv[0]!.name === key);
  if (!v) c.fail(`합 타입 변형 중에 첫 키가 ${key} 인 것이 없다`, at);
  const o: Record<string, unknown> = {};
  for (let i = 0; i < v.length; i++) {
    const f = v[i]!;
    c.skip();
    if (atEnd(c, { nested: x.nested, ws: false })) {
      if (i === 0) c.fail("값이 없다");
      for (const r of v.slice(i)) if (!r.optional) c.fail(`필수 값 ${r.name} 가 모자란다`, at);
      break;
    }
    setKey(o, f.name, parseVal(c, f.type, { nested: x.nested, ws: true }, types));
  }
  return o;
}

function isNullAt(c: Cur): boolean {
  if (c.peek() !== "~") return false;
  const n = c.s[c.i + 1];
  return n === undefined || isSp(n) || n === "|" || n === ";" || n === "]" || n === "}";
}

function parseVal(c: Cur, t0: T, x: Ctx, types: Map<string, T>): unknown {
  const t = resolveC(c, t0, types);
  c.skip();
  if (isNullAt(c)) {
    c.i++;
    return null;
  }
  switch (t.k) {
    case "int":
      return readInt(c);
    case "num":
      return readNum(c);
    case "bool": {
      const st = c.i;
      while (!c.eol && /[a-z]/.test(c.s[c.i]!)) c.i++;
      const w = c.s.slice(st, c.i);
      if (w !== "true" && w !== "false") c.fail("true 또는 false 가 와야 한다", st);
      return w === "true";
    }
    case "str":
    case "enum":
    case "ref": {
      if (c.peek() === '"') return readQuoted(c);
      const st = c.i;
      const s = readBare(c, x);
      if (s === "") c.fail('빈 글은 "" 로 쓴다', st);
      return s;
    }
    case "any":
      return parseAny(c);
    case "list": {
      c.expect("[");
      const arr: unknown[] = [];
      c.skip();
      if (c.peek() === "]") {
        c.i++;
        return arr;
      }
      for (;;) {
        c.skip();
        if (c.eol || c.peek() === ";" || c.peek() === "]") c.fail("빈 항목 (빈 글은 \"\")");
        arr.push(parseVal(c, t.of, NESTED, types));
        c.skip();
        if (c.peek() === ";") {
          c.i++;
          c.skip();
          if (c.peek() === "]") {
            c.i++;
            return arr;
          }
          continue;
        }
        if (c.peek() === "]") {
          c.i++;
          return arr;
        }
        c.fail("`;` 또는 `]` 가 와야 한다");
      }
    }
    case "rec":
      if (c.peek() !== "{") c.fail("레코드는 { } 로 쓴다");
      return parseRecFull(c, t, types);
    case "sum":
      return c.peek() === "{" ? parseRecFull(c, t, types) : parseShort(c, t, x, types);
    default:
      return c.fail("내부 오류: 타입");
  }
}

// ───────── 경로 ─────────

function getAt(v: unknown, path: string[]): unknown {
  let cur = v;
  for (const s of path) {
    if (!isPlain(cur) || !Object.prototype.hasOwnProperty.call(cur, s)) return undefined;
    cur = cur[s];
  }
  return cur;
}

const pathEq = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i]);

/** 하위 시트면 부모 시트의 블록 번호: 경로에서 마지막 조각을 뺀 경로의 앞선 시트 */
function parentIndex(blocks: Block[], i: number): number {
  const b = blocks[i]!;
  if (b.kind !== "sheet" || b.path.length === 0) return -1;
  const pp = b.path.slice(0, -1);
  for (let j = i - 1; j >= 0; j--) {
    const o = blocks[j]!;
    if (o.kind === "sheet" && pathEq(o.path, pp)) return j;
  }
  return -1;
}

// ───────── 읽기 ─────────

interface RowInfo {
  obj: Record<string, unknown>;
  key: string;
  line: number;
}

/** 시트 줄 하나 (obj 는 값 트리의 그 객체 그대로) */
export type ParsedRow = RowInfo;

export interface ParsedGsd {
  value: unknown;
  schema: Schema;
  /** schema.blocks 와 같은 차례. 시트 블록의 줄들 (props 블록은 빈 목록) */
  rows: ParsedRow[][];
  /** schema.blocks 와 같은 차례. props 블록 항목의 줄 번호 (시트 블록은 빈 목록) */
  entryLines: number[][];
}

/** `파일#시트경로.키열` 의 `#` 뒤 — `.키열` 은 뿌리 배열, 점 하나짜리 `키열` 도 뿌리 */
function readTarget(c: Cur): { sheet: string[]; key: string } {
  if (c.peek() === ".") {
    c.i++;
    return { sheet: [], key: readKey(c) };
  }
  const p = readPath(c);
  if (p.length === 0) c.fail("시트 경로와 열 이름이 와야 한다");
  return { sheet: p.slice(0, -1), key: p[p.length - 1]! };
}

const targetText = (sheet: string[], key: string) => (sheet.length ? pathText([...sheet, key]) : "." + keyText(key));

export function parseGsd(text: string): ParsedGsd {
  const lines = text
    .replace(/^﻿/, "")
    .split("\n")
    .map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const types = new Map<string, T>();
  const blocks: Block[] = [];
  const rowsOf: RowInfo[][] = [];
  const lookups: Map<string, RowInfo>[] = [];
  const entryLines: number[][] = [];
  const enums = new Map<string, EnumDecl>();
  const refs = new Map<string, RefDecl>();
  const docs: DocDecl[] = [];
  let root: unknown = undefined;
  const pending: string[] = [];
  const typeComments = new Map<string, string[]>();
  const takeComments = () => (pending.length ? pending.splice(0) : undefined);
  const isBlank = (l: string) => /^[ \t]*$/.test(l);
  const isComment = (l: string) => l.trimStart().startsWith("#");

  function place(path: string[], val: unknown, c: Cur, at: number) {
    if (path.length === 0) {
      if (root !== undefined) c.fail("뿌리가 이미 정해졌다", at);
      root = val;
      return;
    }
    if (root === undefined) root = {};
    let cur = root;
    for (const s of path.slice(0, -1)) {
      if (!isPlain(cur)) c.fail("경로 중간이 객체가 아니다", at);
      let nx = Object.prototype.hasOwnProperty.call(cur, s) ? cur[s] : undefined;
      if (nx === undefined) {
        nx = {};
        setKey(cur, s, nx);
      }
      cur = nx;
    }
    const last = path[path.length - 1]!;
    if (!isPlain(cur)) c.fail("경로 중간이 객체가 아니다", at);
    if (Object.prototype.hasOwnProperty.call(cur, last)) c.fail(`키 ${pathText(path)} 가 이미 있다`, at);
    setKey(cur, last, val);
  }

  let li = 0;
  while (li < lines.length) {
    const line = lines[li]!;
    const ln = li + 1;
    li++;
    if (isBlank(line)) continue;
    if (isComment(line)) {
      pending.push(line.trimStart());
      continue;
    }
    const c: Cur = new Cur(line, ln);
    c.skip();
    if (c.peek() !== "@") c.fail("블록 밖의 줄 (@type @props @sheet 로 시작해야 한다)");
    c.i++;
    const st = c.i;
    while (!c.eol && !isSp(c.peek())) c.i++;
    const dir = c.s.slice(st, c.i);
    if (dir === "type") {
      c.skip();
      const at = c.i;
      const name = readWord(c);
      if (types.has(name)) c.fail(`타입 ${name} 이 이미 있다`, at);
      c.skip();
      c.expect("=");
      const def = readTypeDef(c);
      c.skip();
      if (!c.eol) c.fail("타입 정의 뒤에 글자가 남았다");
      types.set(name, def);
      const tc = takeComments();
      if (tc) typeComments.set(name, tc);
    } else if (dir === "props") {
      c.skip();
      const bpath = c.eol ? [] : readPath(c);
      c.skip();
      if (!c.eol) c.fail("@props 줄 뒤에 글자가 남았다");
      const entries: Column[] = [];
      const pb: PropsBlock = { kind: "props", path: bpath, entries };
      const pcm = takeComments();
      if (pcm) pb.comments = pcm;
      blocks.push(pb);
      rowsOf.push([]);
      const elines: number[] = [];
      entryLines[blocks.length - 1] = elines;
      while (li < lines.length && !isBlank(lines[li]!) && !lines[li]!.trimStart().startsWith("@")) {
        const l = lines[li]!;
        const n2 = li + 1;
        li++;
        if (isComment(l)) continue;
        const e: Cur = new Cur(l, n2);
        e.skip();
        const at = e.i;
        const epath = readPath(e);
        e.skip();
        e.expect(":");
        const type = readType(e);
        e.skip();
        if (e.peek() === "?") e.fail("props 항목은 ? 를 못 붙인다");
        e.expect("=");
        e.skip();
        if (e.eol) e.fail('값이 없다 (빈 글은 "")');
        const val = parseVal(e, type, TOP, types);
        e.skip();
        if (!e.eol) e.fail("값 뒤에 글자가 남았다");
        entries.push({ path: epath, type, optional: false });
        elines.push(n2);
        place([...bpath, ...epath], val, e, at);
      }
    } else if (dir === "sheet") {
      c.skip();
      const spath = readPath(c);
      let key: string | undefined;
      let map = false;
      let opt = false;
      for (;;) {
        c.skip();
        if (c.eol) break;
        const at = c.i;
        const w = readWord(c);
        if (w === "map") map = true;
        else if (w === "opt") opt = true;
        else if (w === "key" && c.peek() === "=") {
          c.i++;
          key = readKey(c);
        } else c.fail(`모르는 @sheet 옵션 ${w}`, at);
      }
      // 머리줄
      while (li < lines.length && isComment(lines[li]!)) li++;
      if (li >= lines.length || isBlank(lines[li]!) || lines[li]!.trimStart().startsWith("@")) c.fail("@sheet 다음 줄에 머리줄이 와야 한다", c.s.length);
      const hl = lines[li]!;
      const hln = li + 1;
      li++;
      const h: Cur = new Cur(hl, hln);
      h.skip();
      const bi = blocks.length;
      const probe: SheetBlock = { kind: "sheet", path: spath, columns: [] };
      const scm = takeComments();
      if (scm) probe.comments = scm;
      blocks.push(probe);
      const pi = parentIndex(blocks, bi);
      let isChild = false;
      let mapName: string | undefined;
      let first = true;
      const cols: Column[] = [];
      for (;;) {
        h.skip();
        if (h.eol && !first) break;
        const at = h.i;
        if (first && h.peek() === "^") {
          h.i++;
          isChild = true;
        } else {
          const cpath = readPath(h);
          if (cpath.length === 0) h.fail("열 이름이 와야 한다", at);
          h.skip();
          h.expect(":");
          const { type, optional } = readColType(h);
          if (first && map) {
            if (type.k !== "str" || optional || cpath.length !== 1) h.fail("map 시트의 첫 열은 `이름:str` 이어야 한다", at);
            mapName = cpath[0];
          } else {
            if (cols.some((o) => pathEq(o.path, cpath))) h.fail(`열 ${pathText(cpath)} 가 겹친다`, at);
            cols.push({ path: cpath, type, optional });
          }
        }
        first = false;
        h.skip();
        if (h.eol) break;
        if (h.peek() !== "|") h.fail("`|` 가 와야 한다");
        h.i++;
      }
      if (pi >= 0 && !isChild) h.fail("하위 시트의 첫 열은 ^ 이어야 한다", 0);
      if (pi < 0 && isChild) h.fail("^ 열은 부모 시트가 있는 하위 시트에만 쓴다", 0);
      if (isChild && map) h.fail("하위 시트는 map 이 아니다", 0);
      if (opt && !isChild) h.fail("opt 는 하위 시트에만 쓴다", 0);
      if (map && key !== undefined) h.fail("map 시트의 키는 첫 열이다 (key= 를 못 쓴다)", 0);
      if (key !== undefined && !cols.some((o) => o.path.length === 1 && o.path[0] === key)) h.fail(`key=${key} 열이 없다`, 0);
      const block: SheetBlock = { kind: "sheet", path: spath, columns: cols };
      if (probe.comments) block.comments = probe.comments;
      if (key !== undefined) block.key = key;
      if (map) block.map = mapName!;
      if (opt) block.opt = true;
      blocks[bi] = block;
      const rows: RowInfo[] = [];
      rowsOf.push(rows);
      const field = spath[spath.length - 1]!;
      // 붙일 자리 마련
      if (pi < 0) place(spath, map ? {} : [], c, 0);
      else if (!opt) for (const pr of rowsOf[pi]!) setKey(pr.obj, field, []);
      const container = pi < 0 ? (getAt(root, spath) as unknown) : null;
      const byKey = new Map<string, RowInfo>();
      while (li < lines.length && !isBlank(lines[li]!) && !lines[li]!.trimStart().startsWith("@")) {
        const l = lines[li]!;
        const n2 = li + 1;
        li++;
        if (isComment(l)) continue;
        const r: Cur = new Cur(l, n2);
        r.skip();
        const obj: Record<string, unknown> = {};
        let parentKey: string | undefined;
        let mapKey: string | undefined;
        const cells: { col: Column | null; kind: "parent" | "mapkey" | "col" }[] = [];
        if (isChild) cells.push({ col: null, kind: "parent" });
        if (map) cells.push({ col: null, kind: "mapkey" });
        for (const col of cols) cells.push({ col, kind: "col" });
        let ended = false;
        for (let ci = 0; ci < cells.length; ci++) {
          const cell = cells[ci]!;
          if (ci > 0 && !ended) {
            r.skip();
            if (r.eol) ended = true;
            else {
              if (r.peek() !== "|") r.fail("`|` 가 와야 한다");
              r.i++;
            }
          }
          let val: unknown = undefined;
          if (!ended) {
            r.skip();
            if (!(r.eol || r.peek() === "|")) val = parseVal(r, cell.kind === "col" ? cell.col!.type : STR, TOP, types);
          }
          if (cell.kind === "parent") {
            if (typeof val !== "string") r.fail("^ 칸(부모 줄 키)이 비었다");
            parentKey = val;
          } else if (cell.kind === "mapkey") {
            if (typeof val !== "string") r.fail("키 칸이 비었다");
            mapKey = val;
          } else {
            const col = cell.col!;
            // 점 경로의 가운데 객체는 칸이 비어도 만든다
            let cur = obj;
            for (const s of col.path.slice(0, -1)) {
              let nx = Object.prototype.hasOwnProperty.call(cur, s) ? cur[s] : undefined;
              if (nx === undefined) {
                nx = {};
                setKey(cur, s, nx);
              }
              cur = nx as Record<string, unknown>;
            }
            if (val === undefined) {
              if (!col.optional) r.fail(`열 ${pathText(col.path)} 이 비었다 (필수 열; 빼려면 타입에 ? 를 붙인다)`, ended ? l.length : r.i);
            } else setKey(cur, col.path[col.path.length - 1]!, val);
          }
        }
        r.skip();
        if (!r.eol) r.fail("열이 머리줄보다 많다");
        // 붙이고 키 계산
        let fullKey: string;
        const ownKey = (idx: number) => {
          if (key === undefined) return String(idx);
          const kv = getAt(obj, [key]);
          if (kv === undefined || kv === null) r.fail(`키 열 ${key} 가 비었다`, 0);
          return String(kv);
        };
        if (!isChild) {
          if (map) {
            const m = container as Record<string, unknown>;
            if (Object.prototype.hasOwnProperty.call(m, mapKey!)) r.fail(`map 키 ${mapKey} 가 겹친다`, 0);
            setKey(m, mapKey!, obj);
            fullKey = mapKey!;
          } else {
            (container as unknown[]).push(obj);
            fullKey = ownKey(rows.length);
          }
        } else {
          const pr = lookups[pi]?.get(parentKey!);
          if (!pr) r.fail(`부모 줄 ${parentKey} 가 없다`, 0);
          if (!Object.prototype.hasOwnProperty.call(pr.obj, field)) setKey(pr.obj, field, []);
          const arr = pr.obj[field] as unknown[];
          fullKey = pr.key + "/" + ownKey(arr.length);
          arr.push(obj);
        }
        if (byKey.has(fullKey)) r.fail(`키 ${fullKey} 가 겹친다`, 0);
        const info = { obj, key: fullKey, line: n2 };
        byKey.set(fullKey, info);
        rows.push(info);
      }
      lookups[bi] = byKey;
    } else if (dir === "enum") {
      c.skip();
      const at = c.i;
      const name = readWord(c);
      if (enums.has(name)) c.fail(`@enum ${name} 이 이미 있다`, at);
      c.skip();
      c.expect("=");
      const values: string[] = [];
      for (;;) {
        c.skip();
        let v: string;
        if (c.peek() === '"') v = readQuoted(c);
        else {
          const vs = c.i;
          while (!c.eol && c.peek() !== "|") c.i++;
          v = c.s.slice(vs, c.i).trim();
        }
        if (v === "") c.fail("고를 값이 비었다");
        if (values.includes(v)) c.fail(`값 ${v} 가 겹친다`);
        values.push(v);
        c.skip();
        if (c.eol) break;
        if (c.peek() !== "|") c.fail("`|` 가 와야 한다");
        c.i++;
      }
      const d: EnumDecl = { name, values };
      const cm = takeComments();
      if (cm) d.comments = cm;
      enums.set(name, d);
    } else if (dir === "ref") {
      c.skip();
      const at = c.i;
      const kind = readWord(c);
      if (refs.has(kind)) c.fail(`@ref ${kind} 가 이미 있다`, at);
      c.skip();
      c.expect("=");
      c.skip();
      const fs = c.i;
      while (!c.eol && !isSp(c.peek()) && c.peek() !== "#") c.i++;
      const file = c.s.slice(fs, c.i);
      if (c.peek() !== "#") c.fail("`파일#시트경로.키열` 모양이어야 한다 (같은 파일이면 `#` 앞을 비운다)");
      c.i++;
      const tg = readTarget(c);
      const d: RefDecl = { kind, file, sheet: tg.sheet, key: tg.key, line: ln };
      for (;;) {
        c.skip();
        if (c.eol) break;
        const oat = c.i;
        const w = readWord(c);
        if ((w === "label" || w === "icon") && c.peek() === "=") {
          c.i++;
          d[w] = readKey(c);
        } else c.fail(`모르는 @ref 옵션 ${w}`, oat);
      }
      const cm = takeComments();
      if (cm) d.comments = cm;
      refs.set(kind, d);
    } else if (dir === "doc") {
      c.skip();
      const at = c.i;
      const tg = readTarget(c);
      if (docs.some((o) => o.col === tg.key && pathEq(o.sheet, tg.sheet))) c.fail("이 열의 @doc 이 이미 있다", at);
      c.skip();
      c.expect("=");
      c.skip();
      let txt: string;
      if (c.peek() === '"') {
        txt = readQuoted(c);
        c.skip();
        if (!c.eol) c.fail("설명 뒤에 글자가 남았다");
      } else txt = c.s.slice(c.i).trim();
      if (txt === "") c.fail("설명이 비었다");
      const d: DocDecl = { sheet: tg.sheet, col: tg.key, text: txt };
      const cm = takeComments();
      if (cm) d.comments = cm;
      docs.push(d);
    } else c.fail(`모르는 블록 @${dir}`);
  }
  const schema: Schema = { types, enums, refs, docs, blocks };
  if (typeComments.size) schema.typeComments = typeComments;
  if (pending.length) schema.trailing = pending;
  return { value: root === undefined ? {} : root, schema, rows: rowsOf, entryLines: blocks.map((_, i) => entryLines[i] ?? []) };
}

// ───────── 쓰기 ─────────

function serAny(v: unknown): string {
  if (v === null) return "~";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return numText(v, false);
  if (typeof v === "string") return quoteStr(v);
  if (Array.isArray(v)) return `[${v.map(serAny).join("; ")}]`;
  if (isPlain(v)) return `{${Object.entries(v).map(([k, x]) => `${keyText(k)}=${serAny(x)}`).join("; ")}}`;
  throw new Error(`쓸 수 없는 값 ${typeof v}`);
}

function numText(v: number, int: boolean): string {
  if (!Number.isFinite(v)) throw new Error("유한하지 않은 수");
  if ((int || Number.isInteger(v)) && !Number.isSafeInteger(v) && !/[.eE]/.test(String(v))) throw new Error("정수가 안전 범위를 벗어난다");
  if (int && !Number.isSafeInteger(v)) throw new Error(`정수가 아니다: ${v}`);
  return String(v);
}

const SCALAR = new Set(["int", "num", "str", "bool", "enum", "ref"]);
const SIMPLE_TOKEN = /^[^\s|;{}\[\]="~#@][^\s|;{}\[\]="]*$/;

function pickVariant(variants: Field[][], o: Record<string, unknown>): Field[] {
  const keys = Object.keys(o);
  for (const v of variants) {
    if (keys.every((k) => v.some((f) => f.name === k)) && v.every((f) => f.optional || keys.includes(f.name))) return v;
  }
  throw new Error(`합 타입의 어느 변형에도 안 맞는다: ${serAny(o)}`);
}

function serRecFull(fields: Field[], o: Record<string, unknown>, types: Map<string, T>): string {
  for (const k of Object.keys(o)) if (!fields.some((f) => f.name === k)) throw new Error(`레코드 타입에 없는 키 ${k}`);
  const parts: string[] = [];
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(o, f.name) || o[f.name] === undefined) {
      if (!f.optional) throw new Error(`필수 키 ${f.name} 가 없다`);
      continue;
    }
    parts.push(`${keyText(f.name)}=${ser(f.type, o[f.name], true, types)}`);
  }
  return `{${parts.join("; ")}}`;
}

function ser(t0: T, v: unknown, nested: boolean, types: Map<string, T>): string {
  const t = resolveW(t0, types);
  if (v === null) return "~";
  switch (t.k) {
    case "int":
    case "num":
      if (typeof v !== "number") throw new Error(`수가 아니다: ${serAny(v)}`);
      return numText(v, t.k === "int");
    case "bool":
      if (typeof v !== "boolean") throw new Error(`참거짓이 아니다: ${serAny(v)}`);
      return v ? "true" : "false";
    case "str":
    case "enum":
    case "ref":
      if (typeof v !== "string") throw new Error(`글이 아니다: ${serAny(v)}`);
      return strText(v, nested);
    case "any":
      return serAny(v);
    case "list":
      if (!Array.isArray(v)) throw new Error("목록이 아니다");
      return `[${v.map((x) => ser(t.of, x, true, types)).join("; ")}]`;
    case "rec":
      if (!isPlain(v)) throw new Error("객체가 아니다");
      return serRecFull(t.fields, v, types);
    case "sum": {
      if (!isPlain(v)) throw new Error("객체가 아니다");
      const variant = pickVariant(t.variants, v);
      // 짧은 쓰기: 값이 모두 간단한 낱값이고 빠진 선택 키가 뒤쪽에만 있을 때
      let short = true;
      let gap = false;
      const toks: string[] = [];
      for (const f of variant) {
        const has = Object.prototype.hasOwnProperty.call(v, f.name) && v[f.name] !== undefined;
        if (!has) {
          gap = true;
          continue;
        }
        const ft = resolveW(f.type, types);
        const fv = v[f.name];
        if (gap || fv === null || !SCALAR.has(ft.k)) {
          short = false;
          break;
        }
        const s = typeof fv === "string" ? fv : String(fv);
        if (typeof fv === "string" && !SIMPLE_TOKEN.test(fv)) {
          short = false;
          break;
        }
        toks.push(toks.length === 0 ? `${keyText(f.name)} ${s}` : s);
      }
      if (short) return toks.join(" ");
      return serRecFull(variant, v, types);
    }
    default:
      throw new Error("내부 오류: 타입");
  }
}

function dispW(s: string): number {
  let w = 0;
  for (const ch of s) {
    const n = ch.codePointAt(0)!;
    w += (n >= 0x1100 && n <= 0x115f) || (n >= 0x2e80 && n <= 0xa4cf) || (n >= 0xac00 && n <= 0xd7a3) || (n >= 0xf900 && n <= 0xfaff) || (n >= 0xfe30 && n <= 0xfe6f) || (n >= 0xff00 && n <= 0xff60) || (n >= 0xffe0 && n <= 0xffe6) || (n >= 0x20000 && n <= 0x3fffd) ? 2 : 1;
  }
  return w;
}

const ALIGN_CAP = 40;

interface WRow {
  obj: Record<string, unknown>;
  key: string;
  parent: string;
}

export function writeGsd(value: unknown, schema: Schema): string {
  const { types, blocks } = schema;
  const out: string[] = [];
  for (const [n, t] of types) {
    out.push(...(schema.typeComments?.get(n) ?? []));
    out.push(`@type ${n} = ${typeText(t)}`);
  }
  for (const d of schema.enums.values()) {
    out.push(...(d.comments ?? []));
    out.push(`@enum ${d.name} = ${d.values.map((v) => strText(v, false)).join(" | ")}`);
  }
  for (const d of schema.refs.values()) {
    out.push(...(d.comments ?? []));
    out.push(`@ref ${d.kind} = ${d.file}#${targetText(d.sheet, d.key)}${d.label !== undefined ? ` label=${keyText(d.label)}` : ""}${d.icon !== undefined ? ` icon=${keyText(d.icon)}` : ""}`);
  }
  for (const d of schema.docs) {
    out.push(...(d.comments ?? []));
    out.push(`@doc ${targetText(d.sheet, d.col)} = ${strText(d.text, false)}`);
  }
  const rowsOf: WRow[][] = [];
  blocks.forEach((b, bi) => {
    if (out.length) out.push("");
    out.push(...(b.comments ?? []));
    if (b.kind === "props") {
      out.push(`@props${b.path.length ? " " + pathText(b.path) : ""}`);
      rowsOf.push([]);
      for (const e of b.entries) {
        const v = getAt(value, [...b.path, ...e.path]);
        if (v === undefined) throw new Error(`props ${pathText([...b.path, ...e.path])}: 값이 없다`);
        try {
          out.push(`${pathText(e.path)}: ${typeText(e.type)} = ${ser(e.type, v, false, types)}`);
        } catch (err) {
          throw new Error(`props ${pathText([...b.path, ...e.path])}: ${(err as Error).message}`);
        }
      }
      return;
    }
    const where = `sheet ${pathText(b.path)}`;
    const pi = parentIndex(blocks, bi);
    const rows: WRow[] = [];
    const ownKey = (o: Record<string, unknown>, i: number) => {
      if (b.key === undefined) return String(i);
      const kv = getAt(o, [b.key]);
      if (kv === undefined || kv === null) throw new Error(`${where}: 키 열 ${b.key} 가 비었다`);
      return String(kv);
    };
    if (pi < 0) {
      const data = getAt(value, b.path) ?? (b.path.length === 0 ? value : undefined);
      if (b.map !== undefined) {
        if (!isPlain(data)) throw new Error(`${where}: 객체가 아니다`);
        for (const [k, o] of Object.entries(data)) {
          if (!isPlain(o)) throw new Error(`${where}[${k}]: 객체가 아니다`);
          rows.push({ obj: o, key: k, parent: "" });
        }
      } else {
        if (!Array.isArray(data)) throw new Error(`${where}: 배열이 아니다`);
        data.forEach((o, i) => {
          if (!isPlain(o)) throw new Error(`${where}[${i}]: 객체가 아니다`);
          rows.push({ obj: o, key: ownKey(o, i), parent: "" });
        });
      }
    } else {
      if (b.map !== undefined) throw new Error(`${where}: 하위 시트는 map 이 아니다`);
      const field = b.path[b.path.length - 1]!;
      for (const pr of rowsOf[pi]!) {
        const arr = pr.obj[field];
        if (arr === undefined && b.opt) continue;
        if (!Array.isArray(arr)) throw new Error(`${where}: 부모 줄 ${pr.key} 에 배열 ${field} 가 없다`);
        arr.forEach((o, i) => {
          if (!isPlain(o)) throw new Error(`${where}: 객체가 아니다`);
          rows.push({ obj: o, key: pr.key + "/" + ownKey(o, i), parent: pr.key });
        });
      }
    }
    rowsOf.push(rows);
    const head = [pi >= 0 ? "^" : "", b.map !== undefined ? `${keyText(b.map)}:str` : ""].filter(Boolean);
    const cells: string[][] = [[...head, ...b.columns.map((c) => `${pathText(c.path)}:${typeText(c.type)}${c.optional ? "?" : ""}`)]];
    for (const r of rows) {
      const line: string[] = [];
      if (pi >= 0) line.push(strText(r.parent, false));
      if (b.map !== undefined) line.push(strText(r.key, false));
      for (const col of b.columns) {
        const v = getAt(r.obj, col.path);
        if (v === undefined) {
          if (!col.optional) throw new Error(`${where}[${r.key}]: 필수 열 ${pathText(col.path)} 가 없다`);
          line.push("");
          continue;
        }
        try {
          line.push(ser(col.type, v, false, types));
        } catch (err) {
          throw new Error(`${where}[${r.key}].${pathText(col.path)}: ${(err as Error).message}`);
        }
      }
      cells.push(line);
    }
    const ncol = cells[0]!.length;
    const widths: number[] = [];
    for (let ci = 0; ci < ncol; ci++) {
      let w = dispW(cells[0]![ci]!);
      for (const line of cells.slice(1)) {
        const cw = dispW(line[ci]!);
        if (cw <= ALIGN_CAP && cw > w) w = cw;
      }
      widths.push(w);
    }
    out.push(`@sheet ${pathText(b.path)}${b.key !== undefined ? ` key=${keyText(b.key)}` : ""}${b.map !== undefined ? " map" : ""}${b.opt ? " opt" : ""}`);
    for (const line of cells) {
      out.push(line.map((cell, ci) => cell + " ".repeat(Math.max(0, widths[ci]! - dispW(cell)))).join(" | ").trimEnd());
    }
  });
  if (schema.trailing?.length) {
    if (out.length) out.push("");
    out.push(...schema.trailing);
  }
  return out.join("\n") + "\n";
}

/** 정규 출력으로 다시 쓰기 (fmt) */
export function formatGsd(text: string): string {
  const { value, schema } = parseGsd(text);
  return writeGsd(value, schema);
}

// ───────── 스키마 추정 ─────────

export interface InferHints {
  /** 열·항목의 점 경로(조각을 . 로 이음) → 타입 글. 예: `steps.objective` → `objective` */
  types?: Record<string, string>;
  /** 하위 시트·점 열로 펴지 않고 칸 안에 넣을 열의 점 경로 */
  inline?: string[];
}

const MAX_COLS = 16;
const MAX_DOT = 12;
const CHILD_MIN_ROWS = 6;

function sameKeys(objs: Record<string, unknown>[]): boolean {
  const sig = (o: Record<string, unknown>) => Object.keys(o).sort().join("\u0000");
  const s0 = sig(objs[0]!);
  return objs.every((o) => sig(o) === s0);
}

function unionKeys(objs: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const o of objs) for (const k of Object.keys(o)) seen.add(k);
  return [...seen];
}

/** 레코드 줄들로 시트를 만들 만한가: 열 수가 적고 칸이 대체로 차 있다 */
function tabular(arr: unknown[]): arr is Record<string, unknown>[] {
  if (arr.length === 0 || !arr.every(isPlain)) return false;
  const u = unionKeys(arr);
  if (u.length < 1 || u.length > MAX_COLS) return false;
  let filled = 0;
  for (const o of arr) filled += Object.keys(o).length;
  return filled / (arr.length * u.length) >= 0.4;
}

const singular = (s: string) => (/ies$|ss$/.test(s) ? s : s.length > 3 && s.endsWith("s") ? s.slice(0, -1) : s);

export function inferGsd(value: unknown, hints: InferHints = {}): Schema {
  const types = new Map<string, T>();
  const blocks: Block[] = [];
  const inlineSet = new Set(hints.inline ?? []);
  const keyOf = (p: string[]) => p.join(".");

  function override(p: string[]): T | undefined {
    const txt = hints.types?.[keyOf(p)];
    if (txt === undefined) return undefined;
    return readType(new Cur(txt, 0));
  }

  function limit(t: T, depth: number): T {
    return depth > 3 || typeText(t).length > 240 ? ANY : t;
  }

  function regSum(name: string, variants: Field[][]): T {
    const text = typeText({ k: "sum", variants });
    for (const [n, t] of types) if (t.k === "sum" && typeText(t) === text) return { k: "named", name: n };
    let nm = isBareKey(name) && !BUILTIN.has(name) && name !== "enum" && name !== "ref" ? name : "t";
    for (let i = 2; types.has(nm); i++) nm = `${name}${i}`;
    types.set(nm, { k: "sum", variants });
    return { k: "named", name: nm };
  }

  function inferObjs(objs: Record<string, unknown>[], name: string, depth: number): T {
    const groups = new Map<string, { keys: string[]; objs: Record<string, unknown>[] }>();
    for (const o of objs) {
      const keys = Object.keys(o);
      const sig = [...keys].sort().join("\u0000");
      const g = groups.get(sig);
      if (g) g.objs.push(o);
      else groups.set(sig, { keys, objs: [o] });
    }
    const fieldsOf = (keys: string[], os: Record<string, unknown>[], optionalMissing: boolean): Field[] =>
      keys.map((k) => {
        const present = os.filter((o) => Object.prototype.hasOwnProperty.call(o, k));
        return { name: k, type: inferT(present.map((o) => o[k]), k, depth + 1), optional: optionalMissing && present.length < os.length };
      });
    if (groups.size === 1) {
      const g = [...groups.values()][0]!;
      return limit({ k: "rec", fields: fieldsOf(g.keys, objs, false) }, depth);
    }
    const gs = [...groups.values()];
    if (gs.length <= 16 && gs.every((g) => g.keys.length > 0) && new Set(gs.map((g) => g.keys[0])).size === gs.length) {
      return regSum(singular(name), gs.map((g) => fieldsOf(g.keys, g.objs, false)));
    }
    const u = unionKeys(objs);
    if (u.length <= 20) return limit({ k: "rec", fields: fieldsOf(u, objs, true) }, depth);
    return ANY;
  }

  function inferT(vals: unknown[], name: string, depth: number): T {
    const nn = vals.filter((v) => v !== null);
    if (nn.length === 0) return ANY;
    if (nn.every((v) => typeof v === "number")) return nn.every((v) => Number.isSafeInteger(v)) ? INT : NUM;
    if (nn.every((v) => typeof v === "boolean")) return BOOL;
    if (nn.every((v) => typeof v === "string")) return STR;
    if (nn.every(Array.isArray)) {
      const flat = (nn as unknown[][]).flat();
      if (flat.length === 0) return { k: "list", of: ANY };
      return limit({ k: "list", of: inferT(flat, name, depth + 1) }, depth);
    }
    if (nn.every(isPlain)) return inferObjs(nn as Record<string, unknown>[], name, depth);
    return ANY;
  }

  interface Child {
    field: string;
    records: Record<string, unknown>[];
    opt: boolean;
  }

  function columnsFor(records: Record<string, unknown>[], prefix: string[], sheetPath: string[], children: Child[] | null, dotDepth: number): Column[] {
    const cols: Column[] = [];
    for (const key of unionKeys(records)) {
      const present = records.filter((r) => Object.prototype.hasOwnProperty.call(r, key));
      const vals = present.map((r) => r[key]);
      const optional = present.length < records.length;
      const p = [...prefix, key];
      const full = [...sheetPath, ...p];
      const ov = override(full);
      if (!ov && !inlineSet.has(keyOf(full))) {
        if (children && vals.every(Array.isArray) && (!optional || vals.every((a) => (a as unknown[]).length > 0))) {
          const flat = (vals as unknown[][]).flat();
          if (flat.length >= CHILD_MIN_ROWS && tabular(flat) && unionKeys(flat).length >= 2) {
            children.push({ field: key, records: flat, opt: optional });
            continue;
          }
        }
        if (!optional && dotDepth < 2 && vals.every(isPlain) && sameKeys(vals as Record<string, unknown>[]) && Object.keys(vals[0] as object).length > 0) {
          const sub = columnsFor(vals as Record<string, unknown>[], p, sheetPath, null, dotDepth + 1);
          if (sub.length <= MAX_DOT) {
            cols.push(...sub);
            continue;
          }
        }
      }
      cols.push({ path: p, type: ov ?? inferT(vals, key, 0), optional });
    }
    return cols;
  }

  function emitSheet(path: string[], records: Record<string, unknown>[], mapKeys?: string[], opt = false) {
    const children: Child[] = [];
    const cols = columnsFor(records, [], path, children, 0);
    const block: SheetBlock = { kind: "sheet", path, columns: cols };
    if (opt) block.opt = true;
    if (mapKeys) {
      const names = new Set(unionKeys(records));
      let nm = "id";
      while (names.has(nm)) nm = "_" + nm;
      block.map = nm;
    } else if (children.length) {
      for (const cand of ["id", "key"]) {
        const col = cols.find((c) => c.path.length === 1 && c.path[0] === cand && !c.optional && (c.type.k === "int" || c.type.k === "str"));
        if (!col) continue;
        const vs = records.map((r) => String(r[cand]));
        if (new Set(vs).size === vs.length) {
          block.key = cand;
          break;
        }
      }
    }
    blocks.push(block);
    for (const ch of children) emitSheet([...path, ch.field], ch.records, undefined, ch.opt);
  }

  function emitObject(path: string[], obj: Record<string, unknown>) {
    let entries: Column[] = [];
    const flush = () => {
      if (entries.length) blocks.push({ kind: "props", path, entries });
      entries = [];
    };
    for (const [k, v] of Object.entries(obj)) {
      const p = [...path, k];
      const ov = override(p);
      if (!ov && !inlineSet.has(keyOf(p))) {
        if (Array.isArray(v) && tabular(v)) {
          flush();
          emitSheet(p, v);
          continue;
        }
        if (isPlain(v) && Object.keys(v).length > 0) {
          const vs = Object.values(v);
          if (vs.length >= 3 && tabular(vs)) {
            flush();
            emitSheet(p, vs as Record<string, unknown>[], Object.keys(v));
          } else {
            flush();
            emitObject(p, v);
          }
          continue;
        }
      }
      entries.push({ path: [k], type: ov ?? inferT([v], k, 0), optional: false });
    }
    flush();
  }

  if (isPlain(value) && Object.keys(value).length > 0) emitObject([], value);
  else if (Array.isArray(value) && tabular(value)) emitSheet([], value);
  else blocks.push({ kind: "props", path: [], entries: [{ path: [], type: inferT([value], "root", 0), optional: false }] });

  // 안 쓰는 이름 붙인 타입은 버린다
  const used = new Set<string>();
  const mark = (t: T) => {
    if (t.k === "named") {
      if (!used.has(t.name)) {
        used.add(t.name);
        const d = types.get(t.name);
        if (d) mark(d);
      }
    } else if (t.k === "list") mark(t.of);
    else if (t.k === "rec") t.fields.forEach((f) => mark(f.type));
    else if (t.k === "sum") t.variants.forEach((v) => v.forEach((f) => mark(f.type)));
  };
  for (const b of blocks) for (const c of b.kind === "props" ? b.entries : b.columns) mark(c.type);
  for (const n of [...types.keys()]) if (!used.has(n)) types.delete(n);
  return { types, enums: new Map(), refs: new Map(), docs: [], blocks };
}

// ───────── 보조 ─────────

/** 키 차례를 무시한 깊은 비교. 다르면 첫 차이의 경로를 돌려준다 (같으면 null) */
export function diffTrees(a: unknown, b: unknown, path = "$"): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null) return `${path}: ${JSON.stringify(a)?.slice(0, 60)} ≠ ${JSON.stringify(b)?.slice(0, 60)}`;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: 배열 ≠ 비배열`;
    if (a.length !== b.length) return `${path}: 길이 ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diffTrees(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (typeof a === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    for (const k of ka) if (!kb.includes(k)) return `${path}.${k}: 오른쪽에 없다`;
    for (const k of kb) if (!ka.includes(k)) return `${path}.${k}: 왼쪽에 없다`;
    for (const k of ka) {
      const d = diffTrees((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return `${path}: ${JSON.stringify(a)?.slice(0, 60)} ≠ ${JSON.stringify(b)?.slice(0, 60)}`;
}

/** 스키마 안의 `any` 개수 (열·항목 타입과 이름 붙인 타입 안) */
export function countAny(schema: Schema): number {
  let n = 0;
  const walk = (t: T) => {
    if (t.k === "any") n++;
    else if (t.k === "list") walk(t.of);
    else if (t.k === "rec") t.fields.forEach((f) => walk(f.type));
    else if (t.k === "sum") t.variants.forEach((v) => v.forEach((f) => walk(f.type)));
  };
  for (const t of schema.types.values()) walk(t);
  for (const b of schema.blocks) for (const c of b.kind === "props" ? b.entries : b.columns) walk(c.type);
  return n;
}

// ───────── 작업 공간 (여러 파일을 가로지르는 @ref 풀이) ─────────

export type Workspace = Map<string, { text: string; parsed?: ParsedGsd; error?: GsdError }>;

export interface RefOption {
  id: string | number;
  label?: string;
  icon?: string;
  file: string;
  sheet: string;
}

/** 상대 경로 이름 (앞의 `./` 는 뗀다) */
const wsName = (f: string) => f.replace(/^(\.\/)+/, "");

/** 파일 글 모음 (상대 경로 → 글) 을 모두 읽는다. 틀린 파일은 error 로 남고 다른 파일은 계속 읽는다 */
export function loadWorkspace(files: Record<string, string>): Workspace {
  const ws: Workspace = new Map();
  for (const [name, text] of Object.entries(files)) {
    try {
      ws.set(wsName(name), { text, parsed: parseGsd(text) });
    } catch (e) {
      ws.set(wsName(name), { text, error: e instanceof GsdError ? e : new GsdError(0, 0, e instanceof Error ? e.message : String(e)) });
    }
  }
  return ws;
}

/** `enum(이름)` 열이 고를 값 (선언이 없으면 빈 목록) */
export function enumOptions(parsed: ParsedGsd, name: string): string[] {
  return parsed.schema.enums.get(name)?.values ?? [];
}

const optText = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : typeof v === "string" ? v : String(v));

function targetOptions(ws: Workspace, fromFile: string, decl: RefDecl): RefOption[] | null {
  const file = decl.file === "" ? wsName(fromFile) : wsName(decl.file);
  const parsed = ws.get(file)?.parsed;
  if (!parsed) return null;
  const bi = parsed.schema.blocks.findIndex((b) => b.kind === "sheet" && pathEq(b.path, decl.sheet));
  if (bi < 0) return null;
  const b = parsed.schema.blocks[bi] as SheetBlock;
  const out: RefOption[] = [];
  for (const r of parsed.rows[bi] ?? []) {
    const raw = b.map !== undefined && b.map === decl.key ? r.key : getAt(r.obj, [decl.key]);
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    const o: RefOption = { id: raw, file, sheet: pathText(decl.sheet) };
    const label = decl.label === undefined ? undefined : optText(getAt(r.obj, [decl.label]));
    const icon = decl.icon === undefined ? undefined : optText(getAt(r.obj, [decl.icon]));
    if (label !== undefined) o.label = label;
    if (icon !== undefined) o.icon = icon;
    out.push(o);
  }
  return out;
}

/** `fromFile` 의 `@ref 종류` 를 따라 가리키는 시트의 키 목록. 선언이 없거나 따라갈 수 없으면 빈 목록 */
export function refOptions(ws: Workspace, fromFile: string, kind: string): RefOption[] {
  const decl = ws.get(wsName(fromFile))?.parsed?.schema.refs.get(kind);
  return (decl && targetOptions(ws, fromFile, decl)) ?? [];
}

function collectRefs(t: T, v: unknown, types: Map<string, T>, into: { kind: string; value: string | number }[]) {
  if (v === undefined || v === null) return;
  const r = resolveW(t, types);
  if (r.k === "ref") {
    if (typeof v === "string" || typeof v === "number") into.push({ kind: r.name, value: v });
  } else if (r.k === "list") {
    if (Array.isArray(v)) for (const x of v) collectRefs(r.of, x, types, into);
  } else if (r.k === "rec" || r.k === "sum") {
    if (!isPlain(v)) return;
    const fields = r.k === "rec" ? r.fields : (r.variants.find((vs) => Object.prototype.hasOwnProperty.call(v, vs[0]!.name)) ?? []);
    for (const f of fields) if (Object.prototype.hasOwnProperty.call(v, f.name)) collectRefs(f.type, v[f.name], types, into);
  }
}

/** 없는 키를 가리키는 `ref(종류)` 칸과 읽을 수 없는 파일을 모은다 */
export function checkRefs(ws: Workspace): { file: string; line: number; message: string }[] {
  const out: { file: string; line: number; message: string }[] = [];
  const cache = new Map<string, Set<string> | null>();
  const keysOf = (file: string, kind: string): Set<string> | null => {
    const ck = file + "\0" + kind;
    if (cache.has(ck)) return cache.get(ck)!;
    const decl = ws.get(file)?.parsed?.schema.refs.get(kind);
    const opts = decl ? targetOptions(ws, file, decl) : null;
    const set = opts ? new Set(opts.map((o) => String(o.id))) : null;
    cache.set(ck, set);
    return set;
  };
  for (const [file, e] of ws) {
    if (e.error) {
      out.push({ file, line: e.error.line, message: e.error.message });
      continue;
    }
    const p = e.parsed;
    if (!p) continue;
    const { types } = p.schema;
    const reported = new Set<string>();
    const visit = (t: T, v: unknown, line: number) => {
      const found: { kind: string; value: string | number }[] = [];
      collectRefs(t, v, types, found);
      for (const f of found) {
        const decl = p.schema.refs.get(f.kind);
        if (!decl) {
          if (!reported.has(f.kind)) {
            reported.add(f.kind);
            out.push({ file, line, message: `ref(${f.kind}) 인데 @ref ${f.kind} 선언이 없다` });
          }
          continue;
        }
        const keys = keysOf(file, f.kind);
        if (!keys) {
          if (!reported.has(f.kind)) {
            reported.add(f.kind);
            out.push({ file, line: decl.line ?? line, message: `@ref ${f.kind} 가 가리키는 ${decl.file || "같은 파일"}#${targetText(decl.sheet, decl.key)} 를 찾을 수 없다` });
          }
        } else if (!keys.has(String(f.value))) out.push({ file, line, message: `ref(${f.kind}) 값 ${JSON.stringify(f.value)} 가 없다` });
      }
    };
    p.schema.blocks.forEach((b, bi) => {
      if (b.kind === "props") b.entries.forEach((en, i) => visit(en.type, getAt(p.value, [...b.path, ...en.path]), p.entryLines[bi]![i] ?? 0));
      else for (const r of p.rows[bi] ?? []) for (const col of b.columns) visit(col.type, getAt(r.obj, col.path), r.line);
    });
  }
  return out;
}
