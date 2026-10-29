// 앱 상태의 모양과 순수한 보조 함수.
import type { History } from "../shared/history";

export interface Doc {
  /** 절대 경로 ("/" 구분) */
  path: string;
  hist: History;
  view: "book" | "source";
  goto?: { line: number; n: number };
}

export interface RefIssue {
  file: string;
  line: number;
  message: string;
}

export const GSD_TEMPLATE = "@sheet rows key=id\nid:str | name:str\n";

export const countLines = (text: string) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));
