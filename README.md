<div align="center">

<img src="docs/assets/logo.svg" width="96" height="96" alt="GSD logo">

# GSD

**Spreadsheet-shaped, typed, tree-capable plain text for data.**<br>
Edit it like a sheet. Diff it like code. Read it like JSON.

**English** · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-22%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-core%20%C2%B7%20sheet%20%C2%B7%20cli-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-reader-DEA584?logo=rust&logoColor=black)
![Lua](https://img.shields.io/badge/Lua%205.1%20%2F%20LuaJIT-reader-2C2D72?logo=lua&logoColor=white)
![Status](https://img.shields.io/badge/status-pre--release-orange)

<img src="docs/assets/editor.png" alt="GSD Editor: a monsters sheet with the nested drops sheet open in a popover" width="900">

<sub>GSD Editor — hover a <code>[…]</code> or <code>{…}</code> cell and the nested data opens as another sheet.</sub>

</div>

---

## Why GSD?

People who keep tables of data — game designers, localizers, anyone with a config that grew up — end up choosing between **spreadsheets** (easy to edit, hard to diff and merge) and **JSON/YAML** (easy for programs, painful for a table of 150 monsters). GSD is one text format that does both.

|  | JSON | YAML | CSV | **GSD** |
|---|:---:|:---:|:---:|:---:|
| One record per line, small diffs | ✗ | ✗ | ✓ | **✓** |
| Column types inside the file | ✗ | ✗ | ✗ | **✓** |
| Nested objects and arrays | ✓ | ✓ | ✗ | **✓** |
| Checked references across files | ✗ | ✗ | ✗ | **✓** |
| One canonical text per value | ✗ | ✗ | ✗ | **✓** |
| Opens as a sheet | ✗ | ✗ | ✓ | **✓** |

Reading a `.gsd` file gives you **exactly the tree JSON would** (objects, arrays, strings, numbers, booleans, null), and any JSON tree can be written back as GSD. Your program keeps working with plain values.

## ✨ Features

- 🧮 **Sheet shaped** — one block is a sheet, one line is a record, columns are aligned with `|`.
- 🏷️ **Typed** — `int`, `num`, `str`, `bool`, `[T]`, `{a:T}`, sum types, `enum(…)` and `ref(…)` are declared in the header line.
- 🌳 **Trees** — dotted columns (`stats.hp`), child sheets (the `^` column) and inline `[a; b]` / `{k=v}` cells.
- 🔗 **References** — `@ref` points a column at a key in another file; tools list the choices and report dangling keys.
- 📝 **Choices and docs live with the data** — `@enum` and `@doc` let editors show dropdowns and tooltips.
- 🔁 **Lossless and canonical** — JSON ⇄ GSD round-trips, and formatting is idempotent.
- 🖥️ **Comes with an editor** — a desktop app and a React component that edit GSD as sheets.

## A taste

`examples/monsters.gsd` — stats as dotted columns, drops as a child sheet:

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

reads as

```json
{ "monsters": [
  { "id": "slime", "name": "Green Slime", "icon": "🟢", "element": "poison",
    "stats": { "hp": 30, "atk": 4, "def": 1, "speed": 0.8 },
    "drops": [ { "item": "slime_gel", "chance": 6000, "min": 1, "max": 2 } ] },
  …
] }
```

<details>
<summary><b>More: sum types, enums and docs</b> (<code>examples/quests.gsd</code>)</summary>

```
@type reward = {gold:int} | {exp:int} | {item:ref(item) count:int}
@enum goalKind = kill | collect | talk
@doc quests.rewards = Rewards granted on completion

@sheet quests key=id
id:str        | title:str     | level:int | goal:{kind:enum(goalKind) monster:ref(monster)? item:ref(item)? count:int} | rewards:[reward]
slime_trouble | Slime Trouble | 1         | {kind=kill; monster=slime; count=5}                                        | [gold 80; exp 40]
```

`[gold 80; exp 40]` is the short form of `[{gold=80}; {exp=40}]`. `examples/dialogue.gsd` is a dialogue tree whose `next` columns are `ref(node)`, and `examples/config.gsd` holds named values with `@props`.

</details>

## 🚀 Quick start

> GSD is not on npm or crates.io yet — run it from a clone.

```sh
git clone https://github.com/ljs0218/gsd.git && cd gsd
pnpm i
pnpm test

node packages/cli/gsd.mjs json examples/items.gsd          # print the tree as JSON
node packages/cli/gsd.mjs convert some.json -o some.gsd     # JSON → GSD, schema inferred
node packages/cli/gsd.mjs fmt examples/*.gsd --check        # is everything canonical?
node packages/cli/gsd.mjs check examples                    # do all @ref keys exist?
```

Open the editor:

```sh
pnpm --filter gsd-editor dev
```

Requires Node 22+ (the CLI runs the TypeScript sources directly).

## 📖 Syntax at a glance

| Piece | Written as | Meaning |
|---|---|---|
| Comment | `# text` (whole line) | kept above the block it precedes |
| Sheet | `@sheet path [key=col] [map] [opt]` + header line + one record per line | an array (or an object with `map`) at `path` |
| Child sheet | `@sheet parent.field`, first column `^` | rows attach to the parent row named in `^` |
| Props | `@props [path]` + `key: type = value` lines | named values |
| Named type | `@type name = type` | reusable type; `{a:int} \| {b:str}` is a sum type |
| Column types | `int` `num` `str` `bool` `[T]` `{a:T b:T?}` `any` `name` | trailing `?` makes a column optional (empty cell = key absent) |
| Tags | `enum(name)` `ref(kind)` | read as strings; meaning comes from the directives below |
| Dotted column | `stats.hp:int` | flattens a fixed-shape object |
| Null | `~` | any cell |
| `@enum name = a \| b \| c` | directive | choices for `enum(name)` columns |
| `@ref kind = file#sheet.keycol [label=col] [icon=col]` | directive | where `ref(kind)` columns point |
| `@doc sheet.col = text` | directive | column description (tooltip) |

The full specification is [SPEC.md](SPEC.md) (Korean for now). Conformance samples shared by every implementation live in [`fixtures/`](fixtures).

## 📦 Packages

| Package | Language | What it does |
|---|---|---|
| [`@gsd/core`](packages/core) | TypeScript | Parse, write the canonical form, infer a schema from JSON, workspace API (`loadWorkspace`, `refOptions`, `enumOptions`, `checkRefs`) |
| [`@gsd/cli`](packages/cli) | TypeScript | `gsd convert` · `gsd fmt` · `gsd json` · `gsd check` |
| [`@gsd/sheet`](packages/sheet) | React | `<GsdBook>` — edits one file as tabbed sheets with nested popovers, emits canonical text |
| [`gsd`](packages/rust) | Rust | Reader: `gsd::parse(text)` → `serde_json::Value`, `gsd::from_str::<T>(text)` |
| [`gsd.lua`](packages/lua) | Lua 5.1 / LuaJIT | Reader: `gsd.decode(text)` → the same tree a JSON reader gives |
| [GSD Editor](apps/editor) | Electron | Desktop app: open a file or folder, edit as sheets, undo, save, check references |

```tsx
import { GsdBook } from "@gsd/sheet";
import "@gsd/sheet/style.css";

<GsdBook path="items.gsd" text={text} onChange={setText}
         refs={(kind) => refOptions(ws, "items.gsd", kind)} theme="dark" />
```

## 🗺️ Roadmap

- [x] Spec, canonical writer, JSON ⇄ GSD round trip
- [x] TypeScript, Rust and Lua readers passing the same fixtures
- [x] `@enum`, `@ref`, `@doc` directives and workspace reference checks
- [x] `@gsd/sheet` component and GSD Editor (dev build)
- [ ] English specification
- [ ] Packaged editor builds for macOS, Windows and Linux
- [ ] Publish to npm and crates.io
- [ ] Syntax highlighting for VS Code

## 🤝 Contributing

Issues and pull requests are welcome. Before sending a change:

```sh
pnpm test && pnpm typecheck
(cd packages/rust && cargo test)
(cd packages/lua && luajit test.lua)
```

A format change needs a fixture in [`fixtures/`](fixtures) that every reader passes.

## License

[MIT](LICENSE)
