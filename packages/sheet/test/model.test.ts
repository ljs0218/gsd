import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseGsd, writeGsd } from "@gsd/core";
import { tabsOf, locFromText, rowType, resolveLoc } from "../src/model/book.ts";
import { buildModel, cellSpec, shownOfCell, textOfCell, unitOf } from "../src/model/view.ts";
import { cellText, parseCell, summary } from "../src/model/codec.ts";
import { commit, keyProblem, planAddRow, planCellText, planDelete, planDuplicate } from "../src/model/edit.ts";
import { arrange, nextSort } from "../src/model/sort.ts";
import { parseTsv, planPaste, toTsv } from "../src/model/tsv.ts";
import { closeTop, openAt, settle, type PopSpec } from "../src/model/popstack.ts";
import { fitChips, idsOfValue, layoutRows, moveId, toggleId, withCurrent } from "../src/model/refpick.ts";

const fx = (n: string) => readFileSync(new URL(`../../../fixtures/${n}`, import.meta.url), "utf8");
const ex = (n: string) => readFileSync(new URL(`../../../examples/${n}`, import.meta.url), "utf8");
const noRef = () => false;
const yesRef = () => true;

test("탭: 하위 시트는 탭이 아니다", () => {
  const { schema } = parseGsd(fx("child.gsd"));
  assert.deepEqual(tabsOf(schema).map((t) => t.name), ["steps", "waves"]);
});

test("하위 시트는 값 트리를 따라 들어간 자리의 표", () => {
  const { value, schema } = parseGsd(fx("child.gsd"));
  const top = buildModel(value, schema, { tab: 0, path: ["steps"] })!;
  assert.equal(top.kind, "table");
  assert.deepEqual(top.cols.map((c) => c.label), ["id", "text", "rewards"]);
  assert.equal(top.rows.length, 3);
  const rc = top.cols[2]!;
  assert.equal(shownOfCell(top, top.rows[0]!, rc, schema, noRef), "[2] ▸");
  const sub = buildModel(value, schema, { tab: 0, path: ["steps", 0, "rewards"] })!;
  assert.equal(sub.rows.length, 2);
  assert.deepEqual(sub.cols.map((c) => c.label), ["n", "kind", "amount", "sub"]);
  const sub2 = buildModel(value, schema, { tab: 0, path: ["steps", 0, "rewards", 0, "sub"] })!;
  assert.deepEqual(sub2.rows.map((r) => (r.value as { label: string }).label), ["a", "b"]);
  assert.equal(sub2.block, 2);
  assert.equal(buildModel(value, schema, { tab: 0, path: ["steps", 9] }), null);
});

test("점 열은 한 칸씩, 맵 시트는 키 열", () => {
  const { value, schema } = parseGsd(fx("sheet.gsd"));
  const m = buildModel(value, schema, { tab: 0, path: ["mobs"] })!;
  assert.ok(m.cols.some((c) => c.label === "hitbox.w"));
  assert.equal(textOfCell(m, m.rows[0]!, m.cols.find((c) => c.label === "hitbox.w")!, schema, noRef), "18");
  const mp = parseGsd(fx("map.gsd"));
  const mm = buildModel(mp.value, mp.schema, { tab: 0, path: ["sounds"] })!;
  assert.equal(mm.kind, "map");
  assert.equal(mm.cols[0]!.role, "key");
  assert.deepEqual(mm.rows.map((r) => r.label), ["hit", "miss", "a.b", ""]);
});

test("합 타입 표: 변형 열 + 필드 합집합, 없는 칸은 null", () => {
  const { value, schema } = parseGsd(fx("sum.gsd"));
  const m = buildModel(value, schema, { tab: 1, path: ["steps", 0, "rewards"] });
  assert.ok(m, "rewards 칸으로 들어갈 수 있다");
  assert.equal(m!.variants!.join(","), "gold,exp,item,kind");
  const row = m!.rows[0]!; // gold 650
  const countCol = m!.cols.find((c) => c.label === "count")!;
  assert.equal(cellSpec(m!, row, countCol, schema, noRef), null);
  assert.equal(shownOfCell(m!, row, m!.cols[0]!, schema, noRef), "gold");
  // 변형 바꾸기
  const p = planCellText(m!, row, m!.cols[0]!, "item", schema, noRef);
  assert.ok(p.ok);
  const c = commit(value, schema, p.ok ? p.edits : []);
  assert.ok(c.ok);
  if (c.ok) assert.match(c.text, /item\s+\| ?|item /);
  // 합 타입 칸의 요약은 짧은 쓰기
  const top = buildModel(value, schema, { tab: 1, path: ["steps"] })!;
  const fcol = top.cols.find((c) => c.label === "first")!;
  assert.equal(shownOfCell(top, top.rows[0]!, fcol, schema, noRef), "gold 5");
});

test("칸 글 읽기·쓰기: 낱값", () => {
  const { schema } = parseGsd(fx("basic.gsd"));
  assert.deepEqual(parseCell("12", { k: "int" }, false, schema), { ok: true, value: 12 });
  assert.equal(parseCell("1.5", { k: "int" }, false, schema).ok, false);
  assert.deepEqual(parseCell("1.5e2", { k: "num" }, false, schema), { ok: true, value: 150 });
  assert.equal(parseCell("01", { k: "int" }, false, schema).ok, false);
  assert.deepEqual(parseCell("TRUE", { k: "bool" }, false, schema), { ok: true, value: true });
  assert.deepEqual(parseCell("", { k: "int" }, true, schema), { ok: true, value: undefined });
  assert.equal(parseCell("", { k: "int" }, false, schema).ok, false);
  assert.deepEqual(parseCell("~", { k: "str" }, false, schema), { ok: true, value: null });
  assert.deepEqual(parseCell("a | b", { k: "str" }, false, schema), { ok: true, value: "a | b" });
  assert.deepEqual(parseCell('"~"', { k: "str" }, false, schema), { ok: true, value: "~" });
  assert.equal(cellText({ k: "str" }, "~", false, schema), '"~"');
  assert.equal(cellText({ k: "str" }, "", true, schema), '""');
  assert.equal(cellText({ k: "str" }, "", false, schema), "");
  assert.deepEqual(parseCell("", { k: "str" }, true, schema), { ok: true, value: undefined });
});

test("칸 글 읽기·쓰기: 목록·레코드·합 타입은 core 문법", () => {
  const { schema } = parseGsd(fx("sum.gsd"));
  const reward = { k: "named", name: "reward" } as const;
  const r = parseCell("gold 650", reward, false, schema);
  assert.deepEqual(r, { ok: true, value: { gold: 650 } });
  assert.equal(cellText(reward, { item: "wooden_sword", count: 1 }, false, schema), "item wooden_sword 1");
  const l = parseCell("[gold 1; exp 2]", { k: "list", of: reward }, false, schema);
  assert.deepEqual(l, { ok: true, value: [{ gold: 1 }, { exp: 2 }] });
  assert.equal(parseCell("[gold x]", { k: "list", of: reward }, false, schema).ok, false);
  assert.equal(summary({ k: "list", of: reward }, [1, 2, 3], false, schema), "[3] ▸");
  assert.equal(summary({ k: "rec", fields: [] }, { a: 1 }, false, schema), "{1} ▸");
  assert.equal(parseCell("{a=x}", { k: "any" }, false, schema).ok, false); // any 는 글이 따옴표
  assert.deepEqual(parseCell('{a="x"}', { k: "any" }, false, schema), { ok: true, value: { a: "x" } });
});

test("고치기: 칸 → 정규 글, 키 중복·빈 키는 막는다", () => {
  const { value, schema } = parseGsd(fx("child.gsd"));
  const m = buildModel(value, schema, { tab: 0, path: ["steps"] })!;
  const p = planCellText(m, m.rows[0]!, m.cols[1]!, "hello", schema, noRef);
  assert.ok(p.ok);
  const c = commit(value, schema, p.ok ? p.edits : []);
  assert.ok(c.ok);
  if (c.ok) {
    assert.match(c.text, /g1 +[|] hello/);
    assert.equal(writeGsd(parseGsd(c.text).value, parseGsd(c.text).schema), c.text); // 멱등
  }
  const dup = planCellText(m, m.rows[0]!, m.cols[0]!, "g2", schema, noRef);
  assert.ok(dup.ok);
  const cd = commit(value, schema, dup.ok ? dup.edits : []);
  assert.equal(cd.ok, false);
  const empty = planCellText(m, m.rows[0]!, m.cols[0]!, "", schema, noRef);
  assert.equal(commit(value, schema, empty.ok ? empty.edits : []).ok, false);
  assert.equal(keyProblem(value, schema), null);
});

test("줄 더하기·복제·지우기 (하위 시트 포함)", () => {
  const { value, schema } = parseGsd(fx("child.gsd"));
  const m = buildModel(value, schema, { tab: 0, path: ["steps"] })!;
  const add = planAddRow(m, schema);
  assert.ok(add.ok);
  const c = commit(value, schema, add.ok ? add.edits : []);
  assert.ok(c.ok);
  if (c.ok) {
    const re = parseGsd(c.text); // 새 줄(키 new)이 읽힌다, 하위 시트 필드는 []
    const steps = (re.value as { steps: { id: string; rewards: unknown[] }[] }).steps;
    assert.equal(steps.length, 4);
    assert.equal(steps[3]!.id, "new");
    assert.deepEqual(steps[3]!.rewards, []);
  }
  const dup = planDuplicate(m, schema, m.rows[0]!);
  const cd = commit(value, schema, dup.ok ? dup.edits : []);
  assert.ok(cd.ok);
  if (cd.ok) assert.equal((cd.value as { steps: { id: string }[] }).steps[1]!.id, "g1_copy");
  const del = planDelete(m, [m.rows[1]!]);
  const cx = commit(value, schema, del.ok ? del.edits : []);
  assert.ok(cx.ok);
  if (cx.ok) assert.deepEqual((cx.value as { steps: { id: string }[] }).steps.map((s) => s.id), ["g1", "g3"]);
  // 맵 시트: 키 바꾸기는 차례를 지킨다
  const mp = parseGsd(fx("map.gsd"));
  const mm = buildModel(mp.value, mp.schema, { tab: 0, path: ["sounds"] })!;
  const rn = planCellText(mm, mm.rows[0]!, mm.cols[0]!, "smash", mp.schema, noRef);
  const cr = commit(mp.value, mp.schema, rn.ok ? rn.edits : []);
  assert.ok(cr.ok);
  if (cr.ok) assert.deepEqual(Object.keys((cr.value as { sounds: object }).sounds), ["smash", "miss", "a.b", ""]);
});

test("붙여넣기: 탭 구분 글, 한 칸이라도 틀리면 계획에 오류가 남는다", () => {
  const { value, schema } = parseGsd(fx("sheet.gsd"));
  const m = buildModel(value, schema, { tab: 0, path: ["mobs"] })!;
  const grid = parseTsv("A\t7\nB\t8\n");
  assert.deepEqual(grid, [["A", "7"], ["B", "8"]]);
  const nameCol = m.cols.findIndex((c) => c.label === "name");
  const plan = planPaste(m, schema, noRef, m.rows, m.cols, 0, nameCol, grid);
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.edits.length, 4);
  const bad = planPaste(m, schema, noRef, m.rows, m.cols, 0, nameCol, parseTsv("A\tx\n")); // hitbox.w 는 int
  assert.equal(bad.errors.length, 1);
  assert.equal(toTsv([["a\tb", 'c"d']]), '"a\tb"\t"c""d"');
});

test("고르기 창 규칙", () => {
  const rows = withCurrent([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], ["x"]);
  assert.equal(rows.find((r) => r.id === "x")?.missing, true);
  const { picked, rest } = layoutRows(rows, ["c", "a"], "");
  assert.deepEqual(picked.map((r) => r.id), ["c", "a"]);
  assert.deepEqual(rest.map((r) => r.id), ["b", "x"]);
  assert.deepEqual(toggleId(["a"], "b", true), ["a", "b"]);
  assert.deepEqual(toggleId(["a"], "b", false), ["b"]);
  assert.deepEqual(moveId(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(idsOfValue(["a", 2]), ["a", "2"]);
  assert.equal(fitChips([80, 80, 80], 100), 1);
});

test("ref/enum 칸의 종류는 후보가 있을 때만 고르기", () => {
  const { value, schema } = parseGsd(ex("items.gsd"));
  const m = buildModel(value, schema, { tab: 0, path: ["items"] })!;
  const kind = m.cols.find((c) => c.label === "rarity")!;
  const s = cellSpec(m, m.rows[0]!, kind, schema, noRef)!;
  assert.equal(s.kind, "enum");
  assert.ok(s.options!.includes("rare"));
  assert.equal(planCellText(m, m.rows[0]!, kind, "bogus", schema, noRef).ok, false);
  assert.equal(m.cols.find((c) => c.label === "price")!.doc, "Shop sell price (gold)");
  const mon = parseGsd(ex("monsters.gsd"));
  const mm = buildModel(mon.value, mon.schema, { tab: 0, path: mon.schema.blocks.find((b) => b.kind === "sheet")!.path })!;
  const refCol = mm.cols.find((c) => c.type.k === "ref" || (c.type.k === "list" && c.type.of.k === "ref"));
  if (refCol) {
    assert.equal(cellSpec(mm, mm.rows[0]!, refCol, mon.schema, noRef)!.kind === "ref" || cellSpec(mm, mm.rows[0]!, refCol, mon.schema, noRef)!.kind === "text", true);
    assert.ok(["ref", "reflist"].includes(cellSpec(mm, mm.rows[0]!, refCol, mon.schema, yesRef)!.kind));
  }
});

test("모든 예시·표본을 표로 그릴 수 있고 정규 글로 되돌아온다", () => {
  const files = [...["items", "monsters", "quests", "dialogue", "config"].map((n) => ex(`${n}.gsd`)), ...["sheet", "child", "sum", "map", "basic", "any", "rootarray", "rootlist", "loose"].map((n) => fx(`${n}.gsd`))];
  for (const text of files) {
    const { value, schema } = parseGsd(text);
    for (const t of tabsOf(schema)) {
      const m = buildModel(value, schema, { tab: t.block, path: [...t.path] });
      assert.ok(m, `${t.name}`);
      for (const r of m!.rows) for (const c of m!.cols) shownOfCell(m!, r, c, schema, yesRef);
    }
    assert.equal(parseGsd(writeGsd(value, schema)).schema.blocks.length, schema.blocks.length);
  }
});

test("자리 글 → 자리, 줄 타입", () => {
  const { value, schema } = parseGsd(fx("child.gsd"));
  assert.deepEqual(locFromText(value, schema, "steps.1.rewards"), { tab: 0, path: ["steps", 1, "rewards"] });
  assert.deepEqual(locFromText(value, schema, "waves"), { tab: 2, path: ["waves"] }.tab === 2 ? { tab: tabsOf(schema)[1]!.block, path: ["waves"] } : null);
  assert.ok(resolveLoc(value, schema, { tab: 0, path: ["steps", 0, "rewards"] }));
  assert.equal(rowType(schema, 0).fields.at(-1)!.name, "rewards");
});

test("정렬·찾기·단위", () => {
  const rows = [{ n: "10" }, { n: "9" }, { n: "x" }];
  const t = (r: { n: string }) => r.n;
  assert.deepEqual(arrange(rows, t, ["n"], "", { col: "n", dir: 1 }).map(t).slice(0, 2), ["9", "10"]);
  assert.deepEqual(arrange(rows, t, ["n"], "1", null).map(t), ["10"]);
  assert.deepEqual(nextSort(null, "a"), { col: "a", dir: 1 });
  assert.equal(nextSort({ col: "a", dir: -1 }, "a"), null);
  assert.equal(unitOf("regen.delayMs"), "ms");
  assert.equal(unitOf("rooms"), null);
  assert.equal(unitOf("crit_pct"), "%");
  assert.equal(unitOf("rate_bp"), "bp");
});

test("계단 스택", () => {
  const spec = (p: (string | number)[]): PopSpec => ({ path: p, title: "", ro: false, anchor: { left: 0, right: 0, top: 0, bottom: 0 } });
  let s = openAt([], 0, spec(["a"]));
  s = openAt(s, 1, spec(["a", 0, "b"]));
  assert.equal(s.length, 2);
  assert.equal(openAt(s, 1, spec(["a", 0, "b"])), s);
  assert.equal(openAt(s, 0, spec(["z"])).length, 1);
  assert.equal(settle(s, 0, 0).length, 0);
  assert.equal(settle(s, 1, 0).length, 1);
  assert.equal(settle(s, 2, 1).length, 2);
  assert.equal(closeTop(s).length, 1);
});
