/*
  칸 판의 계단 스택 규칙 (순수 함수). 화면·타이머는 CellPop.tsx.
    - 판은 겹쳐 쌓인다: 메인 시트 칸 → 판 0, 판 0 안의 칸 → 판 1 …. 층(level) = 칸이 든 곳 (메인 시트 0, 판 i 는 i+1).
    - 칸 위에 마우스를 두면 그 층의 판이 그 칸의 것으로 바뀌고, 더 깊은 판은 닫힌다.
    - 마우스가 어느 판·그 판을 연 칸에도 없으면 닫힌다. 마우스·포커스가 걸친 가장 깊은 판까지는 남긴다.
*/
import type { Tok } from "./types.ts";

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 판 하나: 칸 값의 자리(경로), 머리 글, 읽기 전용 여부, 붙을 자리. 값은 그때그때 읽는다. */
export interface PopSpec {
  path: Tok[];
  title: string;
  ro: boolean;
  anchor: Rect;
}

export const samePlace = (a: { path: Tok[] }, b: { path: Tok[] }) => a.path.length === b.path.length && a.path.every((k, i) => k === b.path[i]);

/** 층 level 의 칸이 판을 연다: 그 층 이후는 이 판 하나로 바뀐다. 같은 칸이면 그대로. */
export function openAt(stack: PopSpec[], level: number, spec: PopSpec): PopSpec[] {
  const cur = stack[level];
  if (cur && samePlace(cur, spec)) return stack;
  return [...stack.slice(0, level), spec];
}

/** 판 n 개만 남기고 닫는다. */
export const keepFirst = (stack: PopSpec[], n: number): PopSpec[] => (n >= stack.length ? stack : stack.slice(0, Math.max(0, n)));

/** Esc: 맨 위 판 하나. */
export const closeTop = (stack: PopSpec[]): PopSpec[] => stack.slice(0, -1);

/** 잠깐 뒤 정리: 마우스가 걸친 곳(hover)과 포커스가 있는 판(focus) 중 더 깊은 쪽까지 남긴다. */
export const settle = (stack: PopSpec[], hover: number, focus: number): PopSpec[] => keepFirst(stack, Math.max(hover, focus));
