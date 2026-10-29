// 복사·붙여넣기 (탭 구분 글 — 스프레드시트와 주고받는다)
import { planCellText, type Edit } from "./edit.ts";
import { textOfCell, type SCol, type SRow, type SheetModel } from "./view.ts";
import type { Schema } from "./types.ts";

export function toTsv(grid: string[][]): string {
  const q = (s: string) => (/[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return grid.map((r) => r.map(q).join("\t")).join("\n");
}

export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  let started = false;
  const t = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') (cur += '"', i++);
        else quoted = false;
      } else cur += c;
    } else if (c === '"' && cur === "" && !started) {
      quoted = true;
      started = true;
    } else if (c === "\t") {
      row.push(cur);
      cur = "";
      started = false;
    } else if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      started = false;
    } else {
      cur += c;
      started = true;
    }
  }
  if (cur !== "" || row.length || started) {
    row.push(cur);
    rows.push(row);
  }
  // 스프레드시트가 붙이는 끝의 빈 줄 하나
  if (rows.length > 1 && rows[rows.length - 1]!.length === 1 && rows[rows.length - 1]![0] === "" && /\n$/.test(t)) rows.pop();
  return rows;
}

/** 선택 범위를 글로 */
export function rangeText(model: SheetModel, rows: SRow[], cols: SCol[], schema: Schema, refOk: (k: string) => boolean): string {
  return toTsv(rows.map((r) => cols.map((c) => textOfCell(model, r, c, schema, refOk))));
}

export interface PasteResult {
  edits: Edit[];
  errors: string[];
  /** 시트 밖이라 버린 칸 */
  overflow: number;
  skipped: number;
}

/** (r0, c0) 부터 grid 를 붙이는 계획. 틀린 칸이 하나라도 있으면 호출한 쪽이 통째로 거절한다. */
export function planPaste(model: SheetModel, schema: Schema, refOk: (k: string) => boolean, rows: SRow[], cols: SCol[], r0: number, c0: number, grid: string[][]): PasteResult {
  const out: PasteResult = { edits: [], errors: [], overflow: 0, skipped: 0 };
  grid.forEach((line, i) =>
    line.forEach((text, j) => {
      const row = rows[r0 + i];
      const col = cols[c0 + j];
      if (!row || !col) return void out.overflow++;
      const p = planCellText(model, row, col, text, schema, refOk);
      if (!p.ok) {
        // 이 줄에 없는 칸·보기만 칸은 건너뛴다
        if (p.why === "read-only cell" || p.why.startsWith("this cell does not apply")) return void out.skipped++;
        out.errors.push(`row ${i + 1}, column ${j + 1}: ${p.why}`);
      } else out.edits.push(...p.edits);
    }),
  );
  return out;
}
