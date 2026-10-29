import { useMemo } from "react";
import { buildTree, flatten } from "../shared/tree";

export function Sidebar({
  rootName,
  paths,
  collapsed,
  toggle,
  active,
  dirty,
  onOpen,
}: {
  rootName: string | null;
  /** 루트 기준 상대 경로들 */
  paths: string[];
  collapsed: Set<string>;
  toggle: (dir: string) => void;
  /** 열린 탭의 상대 경로 */
  active: string | null;
  dirty: Set<string>;
  onOpen: (rel: string) => void;
}) {
  const rows = useMemo(() => flatten(buildTree(paths), collapsed), [paths, collapsed]);
  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="side-head">{rootName ?? "No folder"}</div>
      <div className="side-list" role="tree">
        {rows.length === 0 && <div className="side-empty">{rootName ? "No .gsd files in this folder" : "Open a folder to see its .gsd files"}</div>}
        {rows.map(({ node, depth }) => (
          <div
            key={node.path}
            role="treeitem"
            className={`side-row${node.path === active ? " active" : ""}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            title={node.path}
            data-path={node.path}
            onClick={() => (node.dir ? toggle(node.path) : onOpen(node.path))}
          >
            <span className="side-icon">{node.dir ? (collapsed.has(node.path) ? "▸" : "▾") : "◦"}</span>
            <span className="side-name">{node.name}</span>
            {!node.dir && dirty.has(node.path) && <span className="dot" />}
          </div>
        ))}
      </div>
    </aside>
  );
}
