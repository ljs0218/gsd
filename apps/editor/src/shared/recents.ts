// 최근 폴더 목록: 맨 앞이 가장 최근, 중복 없음, 최대 길이 제한.

export const MAX_RECENT = 10;

export function addRecent(list: readonly string[], path: string, max = MAX_RECENT): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, max);
}

export function removeRecent(list: readonly string[], path: string): string[] {
  return list.filter((p) => p !== path);
}

/** 디스크에서 읽은 글(JSON)이 깨졌어도 문자열 목록만 건진다. */
export function cleanRecents(raw: unknown, max = MAX_RECENT): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) if (typeof x === "string" && x && !out.includes(x)) out.push(x);
  return out.slice(0, max);
}
