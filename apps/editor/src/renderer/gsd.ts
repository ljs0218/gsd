// @gsd/sheet 와 @gsd/core 를 앱이 쓰는 단 한 곳.
import "@gsd/sheet/style.css";
export { GsdBook, type GsdBookHandle, type GsdBookProps } from "@gsd/sheet";
export { loadWorkspace, refOptions, checkRefs, enumOptions, parseGsd, GsdError, type Workspace, type RefOption, type ParsedGsd } from "@gsd/core";
