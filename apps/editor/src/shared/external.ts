// 바깥에서 파일이 바뀌었을 때 어떻게 할지. 판단만 — 읽기·묻기는 앱이 한다.
//  - lastDisk: 마지막으로 알고 있는 디스크 글 (우리가 저장한 것 포함)
//  - diskNow:  지금 디스크 글
//  - buffer:   편집 칸의 글

export type ExternalAction = "none" | "reload" | "adopt" | "ask";

export function decideExternal(lastDisk: string, diskNow: string, buffer: string): ExternalAction {
  if (diskNow === lastDisk) return "none"; // 우리가 쓴 것의 메아리, 또는 건드리지 않음
  if (buffer === lastDisk) return "reload"; // 고친 것이 없다: 조용히 다시 읽는다
  if (buffer === diskNow) return "adopt"; // 같은 글로 바뀌었다: 기준만 옮긴다
  return "ask"; // 고친 것도 있고 디스크도 달라졌다
}
