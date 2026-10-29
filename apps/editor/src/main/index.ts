import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, shell, type MenuItemConstructorOptions } from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AppInfo, MenuAction, Theme } from "../shared/api";
import { isDir, isFile, isGsd, listGsd, readText, toSlash, watchRoot, writeText } from "./files";
import { readSettings, writeSettings, type Settings } from "./settings";
import { addRecent, removeRecent } from "../shared/recents";

let win: BrowserWindow | null = null;
let settings: Settings;
let stopWatch: (() => void) | null = null;
let dirtyCount = 0;
let forceClose = false;
const pendingOpen: string[] = [];
let rendererReady = false;

// 개발 모드에서만 예시 폴더: out/main/index.js → apps/editor → 저장소 루트
function examplesDir(): string | null {
  if (app.isPackaged) return null;
  const root = resolve(__dirname, "../../../..");
  for (const d of ["examples", "fixtures"]) if (isDir(join(root, d))) return toSlash(join(root, d));
  return null;
}

const send = (channel: string, ...a: unknown[]) => win?.webContents.send(channel, ...a);
const menuAction = (a: MenuAction) => send("menu", a);

function queueOpen(path: string) {
  if (!isGsd(path) || !isFile(path)) return;
  const p = toSlash(resolve(path));
  if (rendererReady) send("open-path", p);
  else if (!pendingOpen.includes(p)) pendingOpen.push(p);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}

function applyTheme(t: Theme) {
  nativeTheme.themeSource = t;
}

function buildMenu() {
  const mac = process.platform === "darwin";
  const item = (label: string, accelerator: string | undefined, action: MenuAction): MenuItemConstructorOptions => ({ label, accelerator, click: () => menuAction(action) });
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        item("New File…", "CmdOrCtrl+N", "newFile"),
        item("Open Folder…", "CmdOrCtrl+Shift+O", "openFolder"),
        item("Open File…", "CmdOrCtrl+O", "openFile"),
        { type: "separator" },
        item("Save", "CmdOrCtrl+S", "save"),
        item("Save All", "CmdOrCtrl+Alt+S", "saveAll"),
        item("Save As…", "CmdOrCtrl+Shift+S", "saveAs"),
        { type: "separator" },
        item("Close Tab", "CmdOrCtrl+W", "closeTab"),
        ...(mac ? [] : [{ type: "separator" } as MenuItemConstructorOptions, { role: "quit" } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        item("Undo", "CmdOrCtrl+Z", "undo"),
        item("Redo", mac ? "Shift+Cmd+Z" : "Ctrl+Y", "redo"),
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        item("Go to File…", "CmdOrCtrl+P", "palette"),
      ],
    },
    {
      label: "View",
      submenu: [
        item("Toggle Source View", "CmdOrCtrl+E", "toggleSource"),
        item("Toggle Sidebar", "CmdOrCtrl+B", "toggleSidebar"),
        { type: "separator" },
        {
          label: "Theme",
          submenu: [item("Follow System", undefined, "theme:system"), item("Light", undefined, "theme:light"), item("Dark", undefined, "theme:dark")],
        },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const b = settings.bounds;
  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#16181d" : "#f6f7f9",
    title: "GSD Editor",
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (b.maximized) win.maximize();
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));

  // 화면 안에서 새 창·바깥 주소로 가지 못하게
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault();
  });
  win.webContents.on("did-start-loading", () => {
    rendererReady = false;
  });

  const saveBounds = () => {
    if (!win) return;
    const max = win.isMaximized();
    const r = max ? settings.bounds : win.getBounds();
    settings.bounds = { ...r, maximized: max };
    writeSettings(settings);
  };
  win.on("close", (e) => {
    saveBounds();
    if (forceClose || dirtyCount === 0 || !win) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Cancel", "Don't Save", "Save All"],
      defaultId: 2,
      cancelId: 0,
      message: `You have ${dirtyCount} unsaved file${dirtyCount === 1 ? "" : "s"}`,
      detail: "Your changes will be lost if you don't save them.",
    });
    if (r === 1) {
      forceClose = true;
      win.close();
    } else if (r === 2) menuAction("saveAllThenClose");
  });
  win.on("closed", () => {
    win = null;
    stopWatch?.();
    stopWatch = null;
  });
}

function registerIpc() {
  ipcMain.handle("info", (): AppInfo => ({ examplesDir: examplesDir(), recents: settings.recents, theme: settings.theme, platform: process.platform }));
  ipcMain.handle("pickFolder", async () => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    return r.canceled || !r.filePaths[0] ? null : toSlash(r.filePaths[0]);
  });
  ipcMain.handle("pickFile", async () => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "GSD", extensions: ["gsd"] }] });
    return r.canceled || !r.filePaths[0] ? null : toSlash(r.filePaths[0]);
  });
  ipcMain.handle("pickSavePath", async (_e, defaultPath: string) => {
    if (!win) return null;
    const r = await dialog.showSaveDialog(win, { defaultPath, filters: [{ name: "GSD", extensions: ["gsd"] }] });
    if (r.canceled || !r.filePath) return null;
    return toSlash(isGsd(r.filePath) ? r.filePath : r.filePath + ".gsd");
  });
  ipcMain.handle("listGsd", (_e, root: string) => (isDir(root) ? listGsd(root) : []));
  ipcMain.handle("readAll", (_e, root: string) => {
    const out: Record<string, string> = {};
    if (!isDir(root)) return out;
    for (const p of listGsd(root)) {
      const t = readText(p);
      if (t !== null) out[p] = t;
    }
    return out;
  });
  ipcMain.handle("read", (_e, path: string) => {
    if (!isGsd(path)) return null;
    const text = readText(path);
    return text === null ? null : { text };
  });
  ipcMain.handle("write", (_e, path: string, text: string) => (typeof text === "string" ? writeText(path, text) : { ok: false, error: "bad text" }));
  ipcMain.handle("watch", (_e, root: string | null) => {
    stopWatch?.();
    stopWatch = root && isDir(root) ? watchRoot(root, (paths) => send("fs-changed", paths)) : null;
  });
  ipcMain.handle("addRecent", (_e, root: string) => {
    settings.recents = addRecent(settings.recents, root);
    writeSettings(settings);
    return settings.recents;
  });
  ipcMain.handle("removeRecent", (_e, root: string) => {
    settings.recents = removeRecent(settings.recents, root);
    writeSettings(settings);
    return settings.recents;
  });
  ipcMain.handle("setTheme", (_e, t: Theme) => {
    settings.theme = t === "light" || t === "dark" ? t : "system";
    applyTheme(settings.theme);
    writeSettings(settings);
  });
  ipcMain.handle("confirm", async (_e, o: { message: string; detail?: string; buttons: string[]; danger?: boolean }) => {
    if (!win) return 0;
    const r = await dialog.showMessageBox(win, { type: o.danger ? "warning" : "question", buttons: o.buttons, defaultId: 0, cancelId: o.buttons.length - 1, message: o.message, detail: o.detail });
    return r.response;
  });
  ipcMain.on("dirty", (_e, n: number) => {
    dirtyCount = Number.isFinite(n) ? n : 0;
    win?.setDocumentEdited(dirtyCount > 0);
  });
  ipcMain.on("closeNow", () => {
    forceClose = true;
    win?.close();
  });
  ipcMain.on("reveal", (_e, p: string) => shell.showItemInFolder(p));
  ipcMain.handle("takePendingOpen", () => {
    rendererReady = true;
    return pendingOpen.splice(0);
  });
}

const single = app.requestSingleInstanceLock();
if (!single) app.quit();

app.on("second-instance", (_e, argv) => {
  for (const a of argv.slice(1)) if (isGsd(a) && existsSync(a)) queueOpen(a);
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on("open-file", (e, path) => {
  e.preventDefault();
  queueOpen(path);
});

void app.whenReady().then(() => {
  settings = readSettings();
  applyTheme(settings.theme);
  registerIpc();
  buildMenu();
  for (const a of process.argv.slice(1)) if (isGsd(a) && existsSync(a)) queueOpen(a);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
