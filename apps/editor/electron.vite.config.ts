import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

// 의존성을 전부 번들에 넣는다 (externalize 안 함). 개발 서버 포트 5180 고정 (다른 앱이 5173 을 쓴다).
export default defineConfig({
  main: {
    build: { outDir: "out/main", rollupOptions: { input: { index: resolve(__dirname, "src/main/index.ts") } } },
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: { input: { index: resolve(__dirname, "src/preload/index.ts") }, output: { format: "cjs", entryFileNames: "[name].js" } },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    server: { port: 5180, strictPort: true },
    build: { outDir: resolve(__dirname, "out/renderer"), rollupOptions: { input: { index: resolve(__dirname, "src/renderer/index.html") } } },
  },
});
