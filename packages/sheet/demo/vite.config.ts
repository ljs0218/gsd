import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// 데모 페이지 (포트 5181). 저장소 루트의 examples/*.gsd 를 글째로 넣는다.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: { port: 5181, strictPort: true, fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] } },
  build: { outDir: fileURLToPath(new URL("../dist-demo", import.meta.url)), emptyOutDir: true },
});
