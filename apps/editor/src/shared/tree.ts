// 파일 나무: 상대 경로 목록 → 중첩 나무. 폴더가 먼저, 이름은 대소문자 무시·숫자 자연 정렬.

export interface TreeNode {
  name: string;
  /** 폴더 또는 파일의 루트 기준 상대 경로 ("/" 구분) */
  path: string;
  dir: boolean;
  children: TreeNode[];
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.dir !== b.dir) return a.dir ? -1 : 1;
  return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export function buildTree(paths: readonly string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", dir: true, children: [] };
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    let cur = root;
    parts.forEach((name, i) => {
      const last = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let next = cur.children.find((c) => c.name === name && c.dir === !last);
      if (!next) {
        next = { name, path, dir: !last, children: [] };
        cur.children.push(next);
      }
      cur = next;
    });
  }
  const sortRec = (n: TreeNode) => {
    n.children.sort(compareNodes);
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root.children;
}

/** 나무를 펼친 순서(보이는 줄)로 — collapsed 에 든 폴더의 안쪽은 건너뛴다. */
export function flatten(nodes: readonly TreeNode[], collapsed: ReadonlySet<string>, depth = 0): { node: TreeNode; depth: number }[] {
  const out: { node: TreeNode; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.dir && !collapsed.has(n.path)) out.push(...flatten(n.children, collapsed, depth + 1));
  }
  return out;
}
