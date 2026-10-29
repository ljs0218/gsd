// GSD 시험: 공용 표본(fixtures)을 읽어 기대 트리와 맞추고, 정규 출력의 멱등과 스키마 추정 왕복을 본다.
// 다른 언어 구현도 같은 표본을 통과해야 한다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { checkRefs, enumOptions, loadWorkspace, refOptions } from "../src/gsd.ts";
import { test } from "node:test";
import { diffTrees, formatGsd, GsdError, inferGsd, parseGsd, writeGsd } from "../src/gsd.ts";

const DIR = new URL("../../../fixtures/", import.meta.url);
const names = readdirSync(DIR).filter((f) => f.endsWith(".gsd") && !f.endsWith(".bad.gsd")).map((f) => f.slice(0, -4)).sort();
const bads = readdirSync(DIR).filter((f) => f.endsWith(".bad.gsd")).map((f) => f.slice(0, -4)).sort();
const read = (f: string) => readFileSync(new URL(f, DIR), "utf8");

for (const n of names) {
  const text = read(`${n}.gsd`);
  const want = JSON.parse(read(`${n}.json`));

  test(`표본 ${n}: 읽은 트리 == 기대 JSON`, () => {
    const { value } = parseGsd(text);
    assert.equal(diffTrees(value, want), null);
  });

  test(`표본 ${n}: 정규 출력은 멱등이고 다시 읽어도 같은 트리`, () => {
    const once = formatGsd(text);
    assert.equal(formatGsd(once), once);
    assert.equal(diffTrees(parseGsd(once).value, want), null);
    if (!n.startsWith("loose")) assert.equal(once, text, "표본 파일은 이미 정규 출력이어야 한다 (gsd fmt)");
  });

  test(`표본 ${n}: 기대 JSON 에서 스키마를 추정해 쓰고 읽어도 같은 트리`, () => {
    const text2 = writeGsd(want, inferGsd(want));
    const back = parseGsd(text2);
    assert.equal(diffTrees(back.value, want), null);
    assert.equal(writeGsd(back.value, back.schema), text2);
  });
}

for (const n of bads) {
  test(`틀린 입력 ${n}: 기대한 줄에서 오류`, () => {
    const line = Number(read(`${n}.line`).trim());
    assert.throws(
      () => parseGsd(read(`${n}.gsd`)),
      (e: unknown) => e instanceof GsdError && e.line === line,
      `줄 ${line} 에서 GsdError 가 나야 한다`,
    );
  });
}

test("오류 메시지는 줄:칸 위치를 담는다", () => {
  try {
    parseGsd("@props\nx: int = 1.5\n");
    assert.fail("오류가 나야 한다");
  } catch (e) {
    assert.ok(e instanceof GsdError);
    assert.match(e.message, /^줄 2:칸 \d+ — /);
  }
});

test("스키마 추정: 같은 모양은 점 열, 들쭉날쭉한 값은 any, 합 타입은 이름 붙은 타입", () => {
  const v = {
    rows: [
      { id: "a", stats: { hp: 1, mp: 2 }, extra: { x: 1 }, r: [{ gold: 1 }, { item: "x", count: 2 }] },
      { id: "b", stats: { hp: 3, mp: 4 }, extra: [1, "z"], r: [] },
    ],
  };
  const text = writeGsd(v, inferGsd(v));
  assert.match(text, /stats\.hp:int/);
  assert.match(text, /extra:any/);
  assert.match(text, /@type r = \{gold:int\} \| \{item:str count:int\}/);
  assert.equal(diffTrees(parseGsd(text).value, v), null);
});

test("스키마 추정: 큰 중첩은 하위 시트로, 줄이 없는 부모 줄에는 키가 없다 (opt)", () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, ...(i % 2 ? { drops: [{ item: "a", ppm: i }, { item: "b", ppm: i + 1 }, { item: "c", ppm: 3 }] } : {}) }));
  const v = { rows };
  const text = writeGsd(v, inferGsd(v));
  assert.match(text, /@sheet rows\.drops opt/);
  assert.equal(diffTrees(parseGsd(text).value, v), null);
});

test("쓰기: 안전 범위 밖 정수와 NaN 은 거부", () => {
  assert.throws(() => writeGsd({ a: 2 ** 60 }, inferGsd({ a: 1 })));
  assert.throws(() => writeGsd({ a: NaN }, inferGsd({ a: 1.5 })));
});

// ───────── 지시문과 작업 공간 ─────────

test("지시문: 스키마에 남고 정규 출력이 다시 써 낸다", () => {
  const { schema, value } = parseGsd(read("directives.gsd"));
  assert.deepEqual(schema.enums.get("grade")?.values, ["common", "rare", "very rare"]);
  assert.deepEqual(schema.refs.get("zone"), { kind: "zone", file: "maps.gsd", sheet: ["zones"], key: "id", line: 4 });
  assert.deepEqual(schema.refs.get("item")?.sheet, ["items"]);
  assert.equal(schema.refs.get("item")?.label, "name");
  assert.equal(schema.docs.length, 2);
  assert.deepEqual([schema.docs[1]!.sheet, schema.docs[1]!.col, schema.docs[1]!.text], [["items"], "price", '상점가 "금화"']);
  assert.equal(enumOptions({ value, schema, rows: [], entryLines: [] }, "grade").length, 3);
});

test("지시문: 선언 없이 enum()·ref() 열을 써도 읽는다, 뿌리 시트 표기", () => {
  const t = "@sheet .\nk:ref(x) | g:enum(y)\na | b\n";
  assert.deepEqual(parseGsd(t).value, [{ k: "a", g: "b" }]);
  const r = formatGsd("@ref x = f.gsd#.id\n@doc .id = 열쇠\n@sheet .\nid:str\na\n");
  assert.match(r, /@ref x = f\.gsd#\.id\n@doc \.id = 열쇠\n/);
  assert.equal(formatGsd(r), r);
});

const WS = {
  "items.gsd": "@ref item = #items.id label=name\n@sheet items key=id\nid:str | name:str\nsword | Sword\nwand | Wand\n",
  "mobs.gsd":
    "@ref item = items.gsd#items.id label=name\n@ref mob = #mobs.id\n@sheet mobs key=id\nid:str | boss:ref(mob)?\nbat |\nking | bat\n\n@sheet mobs.drops\n^ | item:ref(item)\nbat | sword\nking | wand\nking | axe\n",
};

test("작업 공간: refOptions 가 @ref 를 따라 키 목록을 준다", () => {
  const ws = loadWorkspace(WS);
  const o = refOptions(ws, "mobs.gsd", "item");
  assert.deepEqual(o.map((x) => [x.id, x.label, x.file, x.sheet]), [["sword", "Sword", "items.gsd", "items"], ["wand", "Wand", "items.gsd", "items"]]);
  assert.deepEqual(refOptions(ws, "mobs.gsd", "mob").map((x) => x.id), ["bat", "king"]);
  assert.deepEqual(refOptions(ws, "mobs.gsd", "none"), []);
});

test("작업 공간: checkRefs 는 없는 키를 가리키는 칸의 줄을 알린다", () => {
  const r = checkRefs(loadWorkspace(WS));
  assert.equal(r.length, 1);
  assert.equal(r[0]!.file, "mobs.gsd");
  assert.equal(r[0]!.line, 12);
  assert.match(r[0]!.message, /axe/);
});

test("작업 공간: 선언 없는 ref·틀린 파일·없는 대상 파일", () => {
  const ws = loadWorkspace({ "a.gsd": "@sheet s\nx:ref(q)\nv\n", "b.gsd": "@sheet s\nx:int\nz\n", "c.gsd": "@ref q = nope.gsd#s.id\n@sheet s\nx:ref(q)\nv\n" });
  const r = checkRefs(ws);
  assert.deepEqual(r.map((x) => [x.file, x.line]), [["a.gsd", 3], ["b.gsd", 3], ["c.gsd", 1]]);
});

test("작업 공간: 예시 폴더는 참조가 깨끗하다", () => {
  const dir = new URL("../../../examples/", import.meta.url);
  const files: Record<string, string> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".gsd"))) files[f] = readFileSync(new URL(f, dir), "utf8");
  const ws = loadWorkspace(files);
  assert.deepEqual(checkRefs(ws), []);
  for (const [n, e] of ws) assert.equal(formatGsd(e.text), e.text, `${n} 은 정규 출력이어야 한다`);
});
