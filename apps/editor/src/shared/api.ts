// 화면(renderer) ↔ 메인 프로세스 약속. preload 가 이 겉만 연다. 경로는 모두 "/" 구분 절대 경로.

export interface AppInfo {
  /** 개발 모드(패키징 안 됨)에서만 값이 있다 — 저장소의 examples/ (없으면 fixtures/) */
  examplesDir: string | null;
  recents: string[];
  theme: Theme;
  platform: string;
}

export type Theme = "system" | "light" | "dark";

export interface FileData {
  text: string;
}

export interface Api {
  info(): Promise<AppInfo>;
  pickFolder(): Promise<string | null>;
  pickFile(): Promise<string | null>;
  /** 저장 위치 고르기 (다른 이름으로 / 새 파일) */
  pickSavePath(defaultPath: string): Promise<string | null>;
  /** 폴더 안의 모든 .gsd 의 절대 경로 (점 폴더·node_modules 제외) */
  listGsd(root: string): Promise<string[]>;
  /** 폴더 안 모든 .gsd 의 글 — 작업 공간용 */
  readAll(root: string): Promise<Record<string, string>>;
  read(path: string): Promise<FileData | null>;
  write(path: string, text: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** 이 폴더를 지켜본다 (하나만). 바뀐 절대 경로들을 onFsChanged 로 알린다. */
  watch(root: string | null): Promise<void>;
  addRecent(root: string): Promise<string[]>;
  removeRecent(root: string): Promise<string[]>;
  setTheme(theme: Theme): Promise<void>;
  /** 메시지 상자: 누른 단추의 번호 */
  confirm(opts: { message: string; detail?: string; buttons: string[]; danger?: boolean }): Promise<number>;
  setDirty(count: number): void;
  /** 닫기 확인에서 "모두 저장" 을 골랐고 저장이 끝났다 — 이제 닫는다 */
  closeNow(): void;
  reveal(path: string): void;
  onFsChanged(cb: (paths: string[]) => void): () => void;
  /** 메뉴·단축키 */
  onMenu(cb: (action: MenuAction) => void): () => void;
  /** 파일 연결·Dock 으로 열라고 온 경로 */
  onOpenPath(cb: (path: string) => void): () => void;
  /** 화면이 켜지기 전에 온 열기 요청들 */
  takePendingOpen(): Promise<string[]>;
}

export type MenuAction =
  | "openFolder"
  | "openFile"
  | "newFile"
  | "save"
  | "saveAll"
  | "saveAs"
  | "closeTab"
  | "undo"
  | "redo"
  | "toggleSource"
  | "palette"
  | "toggleSidebar"
  | "theme:system"
  | "theme:light"
  | "theme:dark"
  | "saveAllThenClose";
