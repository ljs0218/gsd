// 정렬·찾기
export const natural = (a: string, b: string): number => {
  const x = Number(a.replace(/,/g, ""));
  const y = Number(b.replace(/,/g, ""));
  return a !== "" && b !== "" && !isNaN(x) && !isNaN(y) ? x - y : a.localeCompare(b);
};

export interface SortState {
  col: string;
  dir: 1 | -1;
}

/** 머리를 누를 때마다: 없음 → 오름 → 내림 → 없음 */
export function nextSort(cur: SortState | null, col: string): SortState | null {
  if (!cur || cur.col !== col) return { col, dir: 1 };
  return cur.dir === 1 ? { col, dir: -1 } : null;
}

/** 찾기(칸 글에 들어 있는가) + 정렬. 원래 줄 번호가 아니라 줄 자체의 새 차례를 돌려준다. */
export function arrange<R>(rows: R[], textOf: (r: R, colId: string) => string, colIds: string[], q: string, sort: SortState | null): R[] {
  let list = rows;
  const needle = q.trim().toLowerCase();
  if (needle) list = list.filter((r) => colIds.some((c) => textOf(r, c).toLowerCase().includes(needle)));
  if (sort) {
    const s = sort;
    list = [...list].sort((x, y) => natural(textOf(x, s.col), textOf(y, s.col)) * s.dir);
  }
  return list;
}
