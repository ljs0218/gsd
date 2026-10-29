// userData/settings.json — 창 크기·최근 폴더·테마. 읽기 실패는 기본값으로.
import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "../shared/api";
import { cleanRecents } from "../shared/recents";

export interface Settings {
  recents: string[];
  theme: Theme;
  bounds: { x?: number; y?: number; width: number; height: number; maximized?: boolean };
}

const file = () => join(app.getPath("userData"), "settings.json");

export function readSettings(): Settings {
  let raw: any = {};
  try {
    raw = JSON.parse(readFileSync(file(), "utf8"));
  } catch {
    /* 첫 실행·깨진 파일 */
  }
  const b = raw?.bounds ?? {};
  return {
    recents: cleanRecents(raw?.recents),
    theme: raw?.theme === "light" || raw?.theme === "dark" ? raw.theme : "system",
    bounds: {
      x: Number.isFinite(b.x) ? b.x : undefined,
      y: Number.isFinite(b.y) ? b.y : undefined,
      width: Number.isFinite(b.width) && b.width >= 640 ? b.width : 1280,
      height: Number.isFinite(b.height) && b.height >= 420 ? b.height : 820,
      maximized: b.maximized === true,
    },
  };
}

export function writeSettings(s: Settings): void {
  try {
    writeFileSync(file(), JSON.stringify(s, null, 2));
  } catch {
    /* 못 써도 앱은 계속 */
  }
}
