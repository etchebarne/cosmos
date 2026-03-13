export interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
  additions: number;
  deletions: number;
}

export interface GitStatusInfo {
  changes: GitFileChange[];
  branch: string | null;
  remoteBranch: string | null;
  lastCommitMessage: string | null;
  hasRemote: boolean;
  isRepo: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  change?: GitFileChange;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  isFile: boolean;
  change?: GitFileChange;
}

export function buildChangeTree(changes: GitFileChange[]): TreeNode[] {
  if (changes.length === 0) return [];

  const root = new Map<string, TrieNode>();

  for (const change of changes) {
    const parts = change.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.has(part)) {
        current.set(part, {
          children: new Map(),
          isFile: i === parts.length - 1,
          change: i === parts.length - 1 ? change : undefined,
        });
      }
      current = current.get(part)!.children;
    }
  }

  function convert(map: Map<string, TrieNode>): TreeNode[] {
    const nodes: TreeNode[] = [];

    for (const [name, data] of map) {
      if (data.isFile) {
        nodes.push({
          name,
          path: data.change!.path,
          isDir: false,
          children: [],
          change: data.change,
        });
      } else {
        let collapsedName = name;
        let currentData = data;

        while (currentData.children.size === 1) {
          const entry = currentData.children.entries().next();
          if (entry.done) break;
          const [childName, childData] = entry.value;
          if (childData.isFile) break;
          collapsedName += "/" + childName;
          currentData = childData;
        }

        const children = convert(currentData.children);
        nodes.push({
          name: collapsedName,
          path: collapsedName,
          isDir: true,
          children,
        });
      }
    }

    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    return nodes;
  }

  return convert(root);
}

export function getNodeFiles(node: TreeNode): GitFileChange[] {
  if (!node.isDir && node.change) return [node.change];
  return node.children.flatMap(getNodeFiles);
}
