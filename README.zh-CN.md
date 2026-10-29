<div align="center">

<img src="docs/assets/logo.svg" width="96" height="96" alt="GSD 标志">

# GSD

**像表格一样排布、带类型、能表达树结构的数据文本格式。**<br>
像表格一样编辑，像代码一样 diff，像 JSON 一样读取。

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **简体中文**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-22%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-core%20%C2%B7%20sheet%20%C2%B7%20cli-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-reader-DEA584?logo=rust&logoColor=black)
![Lua](https://img.shields.io/badge/Lua%205.1%20%2F%20LuaJIT-reader-2C2D72?logo=lua&logoColor=white)
![Status](https://img.shields.io/badge/status-pre--release-orange)

<img src="docs/assets/editor.png" alt="GSD 编辑器：在怪物表中打开掉落子表" width="900">

<sub>GSD 编辑器 — 鼠标悬停在 <code>[…]</code> 或 <code>{…}</code> 单元格上，嵌套数据会以另一张表的形式展开。</sub>

</div>

---

## 为什么选择 GSD？

管理表格数据的人 — 游戏策划、本地化人员，或者任何配置文件越写越大的人 — 最终都要在 **电子表格**（编辑方便，但难以 diff 和合并）与 **JSON/YAML**（程序友好，但写 150 只怪物的表很痛苦）之间做选择。GSD 是一种同时满足两者的文本格式。

|  | JSON | YAML | CSV | **GSD** |
|---|:---:|:---:|:---:|:---:|
| 一行一条记录，diff 小 | ✗ | ✗ | ✓ | **✓** |
| 文件内声明列类型 | ✗ | ✗ | ✗ | **✓** |
| 嵌套对象与数组 | ✓ | ✓ | ✗ | **✓** |
| 跨文件引用检查 | ✗ | ✗ | ✗ | **✓** |
| 一个值只有一种规范文本 | ✗ | ✗ | ✗ | **✓** |
| 可以作为表格打开 | ✗ | ✗ | ✓ | **✓** |

读取 `.gsd` 文件得到的 **与 JSON 完全相同的树**（对象、数组、字符串、数字、布尔值、null），任何 JSON 树也都能写回 GSD。程序照常使用普通的值。

## ✨ 特性

- 🧮 **表格形态** — 一个块是一张表，一行是一条记录，列用 `|` 对齐。
- 🏷️ **带类型** — 在表头行声明 `int`、`num`、`str`、`bool`、`[T]`、`{a:T}`、和类型、`enum(…)`、`ref(…)`。
- 🌳 **树结构** — 点号列（`stats.hp`）、子表（`^` 列）以及单元格内的 `[a; b]` / `{k=v}`。
- 🔗 **引用** — `@ref` 让某列指向另一个文件中的键；工具会列出可选值并报告悬空的键。
- 📝 **选项与说明随数据一起** — 借助 `@enum` 和 `@doc`，编辑器可以显示下拉列表和提示。
- 🔁 **无损且规范** — JSON ⇄ GSD 可往返，格式化是幂等的。
- 🖥️ **自带编辑器** — 以表格方式编辑 GSD 的桌面应用和 React 组件。

## 先睹为快

`examples/monsters.gsd` — 属性用点号列，掉落用子表：

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

读取结果为

```json
{ "monsters": [
  { "id": "slime", "name": "Green Slime", "icon": "🟢", "element": "poison",
    "stats": { "hp": 30, "atk": 4, "def": 1, "speed": 0.8 },
    "drops": [ { "item": "slime_gel", "chance": 6000, "min": 1, "max": 2 } ] },
  …
] }
```

<details>
<summary><b>更多：和类型、enum 与说明</b>（<code>examples/quests.gsd</code>）</summary>

```
@type reward = {gold:int} | {exp:int} | {item:ref(item) count:int}
@enum goalKind = kill | collect | talk
@doc quests.rewards = Rewards granted on completion

@sheet quests key=id
id:str        | title:str     | level:int | goal:{kind:enum(goalKind) monster:ref(monster)? item:ref(item)? count:int} | rewards:[reward]
slime_trouble | Slime Trouble | 1         | {kind=kill; monster=slime; count=5}                                        | [gold 80; exp 40]
```

`[gold 80; exp 40]` 是 `[{gold=80}; {exp=40}]` 的简写。`examples/dialogue.gsd` 是 `next` 列为 `ref(node)` 的对话树，`examples/config.gsd` 用 `@props` 写命名值。

</details>

## 🚀 快速开始

> 目前尚未发布到 npm 或 crates.io — 请克隆仓库使用。

```sh
git clone https://github.com/ljs0218/gsd.git && cd gsd
pnpm i
pnpm test

node packages/cli/gsd.mjs json examples/items.gsd          # 以 JSON 打印树
node packages/cli/gsd.mjs convert some.json -o some.gsd     # JSON → GSD，自动推断模式
node packages/cli/gsd.mjs fmt examples/*.gsd --check        # 是否都是规范形式？
node packages/cli/gsd.mjs check examples                    # @ref 的键是否都存在？
```

打开编辑器：

```sh
pnpm --filter gsd-editor dev
```

需要 Node 22 及以上（CLI 直接运行 TypeScript 源码）。

## 📖 语法速览

| 元素 | 写法 | 含义 |
|---|---|---|
| 注释 | `# 文本`（整行） | 保留在其后的块上方 |
| 表 | `@sheet 路径 [key=列] [map] [opt]` + 表头行 + 每行一条记录 | `路径` 处的数组（带 `map` 时为对象） |
| 子表 | `@sheet 父.字段`，首列 `^` | 行挂到 `^` 所写的父行下 |
| 属性 | `@props [路径]` + `键: 类型 = 值` 行 | 命名值 |
| 命名类型 | `@type 名称 = 类型` | 可复用的类型；`{a:int} \| {b:str}` 是和类型 |
| 列类型 | `int` `num` `str` `bool` `[T]` `{a:T b:T?}` `any` `名称` | 末尾 `?` 表示可选列（空单元格 = 无此键） |
| 标签 | `enum(名称)` `ref(种类)` | 按字符串读取；含义由下面的指令给出 |
| 点号列 | `stats.hp:int` | 展开形状固定的对象 |
| null | `~` | 任意单元格 |
| `@enum 名称 = a \| b \| c` | 指令 | `enum(名称)` 列的可选值 |
| `@ref 种类 = 文件#表.键列 [label=列] [icon=列]` | 指令 | `ref(种类)` 列指向的位置 |
| `@doc 表.列 = 文本` | 指令 | 列说明（提示） |

完整规范见 [SPEC.md](SPEC.md)（目前仅有韩文）。所有实现共同通过的一致性样例位于 [`fixtures/`](fixtures)。

## 📦 软件包

| 软件包 | 语言 | 功能 |
|---|---|---|
| [`@gsd/core`](packages/core) | TypeScript | 解析、规范形式写出、从 JSON 推断模式、工作区 API（`loadWorkspace`、`refOptions`、`enumOptions`、`checkRefs`） |
| [`@gsd/cli`](packages/cli) | TypeScript | `gsd convert` · `gsd fmt` · `gsd json` · `gsd check` |
| [`@gsd/sheet`](packages/sheet) | React | `<GsdBook>` — 以标签页表格编辑单个文件，嵌套内容用弹出层，输出规范文本 |
| [`gsd`](packages/rust) | Rust | 读取：`gsd::parse(text)` → `serde_json::Value`，`gsd::from_str::<T>(text)` |
| [`gsd.lua`](packages/lua) | Lua 5.1 / LuaJIT | 读取：`gsd.decode(text)` → 与 JSON 读取器相同的树 |
| [GSD 编辑器](apps/editor) | Electron | 桌面应用：打开文件或文件夹、以表格编辑、撤销、保存、引用检查 |

```tsx
import { GsdBook } from "@gsd/sheet";
import "@gsd/sheet/style.css";

<GsdBook path="items.gsd" text={text} onChange={setText}
         refs={(kind) => refOptions(ws, "items.gsd", kind)} theme="dark" />
```

## 🗺️ 路线图

- [x] 规范、规范形式写出器、JSON ⇄ GSD 往返
- [x] TypeScript、Rust、Lua 读取器通过同一套样例
- [x] `@enum`、`@ref`、`@doc` 指令与工作区引用检查
- [x] `@gsd/sheet` 组件与 GSD 编辑器（开发版）
- [ ] 英文版规范
- [ ] macOS、Windows、Linux 编辑器安装包
- [ ] 发布到 npm 与 crates.io
- [ ] VS Code 语法高亮

## 🤝 参与贡献

欢迎提交 Issue 和 PR。提交前请运行：

```sh
pnpm test && pnpm typecheck
(cd packages/rust && cargo test)
(cd packages/lua && luajit test.lua)
```

修改格式时，请在 [`fixtures/`](fixtures) 中添加所有读取器都能通过的样例。

## 许可证

[MIT](LICENSE)
