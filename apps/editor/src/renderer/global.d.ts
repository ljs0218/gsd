import type { Api } from "../shared/api";

declare global {
  interface Window {
    gsd: Api;
  }
}
export {};
