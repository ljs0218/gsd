// 파일 하나의 글 이력 (되돌리기/다시). 글 전체를 쌓는다 — .gsd 는 작아서 충분하다.

export interface History {
  past: string[];
  present: string;
  future: string[];
  /** 디스크에 있는 글 (저장됨 표시의 기준) */
  saved: string;
  /** 마지막 push 의 묶음 이름과 시각 — 같은 묶음이 짧은 간격으로 이어지면 한 걸음으로 합친다 */
  group: string | null;
  at: number;
}

export const MAX_PAST = 500;
export const MERGE_MS = 800;

export function createHistory(text: string): History {
  return { past: [], present: text, future: [], saved: text, group: null, at: 0 };
}

/** 새 글을 쌓는다. 같은 글이면 그대로. group 이 같고 간격이 짧으면 앞 걸음에 합친다 (글자 하나마다 걸음이 생기지 않게). */
export function push(h: History, text: string, now = 0, group: string | null = null): History {
  if (text === h.present) return h;
  const merge = group !== null && h.group === group && now - h.at <= MERGE_MS && h.past.length > 0;
  const past = merge ? h.past : [...h.past, h.present].slice(-MAX_PAST);
  return { ...h, past, present: text, future: [], group, at: now };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1]!;
  return { ...h, past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], group: null };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { ...h, past: [...h.past, h.present], present: next!, future: rest, group: null };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;
export const isDirty = (h: History) => h.present !== h.saved;

/** 저장했다: 지금 글이 디스크 글이다. */
export function markSaved(h: History, text = h.present): History {
  return { ...h, saved: text };
}

/** 바깥에서 파일이 바뀌어 다시 읽었다: 새 글을 이력에 쌓고 (되돌릴 수 있다) 저장됨으로 본다. */
export function loadExternal(h: History, text: string): History {
  const n = push(h, text);
  return { ...n, saved: text, group: null };
}
