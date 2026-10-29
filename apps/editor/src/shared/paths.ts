// 경로 다루기 — 화면 쪽은 node:path 를 못 쓴다. 모든 경로는 "/" 구분으로 주고받는다.

export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirname = (p: string) => {
  const i = p.lastIndexOf("/");
  return i <= 0 ? (i === 0 ? "/" : "") : p.slice(0, i);
};

/** root 안이면 상대 경로, 밖이면 null. */
export function relTo(root: string | null, abs: string): string | null {
  if (!root) return null;
  const r = root.endsWith("/") ? root : root + "/";
  return abs.startsWith(r) ? abs.slice(r.length) : null;
}

/** 작업 공간 안의 키: 안이면 상대 경로, 밖이면 절대 경로 그대로. */
export const wsKey = (root: string | null, abs: string) => relTo(root, abs) ?? abs;

/** 파일 찾기용 부분 순서 일치. 점수가 낮을수록 좋다 (null = 안 맞음). 이름 쪽 일치를 더 쳐 준다. */
export function fuzzyScore(query: string, path: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const p = path.toLowerCase();
  const nameStart = p.lastIndexOf("/") + 1;
  let pi = 0;
  let score = 0;
  let prev = -2;
  for (const ch of q) {
    const at = p.indexOf(ch, pi);
    if (at < 0) return null;
    score += at - pi; // 건너뛴 만큼 벌점
    if (at === prev + 1) score -= 1; // 이어진 글자 보너스
    if (at >= nameStart) score -= 0.5; // 파일 이름 안쪽 보너스
    prev = at;
    pi = at + 1;
  }
  return score + p.length * 0.01;
}

export function fuzzyFilter(query: string, paths: readonly string[], limit = 50): string[] {
  const scored: { p: string; s: number }[] = [];
  for (const p of paths) {
    const s = fuzzyScore(query, p);
    if (s !== null) scored.push({ p, s });
  }
  scored.sort((a, b) => a.s - b.s || a.p.localeCompare(b.p));
  return scored.slice(0, limit).map((x) => x.p);
}
