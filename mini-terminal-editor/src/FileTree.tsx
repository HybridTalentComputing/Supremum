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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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

type ContextTarget =
  | { type: "file"; path: string; name: string }
  | { type: "folder"; path: string; name: string }
  | { type: "blank" };

function TreeEntry({
  workspacePath,
  entry,
  onSelectFile,
  collapseSignal,
  refreshSignal,
  activeDirPath,
  activePath,
  onActivateDir,
  onActivatePath,
  onContextTarget,
  createDraft,
  createName,
  setCreateName,
  submitCreate,
  cancelCreate,
  renamingPath,
  renamingValue,
  setRenamingValue,
  submitRename,
  cancelRename,
}: {
  workspacePath: string;
  entry: ListDirEntry;
  onSelectFile: (path: string, content: string) => void;
  collapseSignal: number;
  refreshSignal: number;
  activeDirPath: string;
  activePath: string;
  onActivateDir: (path: string) => void;
  onActivatePath: (path: string) => void;
  onContextTarget: (target: ContextTarget) => void;
  createDraft: { type: "file" | "dir"; parentPath: string } | null;
  createName: string;
  setCreateName: (value: string) => void;
  submitCreate: () => void;
  cancelCreate: () => void;
  renamingPath: string | null;
  renamingValue: string;
  setRenamingValue: (value: string) => void;
  submitRename: () => void;
  cancelRename: () => void;
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

  const isRenaming = renamingPath === entry.path;

  const handleClick = async () => {
    if (isRenaming) return;
    if (entry.isDir) {
      onActivateDir(entry.path);
      onActivatePath(entry.path);
      handleToggle();
    } else {
      try {
        const parentPath = entry.path.split("/").slice(0, -1).join("/");
        onActivateDir(parentPath);
        onActivatePath(entry.path);
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
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "file-tree-row",
          !entry.isDir && "file-tree-row-file",
          activePath === entry.path && "file-tree-row-active"
        )}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick();
          }
        }}
        onContextMenu={(event) => {
          onActivatePath(entry.path);
          onActivateDir(
            entry.isDir
              ? entry.path
              : entry.path.split("/").slice(0, -1).join("/")
          );
          onContextTarget({
            type: entry.isDir ? "folder" : "file",
            path: entry.path,
            name: entry.name,
          });
        }}
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
            {isRenaming ? (
              <input
                value={renamingValue}
                onChange={(event) => setRenamingValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submitRename();
                  } else if (event.key === "Escape") {
                    cancelRename();
                  }
                }}
                onBlur={cancelRename}
                className="file-tree-rename-input"
              />
            ) : (
              <span className="file-tree-name truncate">{entry.name}</span>
            )}
      </div>
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
  const [activePath, setActivePath] = useState("");
  const [contextTarget, setContextTarget] = useState<ContextTarget>({
    type: "blank",
  });
  const [createDraft, setCreateDraft] = useState<{
    type: "file" | "dir";
    parentPath: string;
  } | null>(null);
  const [createName, setCreateName] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");

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
    setRenamingPath(null);
    setRenamingValue("");
    loadRoot();
  };

  const handleCollapseAll = () => {
    setCollapseSignal((value) => value + 1);
    setCreateDraft(null);
    setCreateName("");
    setRenamingPath(null);
    setRenamingValue("");
  };

  const startCreate = (type: "file" | "dir", parentPath: string) => {
    setRenamingPath(null);
    setRenamingValue("");
    setCreateName("");
    setCreateDraft({ type, parentPath });
  };

  const handleCreateFile = async () => {
    startCreate("file", activeDirPath);
  };

  const handleCreateDir = async () => {
    startCreate("dir", activeDirPath);
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

  const startRename = (path: string, name: string) => {
    setCreateDraft(null);
    setCreateName("");
    setRenamingPath(path);
    setRenamingValue(name);
  };

  const cancelRename = () => {
    setRenamingPath(null);
    setRenamingValue("");
  };

  const submitRename = async () => {
    if (!renamingPath) return;
    const trimmed = renamingValue.trim();
    if (!trimmed) {
      cancelRename();
      return;
    }
    if (/[\\/]/.test(trimmed)) {
      window.alert("名称不能包含 / 或 \\");
      return;
    }
    try {
      await invoke("rename_entry", {
        payload: {
          workspacePath,
          oldPath: renamingPath,
          newName: trimmed,
        },
      });
      handleRefresh();
      const parentPath = renamingPath.split("/").slice(0, -1).join("/");
      const newPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
      setActivePath(newPath);
      setActiveDirPath(parentPath);
    } catch (err) {
      console.error("Failed to rename entry:", err);
      window.alert(String(err));
    } finally {
      cancelRename();
    }
  };

  const deleteEntry = async (path: string, isDir: boolean) => {
    const message = isDir
      ? "删除文件夹（将递归删除）？"
      : "删除文件？";
    if (!window.confirm(message)) return;
    try {
      await invoke("delete_entry", {
        payload: { workspacePath, path, isDir },
      });
      handleRefresh();
    } catch (err) {
      console.error("Failed to delete entry:", err);
      window.alert(String(err));
    }
  };

  const openFile = async (path: string) => {
    try {
      const content = (await invoke("read_file", {
        payload: { workspacePath, path },
      })) as string;
      onSelectFile(path, content);
    } catch (err) {
      console.error("Failed to read file:", err);
      window.alert(String(err));
    }
  };

  const copyRelativePath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch (err) {
      window.alert(String(err));
    }
  };

  const revealInFinder = async (path: string) => {
    try {
      await invoke("reveal_in_file_manager", {
        payload: { workspacePath, path },
      });
    } catch (err) {
      window.alert(String(err));
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
      <ContextMenu>
        <ContextMenuTrigger
          asChild
          onContextMenu={(event) => {
            if ((event.target as HTMLElement)?.closest(".file-tree-row")) return;
            setContextTarget({ type: "blank" });
          }}
        >
          <div className="flex-1 min-h-0">
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
                        createDraft.type === "dir"
                          ? "新建文件夹"
                          : "新建文件"
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
                    activePath={activePath}
                    onActivateDir={setActiveDirPath}
                    onActivatePath={setActivePath}
                    createDraft={createDraft}
                    createName={createName}
                    setCreateName={setCreateName}
                    submitCreate={submitCreate}
                    cancelCreate={cancelCreate}
                    onContextTarget={setContextTarget}
                    renamingPath={renamingPath}
                    renamingValue={renamingValue}
                    setRenamingValue={setRenamingValue}
                    submitRename={submitRename}
                    cancelRename={cancelRename}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {contextTarget.type === "file" && (
            <>
              <ContextMenuLabel>文件</ContextMenuLabel>
              <ContextMenuItem onSelect={() => openFile(contextTarget.path)}>
                打开
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() =>
                  startRename(contextTarget.path, contextTarget.name)
                }
              >
                重命名
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => deleteEntry(contextTarget.path, false)}
              >
                删除
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => copyRelativePath(contextTarget.path)}
              >
                复制相对路径
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => revealInFinder(contextTarget.path)}
              >
                Reveal in Finder
              </ContextMenuItem>
            </>
          )}
          {contextTarget.type === "folder" && (
            <>
              <ContextMenuLabel>文件夹</ContextMenuLabel>
              <ContextMenuItem
                onSelect={() => startCreate("file", contextTarget.path)}
              >
                新建文件
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => startCreate("dir", contextTarget.path)}
              >
                新建文件夹
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() =>
                  startRename(contextTarget.path, contextTarget.name)
                }
              >
                重命名
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => deleteEntry(contextTarget.path, true)}
              >
                删除
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => copyRelativePath(contextTarget.path)}
              >
                复制相对路径
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => revealInFinder(contextTarget.path)}
              >
                Reveal in Finder
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={handleRefresh}>刷新</ContextMenuItem>
              <ContextMenuItem onSelect={handleCollapseAll}>
                折叠所有文件夹
              </ContextMenuItem>
            </>
          )}
          {contextTarget.type === "blank" && (
            <>
              <ContextMenuLabel>空白区域</ContextMenuLabel>
              <ContextMenuItem onSelect={() => startCreate("file", "")}>
                新建文件
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => startCreate("dir", "")}>
                新建文件夹
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={handleRefresh}>刷新</ContextMenuItem>
              <ContextMenuItem onSelect={handleCollapseAll}>
                折叠所有文件夹
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
