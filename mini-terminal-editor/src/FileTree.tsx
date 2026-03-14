/**
 * FileTree: 递归展示 list_dir 结果，点击文件时调用 read_file 并传给 CodeEditor
 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type ListDirEntry = {
  name: string;
  path: string;
  isDir: boolean;
};

type FileTreeProps = {
  workspacePath: string;
  onSelectFile: (path: string, content: string) => void;
};

function TreeEntry({
  workspacePath,
  entry,
  onSelectFile,
}: {
  workspacePath: string;
  entry: ListDirEntry;
  onSelectFile: (path: string, content: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<ListDirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadChildren = async () => {
    if (!entry.isDir || children !== null) return;
    setLoading(true);
    try {
      const result = (await invoke("list_dir", {
        payload: { workspacePath, path: entry.path },
      })) as ListDirEntry[];
      setChildren(result);
    } catch {
      setChildren([]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    if (!entry.isDir) return;
    if (!expanded) {
      loadChildren();
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  };

  const handleClick = async () => {
    if (entry.isDir) {
      handleToggle();
    } else {
      try {
        const content = (await invoke("read_file", {
          payload: { workspacePath, path: entry.path },
        })) as string;
        onSelectFile(entry.path, content);
      } catch (err) {
        console.error("Failed to read file:", err);
      }
    }
  };

  // Skip common ignore patterns
  const skipEntry = (name: string) =>
    name.startsWith(".") && name !== ".." && name.length > 1;

  if (skipEntry(entry.name)) return null;

  return (
    <div className="file-tree-entry">
      <button
        type="button"
        className={cn(
          "file-tree-row",
          !entry.isDir && "file-tree-row-file"
        )}
        onClick={handleClick}
      >
        {entry.isDir ? (
          <span className="file-tree-chevron">{expanded ? "▾" : "▸"}</span>
        ) : (
          <span className="file-tree-spacer" />
        )}
        <span className="file-tree-icon">
          {entry.isDir ? (loading ? "…" : "📁") : "📄"}
        </span>
        <span className="file-tree-name truncate">{entry.name}</span>
      </button>
      {entry.isDir && expanded && children && (
        <div className="file-tree-children">
          {children.map((child) => (
            <TreeEntry
              key={child.path}
              workspacePath={workspacePath}
              entry={child}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ workspacePath, onSelectFile }: FileTreeProps) {
  const [entries, setEntries] = useState<ListDirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke("list_dir", { payload: { workspacePath, path: "" } })
      .then((result) => {
        if (!cancelled) {
          setEntries((result as ListDirEntry[]).filter((e) => !e.name.startsWith(".")));
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  if (loading) {
    return (
      <div className="file-tree-loading">
        <span>Loading…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="file-tree-error">
        <span>{error}</span>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="file-tree">
        {entries.map((entry) => (
          <TreeEntry
            key={entry.path}
            workspacePath={workspacePath}
            entry={entry}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
