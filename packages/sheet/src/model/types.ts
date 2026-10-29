// @gsd/sheet 의 공용 타입. 값·스키마 타입은 @gsd/core 의 것을 그대로 쓴다.
import type { Schema, T } from "@gsd/core";

export type { Schema, T, Block, SheetBlock, PropsBlock, Column, Field, RefOption, ParsedGsd } from "@gsd/core";

/** 값 트리 안의 자리 한 칸: 객체 키(글) 또는 배열 번호. */
export type Tok = string | number;

/** 이 패키지가 보는 확장 타입: 맵 시트의 뿌리(객체 키 → 레코드)만 T 에 없다. */
export type XT = T | { k: "map"; of: T };

/** `@enum 이름 = a | b | c` 의 값들. 선언이 없으면 undefined (글 칸으로 쓴다). */
export function enumValues(schema: Schema, name: string): string[] | undefined {
  return schema.enums.get(name)?.values;
}

/** `@doc 시트경로.열 = 설명`. */
export function docOf(schema: Schema, sheet: readonly Tok[], col: string): string | undefined {
  return schema.docs.find((d) => d.col === col && d.sheet.length === sheet.length && d.sheet.every((s, i) => s === String(sheet[i])))?.text;
}
