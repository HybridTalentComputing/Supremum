/**
 * FileTree: 递归展示 list_dir 结果，点击文件时调用 read_file 并传给 CodeEditor
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import {
  FilePlus,
  FolderPlus,
  ChevronsUp,
  RefreshCw,
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
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
  collapseSignal,
  refreshSignal,
  activeDirPath,
  onActivateDir,
  createDraft,
  createName,
  setCreateName,
  submitCreate,
  cancelCreate,
}: {
  workspacePath: string;
  entry: ListDirEntry;
  onSelectFile: (path: string, content: string) => void;
  collapseSignal: number;
  refreshSignal: number;
  activeDirPath: string;
  onActivateDir: (path: string) => void;
  createDraft: { type: "file" | "dir"; parentPath: string } | null;
  createName: string;
  setCreateName: (value: string) => void;
  submitCreate: () => void;
  cancelCreate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<ListDirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const loadChildren = async (force = false) => {
    if (!entry.isDir || (!force && children !== null)) return;
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

  useEffect(() => {
    setExpanded(false);
  }, [collapseSignal]);

  useEffect(() => {
    if (!entry.isDir) return;
    setChildren(null);
    if (expanded) {
      loadChildren(true);
    }
  }, [refreshSignal, expanded, entry.isDir]);

  useEffect(() => {
    if (!entry.isDir) return;
    if (createDraft?.parentPath === entry.path) {
      setExpanded(true);
      loadChildren(true);
    }
  }, [createDraft, entry.isDir, entry.path]);

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
      onActivateDir(entry.path);
      handleToggle();
    } else {
      try {
        const parentPath = entry.path.split("/").slice(0, -1).join("/");
        onActivateDir(parentPath);
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
          !entry.isDir && "file-tree-row-file",
          entry.isDir && activeDirPath === entry.path && "file-tree-row-active"
        )}
        onClick={handleClick}
      >
        {entry.isDir ? (
          <span className="file-tree-chevron file-tree-icon-chevron">
            {expanded ? (
              <ChevronDown className="size-3.5 file-tree-icon-svg" />
            ) : (
              <ChevronRight className="size-3.5 file-tree-icon-svg" />
            )}
          </span>
        ) : (
          <span className="file-tree-spacer" />
        )}
        <span
          className={cn(
            "file-tree-icon",
            entry.isDir ? "file-tree-icon-folder" : "file-tree-icon-file"
          )}
        >
          {entry.isDir ? (
            loading ? (
              "…"
            ) : expanded ? (
              <FolderOpen className="size-3.5 file-tree-icon-svg" />
            ) : (
              <Folder className="size-3.5 file-tree-icon-svg" />
            )
          ) : (
            <FileText className="size-3.5 file-tree-icon-svg" />
          )}
        </span>
        <span className="file-tree-name truncate">{entry.name}</span>
      </button>
      {entry.isDir && expanded && children && (
        <div className="file-tree-children">
          {createDraft?.parentPath === entry.path && (
            <div className="file-tree-create-row">
              <span className="file-tree-spacer" />
              <span
                className={cn(
                  "file-tree-icon",
                  createDraft.type === "dir"
                    ? "file-tree-icon-folder"
                    : "file-tree-icon-file"
                )}
              >
                {createDraft.type === "dir" ? (
                  <FolderOpen className="size-3.5 file-tree-icon-svg" />
                ) : (
                  <FileText className="size-3.5 file-tree-icon-svg" />
                )}
              </span>
              <input
                autoFocus
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submitCreate();
                  } else if (event.key === "Escape") {
                    cancelCreate();
                  }
                }}
                onBlur={cancelCreate}
                className="file-tree-create-input"
                placeholder={
                  createDraft.type === "dir" ? "新建文件夹" : "新建文件"
                }
              />
            </div>
          )}
          {children.map((child) => (
            <TreeEntry
              key={child.path}
              workspacePath={workspacePath}
              entry={child}
              onSelectFile={onSelectFile}
              collapseSignal={collapseSignal}
              refreshSignal={refreshSignal}
              activeDirPath={activeDirPath}
              onActivateDir={onActivateDir}
              createDraft={createDraft}
              createName={createName}
              setCreateName={setCreateName}
              submitCreate={submitCreate}
              cancelCreate={cancelCreate}
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
  const [collapseSignal, setCollapseSignal] = useState(0);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [activeDirPath, setActiveDirPath] = useState("");
  const [createDraft, setCreateDraft] = useState<{
    type: "file" | "dir";
    parentPath: string;
  } | null>(null);
  const [createName, setCreateName] = useState("");

  const loadRoot = useCallback(() => {
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

  useEffect(() => {
    const cancel = loadRoot();
    return cancel;
  }, [loadRoot]);

  const handleRefresh = () => {
    setRefreshSignal((value) => value + 1);
    setCreateDraft(null);
    setCreateName("");
    loadRoot();
  };

  const handleCollapseAll = () => {
    setCollapseSignal((value) => value + 1);
    setCreateDraft(null);
    setCreateName("");
  };

  const handleCreateFile = async () => {
    setCreateName("");
    setCreateDraft({
      type: "file",
      parentPath: activeDirPath,
    });
  };

  const handleCreateDir = async () => {
    setCreateName("");
    setCreateDraft({
      type: "dir",
      parentPath: activeDirPath,
    });
  };

  const cancelCreate = () => {
    setCreateDraft(null);
    setCreateName("");
  };

  const submitCreate = async () => {
    if (!createDraft) return;
    const trimmed = createName.trim();
    if (!trimmed) {
      cancelCreate();
      return;
    }
    const fullPath = createDraft.parentPath
      ? `${createDraft.parentPath}/${trimmed}`
      : trimmed;
    try {
      if (createDraft.type === "dir") {
        await invoke("create_dir", {
          payload: { workspacePath, path: fullPath },
        });
      } else {
        await invoke("create_file", {
          payload: { workspacePath, path: fullPath },
        });
      }
      setRefreshSignal((value) => value + 1);
      loadRoot();
    } catch (err) {
      console.error("Failed to create entry:", err);
      window.alert(String(err));
    } finally {
      cancelCreate();
    }
  };

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
    <div className="file-tree-panel">
      <div className="file-tree-toolbar">
        <div className="file-tree-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="file-tree-action"
            onClick={handleCreateFile}
            title="新建文件"
            aria-label="新建文件"
          >
            <FilePlus className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="file-tree-action"
            onClick={handleCreateDir}
            title="新建文件夹"
            aria-label="新建文件夹"
          >
            <FolderPlus className="size-4" />
          </Button>
        </div>
        <div className="file-tree-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="file-tree-action"
            onClick={handleCollapseAll}
            title="折叠所有文件夹"
            aria-label="折叠所有文件夹"
          >
            <ChevronsUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="file-tree-action"
            onClick={handleRefresh}
            title="刷新"
            aria-label="刷新"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="file-tree">
          {createDraft?.parentPath === "" && (
            <div className="file-tree-create-row">
              <span className="file-tree-spacer" />
              <span
                className={cn(
                  "file-tree-icon",
                  createDraft.type === "dir"
                    ? "file-tree-icon-folder"
                    : "file-tree-icon-file"
                )}
              >
                {createDraft.type === "dir" ? (
                  <FolderOpen className="size-3.5 file-tree-icon-svg" />
                ) : (
                  <FileText className="size-3.5 file-tree-icon-svg" />
                )}
              </span>
              <input
                autoFocus
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submitCreate();
                  } else if (event.key === "Escape") {
                    cancelCreate();
                  }
                }}
                onBlur={cancelCreate}
                className="file-tree-create-input"
                placeholder={
                  createDraft.type === "dir" ? "新建文件夹" : "新建文件"
                }
              />
            </div>
          )}
          {entries.map((entry) => (
            <TreeEntry
              key={entry.path}
              workspacePath={workspacePath}
              entry={entry}
              onSelectFile={onSelectFile}
              collapseSignal={collapseSignal}
              refreshSignal={refreshSignal}
              activeDirPath={activeDirPath}
              onActivateDir={setActiveDirPath}
              createDraft={createDraft}
              createName={createName}
              setCreateName={setCreateName}
              submitCreate={submitCreate}
              cancelCreate={cancelCreate}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
