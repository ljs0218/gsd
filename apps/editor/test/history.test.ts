import { test } from "node:test";
import assert from "node:assert/strict";
import { canRedo, canUndo, createHistory, isDirty, loadExternal, markSaved, push, redo, undo } from "../src/shared/history.ts";

test("push·undo·redo", () => {
  let h = createHistory("a");
  assert.equal(isDirty(h), false);
  h = push(h, "b", 0);
  h = push(h, "c", 5000);
  assert.equal(h.present, "c");
  assert.equal(isDirty(h), true);
  h = undo(h);
  assert.equal(h.present, "b");
  assert.ok(canRedo(h));
  h = redo(h);
  assert.equal(h.present, "c");
  h = undo(undo(h));
  assert.equal(h.present, "a");
  assert.equal(canUndo(h), false);
  assert.equal(isDirty(h), false);
});

test("새로 고치면 다시 목록이 비고, 같은 글은 무시", () => {
  let h = createHistory("a");
  h = push(h, "b");
  h = undo(h);
  h = push(h, "x");
  assert.equal(canRedo(h), false);
  assert.equal(push(h, "x"), h);
});

test("같은 묶음이 짧은 간격이면 한 걸음", () => {
  let h = createHistory("");
  h = push(h, "a", 0, "text"); // 첫 걸음
  h = push(h, "ab", 100, "text");
  h = push(h, "abc", 200, "text");
  assert.equal(h.past.length, 1);
  h = push(h, "abcd", 5000, "text"); // 간격이 길면 새 걸음
  assert.equal(h.past.length, 2);
  h = push(h, "abcde", 5100, "book"); // 묶음이 다르면 새 걸음
  assert.equal(h.past.length, 3);
  assert.equal(undo(h).present, "abcd");
});

test("저장 표시", () => {
  let h = push(createHistory("a"), "b");
  h = markSaved(h);
  assert.equal(isDirty(h), false);
  h = undo(h);
  assert.equal(isDirty(h), true);
});

test("바깥 변경을 읽어 오면 되돌릴 수 있고 저장됨", () => {
  let h = loadExternal(createHistory("a"), "z");
  assert.equal(isDirty(h), false);
  assert.equal(undo(h).present, "a");
});
