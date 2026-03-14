import { useCallback, useRef, useState, useMemo } from "react";
import type { FileNode } from "./fileTreeTypes";
import { invokeListDir } from "./fileTreeOps";

type DirEntry = { name: string; path: string; isDir: boolean };

type FlatState = {
  /** id → node metadata (no children array inside) */
  nodes: Map<string, { id: string; name: string; isDir: boolean }>;
  /** dirPath → ordered list of direct child ids */
  childIds: Map<string, string[]>;
  rootIds: string[];
};

const emptyState = (): FlatState => ({
  nodes: new Map(),
  childIds: new Map(),
  rootIds: [],
});

export function useTreeData(workspacePath: string) {
  const [state, setState] = useState<FlatState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingDirs = useRef<Set<string>>(new Set());

  const loadDir = useCallback(
    async (dirPath: string) => {
      if (loadingDirs.current.has(dirPath)) return;
      loadingDirs.current.add(dirPath);
      try {
        const entries = await invokeListDir(workspacePath, dirPath);
        const filtered = entries.filter((e) => !e.name.startsWith("."));

        setState((prev) => {
          const nodes = new Map(prev.nodes);
          const childIds = new Map(prev.childIds);

          // Remove stale descendant entries of dirPath
          const oldIds = dirPath === "" ? prev.rootIds : prev.childIds.get(dirPath) ?? [];
          for (const staleId of oldIds) {
            if (!filtered.some((e) => e.path === staleId)) {
              removeDescendants(staleId, nodes, childIds);
            }
          }

          // Upsert new entries
          const newIds: string[] = [];
          for (const e of filtered) {
            newIds.push(e.path);
            const existing = nodes.get(e.path);
            if (!existing) {
              nodes.set(e.path, { id: e.path, name: e.name, isDir: e.isDir });
            }
          }

          // Update parent's child id list
          if (dirPath === "") {
            return { nodes, childIds, rootIds: newIds };
          } else {
            childIds.set(dirPath, newIds);
            return { nodes, childIds, rootIds: prev.rootIds };
          }
        });
      } catch (err) {
        if (dirPath === "") setError(String(err));
        console.error("Failed to load dir:", dirPath, err);
      } finally {
        loadingDirs.current.delete(dirPath);
      }
    },
    [workspacePath],
  );

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadDir("");
    } finally {
      setLoading(false);
    }
  }, [loadDir]);

  const refreshDir = useCallback(
    async (dirPath: string) => {
      if (dirPath === "") {
        setState(emptyState);
        await loadDir("");
      } else {
        // Remove stale children so the dir shows as unloaded (null children)
        setState((prev) => {
          const childIds = new Map(prev.childIds);
          const nodes = new Map(prev.nodes);
          const ids = childIds.get(dirPath) ?? [];
          for (const id of ids) {
            removeDescendants(id, nodes, childIds);
          }
          childIds.delete(dirPath);
          return { nodes, childIds, rootIds: prev.rootIds };
        });
        await loadDir(dirPath);
      }
    },
    [loadDir],
  );

  // Rebuild nested FileNode[] from flat state for react-arborist
  const treeData = useMemo((): FileNode[] => {
    function build(parentPath: string): FileNode[] | undefined {
      const ids =
        parentPath === "" ? state.rootIds : state.childIds.get(parentPath);
      if (ids === undefined) return undefined;
      return ids.map((id) => {
        const meta = state.nodes.get(id);
        if (!meta) return { id, name: id.split("/").pop() || id, isDir: false };
        if (!meta.isDir) return { ...meta, children: undefined };
        const childList = build(id);
        // undefined = not loaded yet (childIds has no entry) → pass null to signal "expandable"
        // FileNode[] = loaded
        return { ...meta, children: childList ?? null };
      });
    }
    return build("") ?? [];
  }, [state]);

  return { treeData, loading, error, loadDir, loadRoot, refreshDir };
}

// ---- helpers ----

function removeDescendants(
  rootId: string,
  nodes: Map<string, unknown>,
  childIds: Map<string, string[]>,
) {
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const kids = childIds.get(id);
    if (kids) {
      for (const k of kids) stack.push(k);
      childIds.delete(id);
    }
    nodes.delete(id);
  }
}
