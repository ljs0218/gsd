import { test } from "node:test";
import assert from "node:assert/strict";
import { addRecent, cleanRecents, removeRecent } from "../src/shared/recents.ts";
import { buildTree, flatten } from "../src/shared/tree.ts";
import { decideExternal } from "../src/shared/external.ts";
import { fuzzyFilter, relTo, wsKey, basename, dirname } from "../src/shared/paths.ts";

test("최근 목록: 맨 앞, 중복 없음, 최대 길이", () => {
  assert.deepEqual(addRecent(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.deepEqual(addRecent(["a", "b"], "z", 2), ["z", "a"]);
  assert.deepEqual(removeRecent(["a", "b"], "a"), ["b"]);
  assert.deepEqual(cleanRecents(["a", 3, "a", "", "b"]), ["a", "b"]);
  assert.deepEqual(cleanRecents({}), []);
});

test("파일 나무: 폴더 먼저, 이름 자연 정렬", () => {
  const t = buildTree(["z.gsd", "sub/b.gsd", "sub/a10.gsd", "sub/a2.gsd", "A.gsd", "deep/x/y.gsd"]);
  assert.deepEqual(t.map((n) => n.name), ["deep", "sub", "A.gsd", "z.gsd"]);
  assert.deepEqual(t[1]!.children.map((n) => n.name), ["a2.gsd", "a10.gsd", "b.gsd"]);
  assert.equal(t[0]!.children[0]!.path, "deep/x");
  const rows = flatten(t, new Set(["sub"]));
  assert.deepEqual(rows.map((r) => r.node.path), ["deep", "deep/x", "deep/x/y.gsd", "sub", "A.gsd", "z.gsd"]);
});

test("바뀜 감지 판단", () => {
  assert.equal(decideExternal("a", "a", "b"), "none"); // 내가 쓴 것의 메아리
  assert.equal(decideExternal("a", "c", "a"), "reload"); // 고침 없음
  assert.equal(decideExternal("a", "c", "c"), "adopt");
  assert.equal(decideExternal("a", "c", "b"), "ask");
});

test("경로 보조와 파일 찾기", () => {
  assert.equal(relTo("/r", "/r/a/b.gsd"), "a/b.gsd");
  assert.equal(relTo("/r", "/rr/b.gsd"), null);
  assert.equal(wsKey("/r", "/x/b.gsd"), "/x/b.gsd");
  assert.equal(basename("/a/b.gsd"), "b.gsd");
  assert.equal(dirname("/a/b.gsd"), "/a");
  const r = fuzzyFilter("mon", ["items.gsd", "data/monsters.gsd", "quests.gsd"]);
  assert.deepEqual(r, ["data/monsters.gsd"]);
  assert.equal(fuzzyFilter("", ["b", "a"]).length, 2);
});
