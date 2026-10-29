import { basename } from "../shared/paths";

export function Start({
  recents,
  examplesDir,
  onOpenFolder,
  onOpenFile,
  onOpenRecent,
  onForget,
}: {
  recents: string[];
  examplesDir: string | null;
  onOpenFolder: () => void;
  onOpenFile: () => void;
  onOpenRecent: (p: string) => void;
  onForget: (p: string) => void;
}) {
  return (
    <div className="start" data-testid="start">
      <h1>GSD Editor</h1>
      <p className="muted">Open a folder of .gsd files to browse and edit them as sheets.</p>
      <div className="start-actions">
        <button className="primary" onClick={onOpenFolder}>
          Open Folder…
        </button>
        <button onClick={onOpenFile}>Open File…</button>
        {examplesDir && (
          <button data-testid="open-examples" onClick={() => onOpenRecent(examplesDir)}>
            Open Examples
          </button>
        )}
      </div>
      {recents.length > 0 && (
        <>
          <h2>Recent folders</h2>
          <div className="recents">
            {recents.map((p) => (
              <div key={p} className="recent-row">
                <button className="link recent-open" onClick={() => onOpenRecent(p)} title={p}>
                  <b>{basename(p)}</b>
                  <span className="muted"> {p}</span>
                </button>
                <button className="link" title="Remove from list" onClick={() => onForget(p)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
