# 패키지 사이 약속 (병렬 작업용)

세 갈래가 동시에 만든다. 서로의 코드를 기다리지 않도록 경계를 여기서 정한다. 바꿔야 하면 보고에 적는다.

## 폴더

```
SPEC.md                 형식 명세
fixtures/               공용 표본 (모든 언어 파서가 통과)
packages/core           @gsd/core — parse·write·infer·format (+ 이번에: @ref·@enum·@doc, 작업 공간 참조 풀이)
packages/cli            @gsd/cli — convert·fmt·json
packages/sheet          @gsd/sheet — React 시트 편집 컴포넌트 (앱과 다른 프로그램이 같이 쓴다)
apps/editor             GSD Editor — Electron 데스크톱 앱 (파일·폴더 열기, 저장, 되돌리기)
examples/               예시 데이터 (게임 하나를 지어낸 것 — 실제 게임 데이터 아님)
README.md, README.ko.md
```

## @gsd/core 가 더하는 것 (core 갈래)

명세에 지시문 셋을 더한다 (읽기 전용 꼬리표 — 값 트리에는 영향 없음, 스키마에만 남는다):

- `@enum <이름> = a | b | c` — `enum(이름)` 열의 고를 값.
- `@ref <종류> = <파일>#<시트 경로>.<키 열>` — `ref(종류)` 열이 가리키는 곳. 파일은 같은 작업 공간(폴더) 기준 상대 경로. 같은 파일이면 `#` 앞을 비운다. 선택: `label=<열>` `icon=<열>`.
- `@doc <시트 경로>.<열> = 설명` — 열 설명 (편집기가 머리 툴팁으로 보인다).

공개 API (이름·모양 고정):

```ts
export type Workspace = Map<string /* 상대 경로 */, { text: string; parsed?: ParsedGsd; error?: GsdError }>;
export interface RefOption { id: string | number; label?: string; icon?: string; file: string; sheet: string }
export function loadWorkspace(files: Record<string, string>): Workspace;
export function refOptions(ws: Workspace, fromFile: string, kind: string): RefOption[];   // @ref 를 따라 키 목록
export function enumOptions(parsed: ParsedGsd, name: string): string[];
export function checkRefs(ws: Workspace): { file: string; line: number; message: string }[]; // 없는 키를 가리키는 칸
```

`ParsedGsd` 는 지금 `parseGsd` 가 돌려주는 `{ value, schema }` 그대로 (schema 에 enums·refs·docs 를 더함).

## @gsd/sheet 의 겉 (sheet 갈래 — 앱 갈래는 이것만 믿는다)

```tsx
import { GsdBook, type GsdBookHandle } from "@gsd/sheet";
import "@gsd/sheet/style.css";

<GsdBook
  ref={handle}                 // GsdBookHandle: focusSearch(), openPath(path: string)
  path="items.gsd"             // 머리·오류 표시용
  text={text}                  // 파일 글 전체. 바뀌면 다시 읽되 선택·스크롤·열린 시트는 지킨다
  onChange={(next: string) => …}  // 사용자가 고칠 때마다 정규 출력(writeGsd) 글 하나
  refs={(kind: string) => RefOption[]}   // 앱이 작업 공간에서 풀어 준다 (없으면 글 칸)
  readOnly={false}
  theme="dark" | "light"
/>
```

- 되돌리기·저장은 앱이 맡는다 (앱이 글 이력을 쥐고 `text` 를 바꿔 준다). 시트는 Cmd/Ctrl+Z 를 먹지 않고 그대로 올려 보낸다.
- 파일 글이 틀려 읽을 수 없으면 오류 줄·까닭과 "글로 보기" 를 보인다 (고치기는 앱의 글 편집 칸).
- 시트 탭 = `@sheet`·`@props` 블록. 하위 시트는 칸 ▸ 로 들어가고, 칸에 마우스를 두면 판이 계단식으로 뜬다.

## apps/editor (앱 갈래)

- Electron + Vite + React. 개발 서버 포트 5180 고정 (다른 앱이 5173 을 쓴다).
- `@gsd/sheet` 가 아직 없으면 같은 겉의 임시 컴포넌트(글 칸)로 먼저 만들고, 진짜가 들어오면 바꿔 끼운다.
