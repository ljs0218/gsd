// 파일을 원문 글로 보고 고치는 칸. 줄 번호 + 글 칸. goto 가 바뀌면 그 줄로 옮긴다.
import { useEffect, useRef } from "react";

const LINE_H = 20;

export function SourceView({ text, onChange, goto }: { text: string; onChange: (next: string) => void; goto?: { line: number; n: number } }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = text.split("\n").length;

  useEffect(() => {
    const el = ta.current;
    if (!el || !goto) return;
    let off = 0;
    for (let i = 1; i < goto.line; i++) {
      const nl = text.indexOf("\n", off);
      if (nl < 0) break;
      off = nl + 1;
    }
    const end = text.indexOf("\n", off);
    el.focus();
    el.setSelectionRange(off, end < 0 ? text.length : end);
    el.scrollTop = Math.max(0, (goto.line - 4) * LINE_H);
    // goto.n 이 바뀔 때만 (같은 줄을 다시 눌러도 이동)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goto?.n]);

  return (
    <div className="source" data-testid="source-view">
      <div className="gutter" ref={gutter} aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={ta}
        className="source-ta"
        data-testid="source-ta"
        spellCheck={false}
        wrap="off"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}
