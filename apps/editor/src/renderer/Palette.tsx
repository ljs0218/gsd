// Cmd/Ctrl+P — 작업 공간의 파일 찾기.
import { useEffect, useMemo, useRef, useState } from "react";
import { fuzzyFilter } from "../shared/paths";

export function Palette({ paths, onPick, onClose }: { paths: string[]; onPick: (rel: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => fuzzyFilter(q, paths), [q, paths]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setSel(0), [q]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" data-testid="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder="Go to file…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, list.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
            else if (e.key === "Enter" && list[sel]) onPick(list[sel]!);
          }}
        />
        <div className="palette-list">
          {list.length === 0 && <div className="side-empty">No matching files</div>}
          {list.map((p, i) => (
            <div key={p} className={`palette-row${i === sel ? " sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => onPick(p)}>
              {p}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
