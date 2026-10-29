// 책 안의 화면들이 같이 쓰는 것 (React 맥락)
import { createContext, useContext } from "react";
import type { Edit } from "./model/edit.ts";
import type { RefOption, Schema, Tok } from "./model/types.ts";
import type { Rect } from "./model/popstack.ts";
import type { SortState } from "./model/sort.ts";

/** 시트를 떠났다 돌아와도 남길 화면 상태 (선택·정렬·스크롤) */
export interface GridMemo {
  sel: { a: { r: number; c: number }; b: { r: number; c: number } };
  sort: SortState | null;
  scrollTop: number;
  scrollLeft: number;
  q: string;
}

export interface BookCtx {
  schema: Schema;
  value: unknown;
  tab: number;
  readOnly: boolean;
  /** 이 종류의 후보를 풀 수 있는가 / 후보 */
  refOk: (kind: string) => boolean;
  refOpts: (kind: string) => RefOption[];
  /** 고침 적용: 쓸 수 없으면 까닭을 돌려준다 */
  apply: (edits: Edit[]) => string | null;
  toast: (msg: string, kind?: "ok" | "err" | "info") => void;
  /** 이 탭 안에서 값 트리의 이 자리로 들어간다 */
  drill: (path: Tok[]) => void;
  memo: Map<string, GridMemo>;
  /** 열 너비 (책이 기억한다) */
  widths: { get: (key: string) => Record<string, number>; set: (key: string, w: Record<string, number>) => void };
  searchRef: React.RefObject<HTMLInputElement>;
}

export const Ctx = createContext<BookCtx | null>(null);
export const useBook = (): BookCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error("GsdBook 안에서만 쓴다");
  return c;
};

export type { Rect };
