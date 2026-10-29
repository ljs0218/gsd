import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "../shared/api";

const on = <T extends unknown[]>(channel: string, cb: (...a: T) => void) => {
  const h = (_: unknown, ...a: unknown[]) => cb(...(a as T));
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

// 화면에 여는 것은 이 목록뿐 (ipcRenderer 자체는 내놓지 않는다).
const api: Api = {
  info: () => ipcRenderer.invoke("info"),
  pickFolder: () => ipcRenderer.invoke("pickFolder"),
  pickFile: () => ipcRenderer.invoke("pickFile"),
  pickSavePath: (p) => ipcRenderer.invoke("pickSavePath", p),
  listGsd: (r) => ipcRenderer.invoke("listGsd", r),
  readAll: (r) => ipcRenderer.invoke("readAll", r),
  read: (p) => ipcRenderer.invoke("read", p),
  write: (p, t) => ipcRenderer.invoke("write", p, t),
  watch: (r) => ipcRenderer.invoke("watch", r),
  addRecent: (r) => ipcRenderer.invoke("addRecent", r),
  removeRecent: (r) => ipcRenderer.invoke("removeRecent", r),
  setTheme: (t) => ipcRenderer.invoke("setTheme", t),
  confirm: (o) => ipcRenderer.invoke("confirm", o),
  setDirty: (n) => ipcRenderer.send("dirty", n),
  closeNow: () => ipcRenderer.send("closeNow"),
  reveal: (p) => ipcRenderer.send("reveal", p),
  onFsChanged: (cb) => on("fs-changed", cb),
  onMenu: (cb) => on("menu", cb),
  onOpenPath: (cb) => on("open-path", cb),
  takePendingOpen: () => ipcRenderer.invoke("takePendingOpen"),
};

contextBridge.exposeInMainWorld("gsd", api);
