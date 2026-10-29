<div align="center">

<img src="docs/assets/logo.svg" width="96" height="96" alt="GSD 로고">

# GSD

**시트처럼 생기고, 타입이 있고, 나무처럼 겹쳐지는 데이터용 글 형식.**<br>
시트처럼 고치고, 코드처럼 diff 보고, JSON 처럼 읽는다.

[English](README.md) · **한국어** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-22%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-core%20%C2%B7%20sheet%20%C2%B7%20cli-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-reader-DEA584?logo=rust&logoColor=black)
![Lua](https://img.shields.io/badge/Lua%205.1%20%2F%20LuaJIT-reader-2C2D72?logo=lua&logoColor=white)
![Status](https://img.shields.io/badge/status-pre--release-orange)

<img src="docs/assets/editor.png" alt="GSD 에디터: 몬스터 시트에서 드랍 하위 시트를 띄운 모습" width="900">

<sub>GSD 에디터 — <code>[…]</code>·<code>{…}</code> 칸에 마우스를 대면 안쪽 데이터가 시트로 한 장 더 열린다.</sub>

</div>

---

## 왜 GSD 인가

표 데이터를 다루는 사람 — 게임 기획자, 번역가, 설정이 커져 버린 누구든 — 은 결국 **스프레드시트** (고치기는 쉽지만 diff·병합이 어렵다) 와 **JSON/YAML** (프로그램엔 좋지만 몬스터 150마리 표엔 괴롭다) 사이에서 고르게 된다. GSD 는 둘 다 되는 글 형식 하나다.

|  | JSON | YAML | CSV | **GSD** |
|---|:---:|:---:|:---:|:---:|
| 한 줄 = 한 기록, 작은 diff | ✗ | ✗ | ✓ | **✓** |
| 파일 안에 열 타입 | ✗ | ✗ | ✗ | **✓** |
| 중첩 객체·배열 | ✓ | ✓ | ✗ | **✓** |
| 파일 사이 참조 검사 | ✗ | ✗ | ✗ | **✓** |
| 값 하나에 글 하나 (정규형) | ✗ | ✗ | ✗ | **✓** |
| 시트로 열림 | ✗ | ✗ | ✓ | **✓** |

`.gsd` 파일을 읽으면 **JSON 과 똑같은 나무** (객체·배열·문자열·숫자·참거짓·null) 가 나오고, 어떤 JSON 나무든 GSD 로 다시 쓸 수 있다. 프로그램은 평범한 값을 그대로 쓴다.

## ✨ 특징

- 🧮 **시트 모양** — 블록 하나가 시트, 줄 하나가 기록, 열은 `|` 로 맞춘다.
- 🏷️ **타입** — `int`, `num`, `str`, `bool`, `[T]`, `{a:T}`, 합 타입, `enum(…)`, `ref(…)` 를 머리 줄에 적는다.
- 🌳 **나무** — 점 열 (`stats.hp`), 자식 시트 (`^` 열), 칸 안 `[a; b]` / `{k=v}`.
- 🔗 **참조** — `@ref` 로 열이 다른 파일의 열쇠를 가리킨다. 도구가 고를 수 있는 값을 보여 주고 없는 열쇠를 잡는다.
- 📝 **선택지와 설명이 데이터와 같이** — `@enum`·`@doc` 으로 에디터가 고르기 목록과 툴팁을 띄운다.
- 🔁 **손실 없음·정규형** — JSON ⇄ GSD 왕복, 서식은 몇 번 돌려도 같다.
- 🖥️ **에디터 포함** — GSD 를 시트로 고치는 데스크톱 앱과 React 컴포넌트.

## 맛보기

`examples/monsters.gsd` — 능력치는 점 열, 드랍은 자식 시트:

```
@ref item = items.gsd#items.id label=name icon=icon

@sheet monsters key=id
id:str     | name:str    | icon:str | element:enum(element) | stats.hp:int | stats.atk:int | stats.def:int | stats.speed:num
slime      | Green Slime | 🟢       | poison                | 30           | 4             | 1             | 0.8
cave_bat   | Cave Bat    | 🦇       | none                  | 22           | 6             | 0             | 1.6

@sheet monsters.drops
^        | item:ref(item) | chance:int | min:int | max:int
slime    | slime_gel      | 6000       | 1       | 2
cave_bat | slime_gel      | 1500       | 1       | 1
```

읽으면

```json
{ "monsters": [
  { "id": "slime", "name": "Green Slime", "icon": "🟢", "element": "poison",
    "stats": { "hp": 30, "atk": 4, "def": 1, "speed": 0.8 },
    "drops": [ { "item": "slime_gel", "chance": 6000, "min": 1, "max": 2 } ] },
  …
] }
```

<details>
<summary><b>더 보기: 합 타입·enum·설명</b> (<code>examples/quests.gsd</code>)</summary>

```
@type reward = {gold:int} | {exp:int} | {item:ref(item) count:int}
@enum goalKind = kill | collect | talk
@doc quests.rewards = Rewards granted on completion

@sheet quests key=id
id:str        | title:str     | level:int | goal:{kind:enum(goalKind) monster:ref(monster)? item:ref(item)? count:int} | rewards:[reward]
slime_trouble | Slime Trouble | 1         | {kind=kill; monster=slime; count=5}                                        | [gold 80; exp 40]
```

`[gold 80; exp 40]` 는 `[{gold=80}; {exp=40}]` 의 줄임꼴이다. `examples/dialogue.gsd` 는 `next` 열이 `ref(node)` 인 대화 나무, `examples/config.gsd` 는 `@props` 로 적은 이름 붙은 값이다.

</details>

## 🚀 시작하기

> 아직 npm·crates.io 에 올리지 않았다 — 저장소를 받아서 쓴다.

```sh
git clone https://github.com/ljs0218/gsd.git && cd gsd
pnpm i
pnpm test

node packages/cli/gsd.mjs json examples/items.gsd          # 나무를 JSON 으로 출력
node packages/cli/gsd.mjs convert some.json -o some.gsd     # JSON → GSD, 스키마 추정
node packages/cli/gsd.mjs fmt examples/*.gsd --check        # 모두 정규형인가?
node packages/cli/gsd.mjs check examples                    # @ref 열쇠가 다 있는가?
```

에디터 열기:

```sh
pnpm --filter gsd-editor dev
```

Node 22 이상이 필요하다 (CLI 가 TypeScript 소스를 바로 돌린다).

## 📖 문법 한눈에

| 요소 | 쓰는 법 | 뜻 |
|---|---|---|
| 주석 | `# 글` (한 줄 전체) | 바로 아래 블록 위에 붙어 남는다 |
| 시트 | `@sheet 경로 [key=열] [map] [opt]` + 머리 줄 + 한 줄에 한 기록 | `경로` 의 배열 (`map` 이면 객체) |
| 자식 시트 | `@sheet 부모.필드`, 첫 열 `^` | `^` 에 적은 부모 줄 아래로 붙는다 |
| 속성 | `@props [경로]` + `키: 타입 = 값` 줄 | 이름 붙은 값 |
| 이름 타입 | `@type 이름 = 타입` | 다시 쓰는 타입. `{a:int} \| {b:str}` 는 합 타입 |
| 열 타입 | `int` `num` `str` `bool` `[T]` `{a:T b:T?}` `any` `이름` | 끝의 `?` 는 선택 열 (빈 칸 = 키 없음) |
| 꼬리표 | `enum(이름)` `ref(종류)` | 문자열로 읽힌다. 뜻은 아래 지시문이 준다 |
| 점 열 | `stats.hp:int` | 모양이 고정된 객체를 펼친다 |
| null | `~` | 어느 칸이든 |
| `@enum 이름 = a \| b \| c` | 지시문 | `enum(이름)` 열의 선택지 |
| `@ref 종류 = 파일#시트.열쇠열 [label=열] [icon=열]` | 지시문 | `ref(종류)` 열이 가리키는 곳 |
| `@doc 시트.열 = 글` | 지시문 | 열 설명 (툴팁) |

전체 규칙은 [SPEC.md](SPEC.md). 모든 구현이 같이 통과하는 표본은 [`fixtures/`](fixtures) 에 있다.

## 📦 패키지

| 패키지 | 언어 | 하는 일 |
|---|---|---|
| [`@gsd/core`](packages/core) | TypeScript | 읽기, 정규형 쓰기, JSON 에서 스키마 추정, 작업 공간 API (`loadWorkspace`, `refOptions`, `enumOptions`, `checkRefs`) |
| [`@gsd/cli`](packages/cli) | TypeScript | `gsd convert` · `gsd fmt` · `gsd json` · `gsd check` |
| [`@gsd/sheet`](packages/sheet) | React | `<GsdBook>` — 파일 하나를 탭 시트로 고치고, 중첩 칸은 팝오버로, 정규형 글을 내보낸다 |
| [`gsd`](packages/rust) | Rust | 읽기: `gsd::parse(text)` → `serde_json::Value`, `gsd::from_str::<T>(text)` |
| [`gsd.lua`](packages/lua) | Lua 5.1 / LuaJIT | 읽기: `gsd.decode(text)` → JSON 읽기와 같은 나무 |
| [GSD 에디터](apps/editor) | Electron | 데스크톱 앱: 파일·폴더 열기, 시트로 고치기, 되돌리기, 저장, 참조 검사 |

```tsx
import { GsdBook } from "@gsd/sheet";
import "@gsd/sheet/style.css";

<GsdBook path="items.gsd" text={text} onChange={setText}
         refs={(kind) => refOptions(ws, "items.gsd", kind)} theme="dark" />
```

## 🗺️ 로드맵

- [x] 규칙, 정규형 쓰기, JSON ⇄ GSD 왕복
- [x] TypeScript·Rust·Lua 읽기가 같은 표본 통과
- [x] `@enum`·`@ref`·`@doc` 지시문과 작업 공간 참조 검사
- [x] `@gsd/sheet` 컴포넌트와 GSD 에디터 (개발 빌드)
- [ ] 영어 규칙 문서
- [ ] macOS·Windows·Linux 에디터 설치 파일
- [ ] npm·crates.io 배포
- [ ] VS Code 문법 강조

## 🤝 기여

이슈와 PR 환영. 보내기 전에:

```sh
pnpm test && pnpm typecheck
(cd packages/rust && cargo test)
(cd packages/lua && luajit test.lua)
```

형식을 바꾸면 모든 읽기가 통과하는 표본을 [`fixtures/`](fixtures) 에 더한다.

## 라이선스

[MIT](LICENSE)
