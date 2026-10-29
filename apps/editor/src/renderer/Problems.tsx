import type { RefIssue } from "./model";

export function Problems({ issues, onGo, onClose }: { issues: RefIssue[]; onGo: (i: RefIssue) => void; onClose: () => void }) {
  return (
    <div className="problems" data-testid="problems">
      <div className="problems-head">
        <span>Reference errors ({issues.length})</span>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="problems-list">
        {issues.map((i, k) => (
          <div key={k} className="problem-row" onClick={() => onGo(i)}>
            <span className="problem-loc">
              {i.file}:{i.line}
            </span>
            <span>{i.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
