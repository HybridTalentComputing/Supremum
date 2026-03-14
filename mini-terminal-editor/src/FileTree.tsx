/**
 * FileTree: react-arborist powered file tree
 *
 * DRAG-DROP NOTE: react-arborist uses react-dnd with HTML5Backend, which is
 * BROKEN in Tauri/WKWebView on macOS. We implement a custom pointer-events-based
 * drag-drop system that works on all platforms.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";
import { Tree, type NodeRendererProps, type TreeApi, type NodeApi } from "react-arborist";
import {
  FilePlus,
  FolderPlus,
  ChevronsUp,
  RefreshCw,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Search,
  X,
} from "lucide-react";
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
import type { FileNode } from "./fileTreeTypes";
import { getFileIcon } from "./fileTreeTypes";
import { useTreeData } from "./fileTreeUtils";
import {
  invokeReadFile,
  invokeCreateFile,
  invokeCreateDir,
  invokeRename,
  invokeDelete,
  invokeMove,
  invokeReveal,
} from "./fileTreeOps";
import { useFileTreeDnd, type DragState } from "./fileTreeDnd";

// ─── Types ────────────────────────────────────────────────────────────────────

type FileTreeProps = {
  workspacePath: string;
  onSelectFile: (path: string, content: string) => void;
};

type ContextTarget =
  | { type: "file"; path: string; name: string }
  | { type: "folder"; path: string; name: string }
  | { type: "blank" };

type CreateState = { parentDir: string; type: "file" | "dir" } | null;

// ─── Context ──────────────────────────────────────────────────────────────────

type FileTreeCtx = {
  setContextTarget: (t: ContextTarget) => void;
  dragState: DragState | null;
  isDragging: (id: string) => boolean;
  startDrag: (ids: string[], clientY: number) => void;
};
const FileTreeContext = createContext<FileTreeCtx>({
  setContextTarget: () => {},
  dragState: null,
  isDragging: () => false,
  startDrag: () => {},
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parentOf(id: string) {
  return id.includes("/") ? id.substring(0, id.lastIndexOf("/")) : "";
}

/** Get the best parent dir for toolbar create: selected node → focused node → root */
function resolveParentDir(tree: TreeApi<FileNode> | undefined): string {
  const node =
    (tree?.selectedNodes?.[0] as NodeApi<FileNode> | undefined) ??
    (tree?.focusedNode as NodeApi<FileNode> | undefined);
  if (!node) return "";
  return node.data.isDir ? node.id : parentOf(node.id);
}

// ─── Inline create input (replaces window.prompt — unreliable in Tauri) ───────

type CreateInputProps = {
  type: "file" | "dir";
  onSubmit: (name: string) => void;
  onCancel: () => void;
};

function CreateInputDialog({ type, onSubmit, onCancel }: CreateInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const val = inputRef.current?.value.trim() ?? "";
    if (val) onSubmit(val);
    else onCancel();
  };

  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}
    >
      <div className="w-56 rounded-xl border border-border/50 bg-background/95 p-4 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <p className="mb-3 text-sm font-semibold text-foreground">
          {type === "dir" ? "新建文件夹" : "新建文件"}
        </p>
        <input
          ref={inputRef}
          className={cn(
            "mb-4 w-full rounded-md border border-border/60 bg-input/30 px-3 py-1.5",
            "text-sm text-foreground placeholder:text-muted-foreground",
            "outline-none focus:border-ring focus:ring-1 focus:ring-ring/40"
          )}
          placeholder={type === "dir" ? "文件夹名称" : "文件名称"}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onMouseDown={(e) => { e.preventDefault(); cancel(); }}>
            取消
          </Button>
          <Button size="sm" onMouseDown={(e) => { e.preventDefault(); commit(); }}>
            确认
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Node renderer ────────────────────────────────────────────────────────────

function FileNodeRenderer({ node, style }: NodeRendererProps<FileNode>) {
  const ctx = useContext(FileTreeContext);
  const rowRef = useRef<HTMLDivElement>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  const { Icon, color } = node.data.isDir
    ? node.isOpen
      ? { Icon: FolderOpen, color: "#f5a623" }
      : { Icon: Folder, color: "#f5a623" }
    : getFileIcon(node.data.name);

  const isBeingDragged = ctx.isDragging(node.id);
  const isDropTarget = ctx.dragState?.dropTargetId === node.id && node.data.isDir;

  // Pointer events for custom drag system
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only start drag on left button
    if (e.button !== 0) return;
    // Don't start drag on checkbox/chevron
    if ((e.target as HTMLElement).closest(".file-tree-chevron")) return;

    dragStartPos.current = { x: e.clientX, y: e.clientY };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!dragStartPos.current) return;
      const dx = moveEvent.clientX - dragStartPos.current.x;
      const dy = moveEvent.clientY - dragStartPos.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Start drag after moving 5px
      if (distance > 5) {
        // Get selected node IDs (or just this node if not selected)
        const dragIds = node.isSelected
          ? Array.from(node.tree.selectedNodes).map((n: NodeApi<FileNode>) => n.id)
          : [node.id];

        ctx.startDrag(dragIds, moveEvent.clientY);
        cleanup();
      }
    };

    const handlePointerUp = () => {
      cleanup();
    };

    const cleanup = () => {
      dragStartPos.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [ctx, node]);

  return (
    <div
      ref={rowRef}
      style={style}
      className="file-tree-row"
      data-node-id={node.id}
      data-selected={node.isSelected ? "true" : undefined}
      data-drop-target={isDropTarget ? "true" : undefined}
      data-focused={node.isFocused ? "true" : undefined}
      data-dragging={isBeingDragged ? "true" : undefined}
      onClick={(e) => node.handleClick(e)}
      onPointerDown={handlePointerDown}
      onContextMenu={() => {
        ctx.setContextTarget(
          node.data.isDir
            ? { type: "folder", path: node.id, name: node.data.name }
            : { type: "file",   path: node.id, name: node.data.name }
        );
      }}
    >
      {/* Manual indent — we pass indent={0} to Tree so we control it here */}
      <span style={{ width: node.level * 12, flexShrink: 0 }} />

      {/* Expand/collapse arrow */}
      {node.data.isDir ? (
        <span
          className="file-tree-chevron file-tree-icon-chevron"
          onClick={(e) => { e.stopPropagation(); node.toggle(); }}
        >
          {node.isOpen
            ? <ChevronDown className="size-3.5 file-tree-icon-svg" />
            : <ChevronRight className="size-3.5 file-tree-icon-svg" />}
        </span>
      ) : (
        <span className="file-tree-spacer" />
      )}

      {/* Icon */}
      <span className="file-tree-icon" style={{ color }}>
        <Icon className="size-3.5 file-tree-icon-svg" />
      </span>

      {/* Name or rename input */}
      {node.isEditing ? <RenameInput node={node} /> : (
        <span className="file-tree-name truncate">{node.data.name}</span>
      )}
    </div>
  );
}

function RenameInput({ node }: { node: NodeApi<FileNode> }) {
  const ref = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (!node.data.isDir) {
      const dot = node.data.name.lastIndexOf(".");
      el.setSelectionRange(0, dot > 0 ? dot : node.data.name.length);
    } else {
      el.select();
    }
  }, []);

  const submit = (value: string) => {
    if (submitted.current) return;
    submitted.current = true;
    node.submit(value);
  };
  const reset = () => {
    if (submitted.current) return;
    submitted.current = true;
    node.reset();
  };

  return (
    <input
      ref={ref}
      defaultValue={node.data.name}
      className="file-tree-rename-input"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") reset();
        else if (e.key === "Enter") submit(e.currentTarget.value);
      }}
      onBlur={(e) => reset()}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FileTree({ workspacePath, onSelectFile }: FileTreeProps) {
  const treeRef = useRef<TreeApi<FileNode> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);
  const [searchTerm, setSearchTerm] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [contextTarget, setContextTarget] = useState<ContextTarget>({ type: "blank" });
  const [createState, setCreateState] = useState<CreateState>(null);
  const [treeVersion, setTreeVersion] = useState(0);

  const { treeData, loading, error, loadDir, loadRoot, refreshDir } = useTreeData(workspacePath);

  useEffect(() => { loadRoot(); }, [loadRoot]);

  // ─── Custom drag-drop helpers ─────────────────────────────────────────────

  // Get all visible node IDs from the tree
  const getVisibleNodeIds = useCallback((): string[] => {
    const tree = treeRef.current;
    if (!tree) return [];

    const visibleIds: string[] = [];
    const traverse = (node: NodeApi<FileNode>) => {
      visibleIds.push(node.id);
      if (node.isOpen && node.children) {
        node.children.forEach((child: NodeApi<FileNode>) => traverse(child));
      }
    };

    // Use tree.root (not roots) which returns the root nodes
    const rootNodes = tree.root;
    if (Array.isArray(rootNodes)) {
      rootNodes.forEach((rootNode: NodeApi<FileNode>) => traverse(rootNode));
    } else if (rootNodes) {
      traverse(rootNodes as NodeApi<FileNode>);
    }
    return visibleIds;
  }, []);

  // Get DOM element for a node ID
  const getNodeElement = useCallback((id: string): HTMLElement | null => {
    return containerRef.current?.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
  }, []);

  // Get node data for a node ID
  const getNodeData = useCallback((id: string): FileNode | null => {
    const node = treeRef.current?.get(id) as NodeApi<FileNode> | null;
    return node?.data ?? null;
  }, []);

  // ─── Custom drag-drop handler (separate from react-arborist's onMove) ───────

  const handleCustomDragMove = useCallback(async ({
    dragIds,
    parentId,
  }: {
    dragIds: string[];
    parentId: string | null;
    index: number;
  }) => {
    const destDir = parentId ?? "";
    try {
      for (const srcId of dragIds) {
        await invokeMove(workspacePath, srcId, destDir);
      }
      // 强制刷新根目录并递增版本号以触发 Tree 重新渲染
      await refreshDir("");
      setTreeVersion((v) => v + 1);
    } catch (err) {
      window.alert(String(err));
    }
  }, [workspacePath, refreshDir]);

  // ─── Custom drag-drop system ──────────────────────────────────────────────

  const {
    dragState,
    startDrag,
    cancelDrag,
    isDragging,
  } = useFileTreeDnd({
    onMove: handleCustomDragMove,
    getVisibleNodeIds,
    getNodeElement,
    getNodeData,
    rowHeight: 24,
  });

  // Track container height for react-window virtualisation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setContainerHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ─── Create file/folder ────────────────────────────────────────────────────

  const startCreate = useCallback((type: "file" | "dir", parentDir: string) => {
    setCreateState({ type, parentDir });
  }, []);

  const submitCreate = useCallback(async (name: string) => {
    if (!createState) return;
    const { type, parentDir } = createState;
    const trimmed = name.trim();
    if (!trimmed) { setCreateState(null); return; }
    const fullPath = parentDir ? `${parentDir}/${trimmed}` : trimmed;
    try {
      if (type === "dir") await invokeCreateDir(workspacePath, fullPath);
      else await invokeCreateFile(workspacePath, fullPath);
      setCreateState(null);
      await refreshDir(parentDir);
    } catch (err) {
      setCreateState(null);
      window.alert(String(err));
    }
  }, [createState, workspacePath, refreshDir]);

  const cancelCreate = useCallback(() => setCreateState(null), []);

  // ─── Tree handlers ─────────────────────────────────────────────────────────

  const handleActivate = useCallback(async (node: NodeApi<FileNode>) => {
    if (!node.data.isDir) {
      try {
        const content = await invokeReadFile(workspacePath, node.id);
        onSelectFile(node.id, content);
      } catch (err) {
        console.error("Failed to read file:", err);
      }
    }
  }, [workspacePath, onSelectFile]);

  const handleToggle = useCallback(async (id: string) => {
    const node = treeRef.current?.get(id) as NodeApi<FileNode> | null;
    if (node?.data.isDir && node.data.children === null) {
      await loadDir(id);
    }
  }, [loadDir]);

  const handleRename = useCallback(async ({
    id, name,
  }: { id: string; name: string; node: NodeApi<FileNode> }) => {
    const trimmed = name.trim();
    const currentName = id.split("/").pop() ?? "";
    if (!trimmed || /[\\/]/.test(trimmed) || trimmed === currentName) return;
    try {
      await invokeRename(workspacePath, id, trimmed);
      await refreshDir(parentOf(id));
    } catch (err) {
      window.alert(String(err));
    }
  }, [workspacePath, refreshDir]);

  const handleDelete = useCallback(async ({
    ids, nodes,
  }: { ids: string[]; nodes: NodeApi<FileNode>[] }) => {
    const hasDir = nodes.some((n) => n.data.isDir);
    const msg = hasDir
      ? `删除 ${ids.length} 个项目（含文件夹，将递归删除）？`
      : `删除 ${ids.length} 个文件？`;
    if (!window.confirm(msg)) return;
    try {
      for (let i = 0; i < ids.length; i++) {
        await invokeDelete(workspacePath, ids[i], nodes[i].data.isDir);
      }
      const parents = new Set(ids.map(parentOf));
      for (const p of parents) await refreshDir(p);
    } catch (err) {
      window.alert(String(err));
    }
  }, [workspacePath, refreshDir]);

  const handleMove = useCallback(async ({
    dragIds, parentId,
  }: {
    dragIds: string[];
    dragNodes: NodeApi<FileNode>[];
    parentId: string | null;
    parentNode: NodeApi<FileNode> | null;
    index: number;
  }) => {
    const destDir = parentId ?? "";
    try {
      for (const srcId of dragIds) {
        await invokeMove(workspacePath, srcId, destDir);
      }
      const parents = new Set([...dragIds.map(parentOf), destDir]);
      for (const p of parents) await refreshDir(p);
    } catch (err) {
      window.alert(String(err));
    }
  }, [workspacePath, refreshDir]);

  // ─── disableDrop ───────────────────────────────────────────────────────────
  const disableDrop = useCallback(({
    parentNode,
  }: {
    parentNode: NodeApi<FileNode>;
    dragNodes: NodeApi<FileNode>[];
    index: number;
  }): boolean => {
    if (parentNode.level < 0) return false;
    return !parentNode.data.isDir;
  }, []);

  // ─── Context menu & toolbar helpers ───────────────────────────────────────

  const doOpenFile  = useCallback(async (path: string) => {
    try {
      const content = await invokeReadFile(workspacePath, path);
      onSelectFile(path, content);
    } catch (err) { window.alert(String(err)); }
  }, [workspacePath, onSelectFile]);

  const doRename = useCallback((path: string) => {
    (treeRef.current?.get(path) as NodeApi<FileNode> | null)?.edit();
  }, []);

  const doDelete = useCallback(async (path: string, isDir: boolean) => {
    const msg = isDir ? "删除文件夹（将递归删除）？" : "删除文件？";
    if (!window.confirm(msg)) return;
    try {
      await invokeDelete(workspacePath, path, isDir);
      await refreshDir(parentOf(path));
    } catch (err) { window.alert(String(err)); }
  }, [workspacePath, refreshDir]);

  const doCopyPath = useCallback(async (path: string) => {
    try { await navigator.clipboard.writeText(path); }
    catch (err) { window.alert(String(err)); }
  }, []);

  const doReveal = useCallback(async (path: string) => {
    try { await invokeReveal(workspacePath, path); }
    catch (err) { window.alert(String(err)); }
  }, [workspacePath]);

  const handleRefresh = useCallback(async () => {
    await refreshDir("");
    setTreeVersion((v) => v + 1);
  }, [refreshDir]);
  const handleCollapseAll = useCallback(() => treeRef.current?.closeAll(), []);

  const toolbarNewFile = useCallback(() => {
    startCreate("file", resolveParentDir(treeRef.current));
  }, [startCreate]);

  const toolbarNewDir = useCallback(() => {
    startCreate("dir", resolveParentDir(treeRef.current));
  }, [startCreate]);

  const searchMatch = useCallback(
    (node: NodeApi<FileNode>, term: string) =>
      node.data.name.toLowerCase().includes(term.toLowerCase()),
    [],
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="file-tree-loading"><span>Loading…</span></div>;
  if (error)   return <div className="file-tree-error"><span>{error}</span></div>;

  return (
    <FileTreeContext.Provider value={{ setContextTarget, dragState, isDragging, startDrag }}>
      <div className="file-tree-panel">

        {/* Toolbar */}
        <div className="file-tree-toolbar">
          <div className="file-tree-actions">
            <Button type="button" variant="ghost" size="icon-xs" className="file-tree-action"
              onClick={toolbarNewFile} title="新建文件">
              <FilePlus className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" className="file-tree-action"
              onClick={toolbarNewDir} title="新建文件夹">
              <FolderPlus className="size-4" />
            </Button>
          </div>
          <div className="file-tree-actions">
            <Button type="button" variant="ghost" size="icon-xs" className="file-tree-action"
              onClick={() => setShowSearch((v) => !v)} title="搜索">
              <Search className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" className="file-tree-action"
              onClick={handleCollapseAll} title="折叠所有">
              <ChevronsUp className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" className="file-tree-action"
              onClick={handleRefresh} title="刷新">
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>

        {/* Search bar */}
        {showSearch && (
          <div className="file-tree-search">
            <Search className="size-3.5 shrink-0 opacity-50" />
            <input
              autoFocus
              className="file-tree-search-input"
              placeholder="搜索文件..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSearchTerm(""); setShowSearch(false); }
              }}
            />
            {searchTerm && (
              <button className="file-tree-search-clear" onClick={() => setSearchTerm("")}>
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Tree + context menu */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={containerRef}
              className="file-tree-container"
              onContextMenu={(e) => {
                if (!(e.target as HTMLElement)?.closest(".file-tree-row")) {
                  setContextTarget({ type: "blank" });
                }
              }}
            >
              <Tree<FileNode>
                key={treeVersion}
                ref={treeRef}
                data={treeData}
                idAccessor="id"
                childrenAccessor={(d: FileNode): readonly FileNode[] | null => {
                  if (!d.isDir) return null;
                  if (d.children === null) return [];
                  return d.children ?? [];
                }}
                onActivate={handleActivate}
                onToggle={handleToggle}
                onRename={handleRename}
                onDelete={handleDelete}
                onMove={handleMove}
                disableDrop={disableDrop}
                searchTerm={searchTerm || undefined}
                searchMatch={searchMatch}
                openByDefault={false}
                rowHeight={24}
                indent={0}
                width="100%"
                height={containerHeight}
                className="file-tree"
                rowClassName="file-tree-row-wrapper"
              >
                {FileNodeRenderer}
              </Tree>
            </div>
          </ContextMenuTrigger>

          <ContextMenuContent>
            {contextTarget.type === "file" && (() => {
              const { path } = contextTarget;
              return <>
                <ContextMenuLabel>文件</ContextMenuLabel>
                <ContextMenuItem onSelect={() => doOpenFile(path)}>打开</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => doRename(path)}>重命名</ContextMenuItem>
                <ContextMenuItem onSelect={() => doDelete(path, false)}>删除</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => doCopyPath(path)}>复制相对路径</ContextMenuItem>
                <ContextMenuItem onSelect={() => doReveal(path)}>Reveal in Finder</ContextMenuItem>
              </>;
            })()}
            {contextTarget.type === "folder" && (() => {
              const { path } = contextTarget;
              return <>
                <ContextMenuLabel>文件夹</ContextMenuLabel>
                <ContextMenuItem onSelect={() => startCreate("file", path)}>新建文件</ContextMenuItem>
                <ContextMenuItem onSelect={() => startCreate("dir",  path)}>新建文件夹</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => doRename(path)}>重命名</ContextMenuItem>
                <ContextMenuItem onSelect={() => doDelete(path, true)}>删除</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => doCopyPath(path)}>复制相对路径</ContextMenuItem>
                <ContextMenuItem onSelect={() => doReveal(path)}>Reveal in Finder</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => refreshDir(path)}>刷新</ContextMenuItem>
                <ContextMenuItem onSelect={handleCollapseAll}>折叠所有文件夹</ContextMenuItem>
              </>;
            })()}
            {contextTarget.type === "blank" && <>
              <ContextMenuLabel>空白区域</ContextMenuLabel>
              <ContextMenuItem onSelect={() => startCreate("file", "")}>新建文件</ContextMenuItem>
              <ContextMenuItem onSelect={() => startCreate("dir",  "")}>新建文件夹</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={handleRefresh}>刷新</ContextMenuItem>
              <ContextMenuItem onSelect={handleCollapseAll}>折叠所有文件夹</ContextMenuItem>
            </>}
          </ContextMenuContent>
        </ContextMenu>

        {/* Inline create dialog */}
        {createState && (
          <CreateInputDialog
            type={createState.type}
            onSubmit={submitCreate}
            onCancel={cancelCreate}
          />
        )}

        {/* Drag preview */}
        {dragState && (
          <div
            className="file-tree-drag-preview"
            style={{
              position: "fixed",
              left: 0,
              top: dragState.dragPreviewY - 12,
              pointerEvents: "none",
              zIndex: 9999,
            }}
          >
            <div className="file-tree-drag-preview-content">
              {dragState.dragIds.length === 1
                ? dragState.dragIds[0].split("/").pop()
                : `${dragState.dragIds.length} 个项目`}
            </div>
          </div>
        )}

      </div>
    </FileTreeContext.Provider>
  );
}
