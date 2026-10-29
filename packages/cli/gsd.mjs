#!/usr/bin/env node
/*
  GSD 도구 (명세: SPEC.md).

      gsd convert <file.json> [-o out.gsd]   JSON → GSD (스키마를 추정한다; -o 없으면 표준 출력)
      gsd fmt <file.gsd>... [--check]        정규 출력으로 다시 쓰기 (--check 는 쓰지 않고 다르면 끝 코드 1)
      gsd json <file.gsd>                    읽은 트리를 JSON 으로 찍기
      gsd check <folder>                     폴더의 .gsd 를 모두 읽고 @ref 가 없는 키를 가리키면 알린다 (끝 코드 1)
*/
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkRefs, formatGsd, GsdError, inferGsd, loadWorkspace, parseGsd, writeGsd } from "../core/src/gsd.ts";

const [cmd, ...rest] = process.argv.slice(2);
const flags = rest.filter((a) => a.startsWith("-"));
const files = rest.filter((a, i) => !a.startsWith("-") && rest[i - 1] !== "-o");
const oi = rest.indexOf("-o");
const out = oi >= 0 ? rest[oi + 1] : null;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

try {
  if (cmd === "convert" && files.length === 1) {
    const j = JSON.parse(readFileSync(files[0], "utf8"));
    const text = writeGsd(j, inferGsd(j));
    if (out) writeFileSync(out, text);
    else process.stdout.write(text);
  } else if (cmd === "fmt" && files.length > 0) {
    let diff = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      let text;
      try {
        text = formatGsd(src);
      } catch (e) {
        if (e instanceof GsdError) die(`${f}: ${e.message}`);
        throw e;
      }
      if (text === src) continue;
      diff++;
      if (flags.includes("--check")) console.log(`정규 출력이 아니다: ${f}`);
      else writeFileSync(f, text);
    }
    if (flags.includes("--check") && diff) process.exit(1);
  } else if (cmd === "json" && files.length === 1) {
    console.log(JSON.stringify(parseGsd(readFileSync(files[0], "utf8")).value, null, 2));
  } else if (cmd === "check" && files.length === 1) {
    const dir = files[0];
    const texts = {};
    for (const f of readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".gsd")).sort()) texts[String(f)] = readFileSync(`${dir}/${f}`, "utf8");
    const bad = checkRefs(loadWorkspace(texts));
    for (const b of bad) console.log(`${b.file}:${b.line} ${b.message}`);
    if (bad.length) process.exit(1);
  } else die("사용: gsd convert <file.json> [-o out.gsd] | fmt <file.gsd>... [--check] | json <file.gsd> | check <folder>");
} catch (e) {
  die(e instanceof GsdError ? e.message : String(e.stack ?? e));
}
