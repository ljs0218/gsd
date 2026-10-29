import { loadWorkspace, refOptions } from "@gsd/core";
import { GsdBook } from "@gsd/sheet";
import "@gsd/sheet/style.css";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const raw = import.meta.glob("../../../examples/*.gsd", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const initial: Record<string, string> = {};
for (const [p, t] of Object.entries(raw)) initial[p.split("/").pop()!] = t;

function Demo() {
  const [files, setFiles] = useState(initial);
  const [name, setName] = useState("monsters.gsd");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const ws = useMemo(() => loadWorkspace(files), [files]);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: 6, display: "flex", gap: 8, fontFamily: "system-ui" }}>
        {Object.keys(files).map((n) => (
          <button key={n} onClick={() => setName(n)} style={{ fontWeight: n === name ? 700 : 400 }}>{n}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme}</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <GsdBook path={name} text={files[name]!} theme={theme} refs={(kind) => refOptions(ws, name, kind)} onChange={(next) => setFiles((f) => ({ ...f, [name]: next }))} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Demo /></StrictMode>);
