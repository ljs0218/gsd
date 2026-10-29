// .gsd 파일 읽기·쓰기·훑기. 경로는 화면과 "/" 구분으로 주고받는다.
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import { dirname, join, sep } from "node:path";

export const toSlash = (p: string) => (sep === "\\" ? p.replaceAll("\\", "/") : p);
export const isGsd = (p: string) => p.toLowerCase().endsWith(".gsd");

const SKIP = new Set(["node_modules", "out", "dist", "target", "release"]);

/** 폴더 아래 모든 .gsd (점으로 시작하는 폴더·빌드 폴더 제외). 정렬은 화면이 한다. */
export function listGsd(root: string, limit = 5000): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let names: import("node:fs").Dirent[];
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names) {
      if (out.length >= limit) return;
      if (e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(p);
      } else if (e.isFile() && isGsd(e.name)) out.push(toSlash(p));
    }
  };
  walk(root);
  return out;
}

export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** 임시 파일에 쓰고 바꿔치기 — 쓰다 죽어도 원본이 반쯤 깨지지 않게. */
export function writeText(path: string, text: string): { ok: true } | { ok: false; error: string } {
  if (!isGsd(path)) return { ok: false, error: "Only .gsd files can be written" };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, path);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
export const isFile = (p: string) => existsSync(p) && !isDir(p);

/** 폴더를 지켜보며 바뀐 경로를 모아 한 번에 알린다. 반환: 멈추는 함수. */
export function watchRoot(root: string, onChange: (paths: string[]) => void): () => void {
  let w: FSWatcher | null = null;
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  try {
    w = watch(root, { recursive: true }, (_ev, name) => {
      if (!name) return;
      const rel = name.toString();
      if (rel.split(/[\\/]/).some((s) => s.startsWith(".") || SKIP.has(s))) return;
      if (!isGsd(rel) && rel.includes(".")) return; // 폴더(점 없는 이름)는 통과 — 추가·삭제 감지
      pending.add(toSlash(join(root, rel)));
      timer ??= setTimeout(() => {
        const list = [...pending];
        pending = new Set();
        timer = null;
        onChange(list);
      }, 150);
    });
    w.on("error", () => {});
  } catch {
    /* 지켜보지 못해도 앱은 동작 (수동 새로고침 없음 — 저장 시점에 비교) */
  }
  return () => {
    if (timer) clearTimeout(timer);
    w?.close();
  };
}
