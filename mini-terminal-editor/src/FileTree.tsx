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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";
import { createPortal } from "react-dom";
import { Tree, type NodeRendererProps, type TreeApi, type NodeApi } from "react-arborist";
import {
  FilePlus,
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
import { confirm } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import type { FileNode } from "./fileTreeTypes";
import { getFileIconUrl } from "./fileTreeTypes";
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
import { shouldReadFileContentForOpen } from "./filePreview";

// ─── Types ────────────────────────────────────────────────────────────────────

type FileTreeProps = {
  workspacePath: string;
  onSelectFile: (path: string, content: string) => void;
  active?: boolean;
  onAddClaudeContext?: (path: string, kind: "file" | "folder") => void;
  onAddClaudeContextBatch?: (
    entries: Array<{ path: string; kind: "file" | "folder" }>
  ) => void | Promise<void>;
  canAddClaudeContext?: boolean;
};

type ClaudeContextEntry = { path: string; kind: "file" | "folder"; name: string };

type ContextTarget =
  | { type: "file"; path: string; name: string }
  | { type: "folder"; path: string; name: string }
  | { type: "multi"; items: ClaudeContextEntry[] }
  | { type: "blank"; parentDir: string };

type CreateState = { parentDir: string; type: "file" | "dir" } | null;
type OpenStateSnapshot = Record<string, boolean>;
type RecentlyCreatedState = { parentDir: string; path: string } | null;
const CREATE_PLACEHOLDER_PREFIX = "__create__:";

// ─── Context ──────────────────────────────────────────────────────────────────

type FileTreeCtx = {
  setContextTarget: (t: ContextTarget) => void;
  dragState: DragState | null;
  isDragging: (id: string) => boolean;
  startDrag: (ids: string[], clientY: number) => void;
  submitCreate?: (name: string) => void;
  cancelCreate?: () => void;
};
const FileTreeContext = createContext<FileTreeCtx>({
  setContextTarget: () => {},
  dragState: null,
  isDragging: () => false,
  startDrag: () => {},
  submitCreate: undefined,
  cancelCreate: undefined,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parentOf(id: string) {
  return id.includes("/") ? id.substring(0, id.lastIndexOf("/")) : "";
}

function resolveAbsolutePath(workspacePath: string, path: string) {
  if (!path) return workspacePath;
  if (path.startsWith("/")) return path;
  return `${workspacePath.replace(/\/$/, "")}/${path}`;
}

function createClaudeContextEntry(node: NodeApi<FileNode>): ClaudeContextEntry | null {
  if (isCreatePlaceholderId(node.id)) return null;
  return {
    path: node.id,
    kind: node.data.isDir ? "folder" : "file",
    name: node.data.name,
  };
}

function resolveCreateParentFromNode(node: NodeApi<FileNode> | null) {
  if (!node) return "";
  if (node.data.isDir) {
    return node.isOpen ? node.id : parentOf(node.id);
  }
  return parentOf(node.id);
}

function getCreatePlaceholderId(parentDir: string, type: "file" | "dir") {
  const name = `${CREATE_PLACEHOLDER_PREFIX}${type}`;
  return parentDir ? `${parentDir}/${name}` : name;
}

function isCreatePlaceholderId(id: string) {
  return (id.split("/").pop() ?? "").startsWith(CREATE_PLACEHOLDER_PREFIX);
}

function injectCreatePlaceholder(
  nodes: FileNode[],
  createState: CreateState,
  parentPath = ""
): FileNode[] {
  const nextNodes = nodes.map((node) => {
    if (!node.isDir || !node.children) return node;
    const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;
    return {
      ...node,
      children: injectCreatePlaceholder(node.children, createState, nodePath),
    };
  });

  if (!createState || createState.parentDir !== parentPath) {
    return nextNodes;
  }

  const placeholderName = `${CREATE_PLACEHOLDER_PREFIX}${createState.type}`;
  const placeholderNode: FileNode = {
    id: getCreatePlaceholderId(parentPath, createState.type),
    name: placeholderName,
    isDir: false,
    children: undefined,
  };

  return [placeholderNode, ...nextNodes];
}

function promoteRecentlyCreated(
  nodes: FileNode[],
  recent: RecentlyCreatedState,
  parentPath = ""
): FileNode[] {
  const nextNodes = nodes.map((node) => {
    if (!node.isDir || !node.children) return node;
    const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name;
    return {
      ...node,
      children: promoteRecentlyCreated(node.children, recent, nodePath),
    };
  });

  if (!recent || recent.parentDir !== parentPath) {
    return nextNodes;
  }

  const index = nextNodes.findIndex((node) => node.id === recent.path);
  if (index <= 0) return nextNodes;

  const reordered = [...nextNodes];
  const [createdNode] = reordered.splice(index, 1);
  reordered.unshift(createdNode);
  return reordered;
}

/** Get the best parent dir for toolbar create: selected node → focused node → root */
function resolveParentDir(tree: TreeApi<FileNode> | undefined): string {
  const node =
    (tree?.selectedNodes?.[0] as NodeApi<FileNode> | undefined) ??
    (tree?.focusedNode as NodeApi<FileNode> | undefined);
  if (!node) return "";
  return node.data.isDir ? node.id : parentOf(node.id);
}

// ─── Inline create input ──────────────────────────────────────────────────────

type CreateInputProps = {
  type: "file" | "dir";
  onSubmit: (name: string) => void;
  onCancel: () => void;
};

function CreateInlineInput({ type, onSubmit, onCancel }: CreateInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const cancelByOutsidePointer = useRef(false);

  useLayoutEffect(() => {
    const focusInput = () => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    };

    focusInput();
    const rafId = requestAnimationFrame(focusInput);
    const timeoutId = window.setTimeout(focusInput, 0);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
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

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const input = inputRef.current;
      const target = event.target;
      if (!input || !(target instanceof Node)) return;
      if (input.contains(target)) return;
      cancelByOutsidePointer.current = true;
      cancel();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  return (
    <input
      ref={inputRef}
      autoFocus
      className="file-tree-create-input"
      placeholder={type === "dir" ? "Folder name" : "File name"}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={() => {
        window.setTimeout(() => {
          if (done.current || cancelByOutsidePointer.current) return;
          inputRef.current?.focus();
        }, 0);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// ─── File Icon Component (JetBrains-style SVG icons) ───────────────────────

function FileIcon({ fileName, isOpen }: { fileName: string; isOpen?: boolean }) {
  const iconUrl = getFileIconUrl(fileName, false, isOpen);

  if (!iconUrl) {
    // Show placeholder while loading
    return <div className="size-4" style={{ width: 16, height: 16 }} />;
  }

  return (
    <img
      src={iconUrl}
      alt=""
      className="size-4 file-tree-icon-img"
      draggable={false}
      style={{ width: 16, height: 16 }}
    />
  );
}

function FolderIcon({ folderName, isOpen }: { folderName: string; isOpen: boolean }) {
  const iconUrl = getFileIconUrl(folderName, true, isOpen);

  if (!iconUrl) {
    // Show placeholder while loading
    return <div className="size-4" style={{ width: 16, height: 16 }} />;
  }

  return (
    <img
      src={iconUrl}
      alt=""
      className="size-4 file-tree-icon-img"
      draggable={false}
      style={{ width: 16, height: 16 }}
    />
  );
}

// ─── Node renderer ────────────────────────────────────────────────────────────

function FileNodeRenderer({ node, style }: NodeRendererProps<FileNode>) {
  const ctx = useContext(FileTreeContext);
  const rowRef = useRef<HTMLDivElement>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const isCreatePlaceholder = isCreatePlaceholderId(node.id);
  const createType = isCreatePlaceholder
    ? (((node.id.split("/").pop() ?? "").slice(CREATE_PLACEHOLDER_PREFIX.length)) as "file" | "dir")
    : null;

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

  const handleRowClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isCreatePlaceholder) return;
    node.handleClick(e);
    if (node.data.isDir) {
      node.toggle();
    }
  }, [isCreatePlaceholder, node]);

  return (
    <div
      ref={rowRef}
      style={style}
      className="file-tree-row"
      data-creating={isCreatePlaceholder ? "true" : undefined}
      data-node-id={node.id}
      data-selected={node.isSelected ? "true" : undefined}
      data-drop-target={isDropTarget ? "true" : undefined}
      data-focused={node.isFocused ? "true" : undefined}
      data-dragging={isBeingDragged ? "true" : undefined}
      onClick={handleRowClick}
      onPointerDown={handlePointerDown}
      onContextMenu={(e) => {
        if (isCreatePlaceholder) return;
        if (!(e.target as HTMLElement).closest(".file-tree-row-main")) {
          ctx.setContextTarget({
            type: "blank",
            parentDir: resolveCreateParentFromNode(node as NodeApi<FileNode>),
          });
          return;
        }

        const selectedNodes = Array.from(node.tree.selectedNodes) as NodeApi<FileNode>[];
        if (node.isSelected && selectedNodes.length > 1) {
          const items = selectedNodes
            .map((selectedNode) => createClaudeContextEntry(selectedNode))
            .filter((item): item is ClaudeContextEntry => Boolean(item));

          if (items.length > 1) {
            ctx.setContextTarget({ type: "multi", items });
            return;
          }
        }

        ctx.setContextTarget(
          node.data.isDir
            ? { type: "folder", path: node.id, name: node.data.name }
            : { type: "file",   path: node.id, name: node.data.name }
        );
      }}
    >
      <div className="file-tree-row-main">
        {/* Manual indent — we pass indent={0} to Tree so we control it here */}
        <span style={{ width: node.level * 12, flexShrink: 0 }} />

        {/* Expand/collapse arrow */}
        {node.data.isDir ? (
          <span
            className="file-tree-chevron file-tree-icon-chevron"
            onClick={(e) => { e.stopPropagation(); node.toggle(); }}
          >
            {node.isOpen
              ? <ChevronDown className="size-4 file-tree-icon-svg" />
              : <ChevronRight className="size-4 file-tree-icon-svg" />}
          </span>
        ) : (
          <span className="file-tree-spacer" />
        )}

        {/* Icon */}
        <span className="file-tree-icon">
          {isCreatePlaceholder && createType
            ? createType === "dir"
              ? <Folder className="size-4 file-tree-icon-svg" />
              : <FilePlus className="size-4 file-tree-icon-svg" />
            : node.data.isDir
            ? <FolderIcon folderName={node.data.name} isOpen={node.isOpen} />
            : <FileIcon fileName={node.data.name} />
          }
        </span>

        {/* Name or rename input */}
        {isCreatePlaceholder && createType ? (
          <CreateInlineInput
            type={createType}
            onSubmit={(name) => {
              ctx.submitCreate?.(name);
            }}
            onCancel={() => {
              ctx.cancelCreate?.();
            }}
          />
        ) : node.isEditing ? <RenameInput node={node} /> : (
          <span className="file-tree-name truncate">{node.data.name}</span>
        )}
      </div>
    </div>
  );
}

function RenameInput({ node }: { node: NodeApi<FileNode> }) {
  const ref = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  const cancelled = useRef(false);

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
    cancelled.current = true;
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
      onBlur={(e) => {
        // 如果不是通过 Escape 键取消的，则自动保存
        if (!cancelled.current) {
          submit(e.currentTarget.value);
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FileTree({
  workspacePath,
  onSelectFile,
  active = false,
  onAddClaudeContext,
  onAddClaudeContextBatch,
  canAddClaudeContext = false,
}: FileTreeProps) {
  const treeRef = useRef<TreeApi<FileNode> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 320, height: 400 });
  const [openStateSnapshot, setOpenStateSnapshot] = useState<OpenStateSnapshot>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [contextTarget, setContextTarget] = useState<ContextTarget>({ type: "blank", parentDir: "" });
  const [createState, setCreateState] = useState<CreateState>(null);
  const [recentlyCreated, setRecentlyCreated] = useState<RecentlyCreatedState>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [pathPreview, setPathPreview] = useState<{ text: string; x: number; y: number } | null>(null);
  const recentlyCreatedTimeoutRef = useRef<number | null>(null);

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

  // Get container element for drag boundary detection
  const getContainerElement = useCallback((): HTMLElement | null => {
    return containerRef.current;
  }, []);

  const syncOpenStateSnapshot = useCallback(() => {
    setOpenStateSnapshot({ ...(treeRef.current?.openState ?? {}) });
  }, []);

  const refreshVisibleTreeDirs = useCallback(async () => {
    const openDirIds = Object.entries(treeRef.current?.openState ?? openStateSnapshot)
      .filter(([, isOpen]) => Boolean(isOpen))
      .map(([id]) => id)
      .filter(Boolean);

    await loadDir("");
    for (const dirId of openDirIds) {
      await loadDir(dirId);
    }
  }, [loadDir, openStateSnapshot]);

  const updateContainerSize = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const nextSize = {
      width: Math.max(0, Math.floor(rect.width)),
      height: Math.max(0, Math.floor(rect.height)),
    };

    setContainerSize((currentSize) =>
      currentSize.width === nextSize.width && currentSize.height === nextSize.height
        ? currentSize
        : nextSize
    );
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
    getContainerElement,
    rowHeight: 24,
  });

  // Track container height for react-window virtualisation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      updateContainerSize();
    });
    ro.observe(el);
    window.addEventListener("resize", updateContainerSize);
    window.visualViewport?.addEventListener("resize", updateContainerSize);
    updateContainerSize();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateContainerSize);
      window.visualViewport?.removeEventListener("resize", updateContainerSize);
    };
  }, [updateContainerSize]);

  useLayoutEffect(() => {
    updateContainerSize();
    const rafId = requestAnimationFrame(() => {
      updateContainerSize();
    });
    return () => cancelAnimationFrame(rafId);
  }, [updateContainerSize, showSearch, treeVersion, treeData]);

  useEffect(() => {
    const list = treeRef.current?.list.current as { forceUpdate?: () => void } | null;
    list?.forceUpdate?.();
  }, [containerSize]);

  useEffect(() => {
    if (!active) return;

    void refreshVisibleTreeDirs();
    const timer = window.setInterval(() => {
      void refreshVisibleTreeDirs();
    }, 2500);

    return () => {
      window.clearInterval(timer);
    };
  }, [active, refreshVisibleTreeDirs]);

  // ─── Create file/folder ────────────────────────────────────────────────────

  const startCreate = useCallback(async (type: "file" | "dir", parentDir: string) => {
    if (parentDir) {
      const node = treeRef.current?.get(parentDir) as NodeApi<FileNode> | null;
      if (node?.data.isDir && node.data.children === null) {
        await loadDir(parentDir);
      }
      treeRef.current?.open(parentDir);
      requestAnimationFrame(() => {
        syncOpenStateSnapshot();
      });
    }

    setCreateState({ type, parentDir });
  }, [loadDir, syncOpenStateSnapshot]);

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
      setRecentlyCreated({ parentDir, path: fullPath });
      if (recentlyCreatedTimeoutRef.current !== null) {
        window.clearTimeout(recentlyCreatedTimeoutRef.current);
      }
      recentlyCreatedTimeoutRef.current = window.setTimeout(() => {
        setRecentlyCreated((current) => (current?.path === fullPath ? null : current));
        recentlyCreatedTimeoutRef.current = null;
      }, 1200);
    } catch (err) {
      setCreateState(null);
      window.alert(String(err));
    }
  }, [createState, workspacePath, refreshDir]);

  const cancelCreate = useCallback(() => setCreateState(null), []);
  const displayTreeData = useMemo(
    () => promoteRecentlyCreated(injectCreatePlaceholder(treeData, createState), recentlyCreated),
    [treeData, createState, recentlyCreated],
  );

  useEffect(() => {
    return () => {
      if (recentlyCreatedTimeoutRef.current !== null) {
        window.clearTimeout(recentlyCreatedTimeoutRef.current);
      }
    };
  }, []);

  // ─── Tree handlers ─────────────────────────────────────────────────────────

  const handleActivate = useCallback(async (node: NodeApi<FileNode>) => {
    if (isCreatePlaceholderId(node.id)) return;
    if (!node.data.isDir) {
      try {
        if (!shouldReadFileContentForOpen(node.id)) {
          onSelectFile(node.id, "");
          return;
        }

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
    requestAnimationFrame(() => {
      syncOpenStateSnapshot();
    });
  }, [loadDir, syncOpenStateSnapshot]);

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
      ? `Delete ${ids.length} item(s)? Folders will be removed recursively.`
      : `Delete ${ids.length} file(s)?`;
    if (!(await confirm(msg, { title: "Subset", kind: "warning", okLabel: "OK", cancelLabel: "Cancel" }))) return;
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
      if (!shouldReadFileContentForOpen(path)) {
        onSelectFile(path, "");
        return;
      }

      const content = await invokeReadFile(workspacePath, path);
      onSelectFile(path, content);
    } catch (err) { window.alert(String(err)); }
  }, [workspacePath, onSelectFile]);

  const doRename = useCallback((path: string) => {
    (treeRef.current?.get(path) as NodeApi<FileNode> | null)?.edit();
  }, []);

  const doDelete = useCallback(async (path: string, isDir: boolean) => {
    const msg = isDir ? "Delete this folder recursively?" : "Delete this file?";
    if (!(await confirm(msg, { title: "Subset", kind: "warning", okLabel: "OK", cancelLabel: "Cancel" }))) return;
    try {
      await invokeDelete(workspacePath, path, isDir);
      await refreshDir(parentOf(path));
    } catch (err) { window.alert(String(err)); }
  }, [workspacePath, refreshDir]);

  const doCopyPath = useCallback(async (path: string) => {
    try { await navigator.clipboard.writeText(path); }
    catch (err) { window.alert(String(err)); }
  }, []);

  const doCopyAbsolutePath = useCallback(async (path: string) => {
    try { await navigator.clipboard.writeText(resolveAbsolutePath(workspacePath, path)); }
    catch (err) { window.alert(String(err)); }
  }, [workspacePath]);

  const addClaudeContextEntries = useCallback(async (entries: ClaudeContextEntry[]) => {
    if (entries.length === 0) return;
    if (onAddClaudeContextBatch) {
      await onAddClaudeContextBatch(entries.map(({ path, kind }) => ({ path, kind })));
      return;
    }
    if (!onAddClaudeContext) return;

    for (const entry of entries) {
      await onAddClaudeContext(entry.path, entry.kind);
    }
  }, [onAddClaudeContext, onAddClaudeContextBatch]);

  const showPathPreview = useCallback((text: string, target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPathPreview({
      text,
      x: rect.right + 12,
      y: rect.top + rect.height / 2,
    });
  }, []);

  const hidePathPreview = useCallback(() => {
    setPathPreview(null);
  }, []);

  const doReveal = useCallback(async (path: string) => {
    try { await invokeReveal(workspacePath, path); }
    catch (err) { window.alert(String(err)); }
  }, [workspacePath]);

  const handleRefresh = useCallback(async () => {
    await refreshDir("");
    setTreeVersion((v) => v + 1);
  }, [refreshDir]);
  const handleCollapseAll = useCallback(() => {
    treeRef.current?.closeAll();
    setOpenStateSnapshot({});
  }, []);

  const resolveBlankParentDir = useCallback((clientY: number) => {
    const rows = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>(".file-tree-row[data-node-id]") ?? []
    );

    let candidateId = "";
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.top <= clientY) {
        candidateId = row.dataset.nodeId ?? candidateId;
      } else {
        break;
      }
    }

    if (!candidateId) return "";
    const candidateNode = treeRef.current?.get(candidateId) as NodeApi<FileNode> | null;
    return resolveCreateParentFromNode(candidateNode);
  }, []);

  const searchMatch = useCallback(
    (node: NodeApi<FileNode>, term: string) =>
      node.data.name.toLowerCase().includes(term.toLowerCase()),
    [],
  );

  const treeKey = `${treeVersion}:${containerSize.height}`;

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="file-tree-loading"><span>Loading…</span></div>;
  if (error)   return <div className="file-tree-error"><span>{error}</span></div>;

  return (
    <FileTreeContext.Provider
      value={{
        setContextTarget,
        dragState,
        isDragging,
        startDrag,
        submitCreate,
        cancelCreate,
      }}
    >
      <div className="file-tree-panel">

        {/* Toolbar */}
        <div className="file-tree-toolbar">
          <div className="file-tree-toolbar-title">Explorer</div>
          <div className="file-tree-actions">
            <Button type="button" variant="ghost" size="icon-xs" className="file-tree-action"
              onClick={() => setShowSearch((v) => !v)} title="Search">
              <Search className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" className="file-tree-action"
              onClick={handleCollapseAll} title="Collapse all">
              <ChevronsUp className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" className="file-tree-action"
              onClick={handleRefresh} title="Refresh">
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
              placeholder="Search files..."
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
        <ContextMenu
          onOpenChange={(open) => {
            if (!open) {
              setPathPreview(null);
            }
          }}
        >
          <ContextMenuTrigger asChild>
            <div
              ref={containerRef}
              className="file-tree-container"
              onContextMenu={(e) => {
                if (!(e.target as HTMLElement)?.closest(".file-tree-row")) {
                  setContextTarget({ type: "blank", parentDir: resolveBlankParentDir(e.clientY) });
                }
              }}
            >
              <Tree<FileNode>
                key={treeKey}
                ref={treeRef}
                data={displayTreeData}
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
                initialOpenState={openStateSnapshot}
                rowHeight={24}
                indent={0}
                width="100%"
                height={Math.max(containerSize.height, 1)}
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
                <ContextMenuLabel>File</ContextMenuLabel>
                <ContextMenuItem onSelect={() => doOpenFile(path)}>Open</ContextMenuItem>
                <ContextMenuItem
                  disabled={!canAddClaudeContext}
                  onSelect={() => onAddClaudeContext?.(path, "file")}
                >
                  Add to Claude Code Context
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => doRename(path)}>Rename</ContextMenuItem>
                <ContextMenuItem onSelect={() => doDelete(path, false)}>Delete</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onPointerEnter={(event) => showPathPreview(path, event.currentTarget)}
                  onPointerMove={(event) => showPathPreview(path, event.currentTarget)}
                  onPointerLeave={hidePathPreview}
                  onFocus={(event) => showPathPreview(path, event.currentTarget)}
                  onBlur={hidePathPreview}
                  onSelect={() => doCopyPath(path)}
                >
                  Copy Relative Path
                </ContextMenuItem>
                <ContextMenuItem
                  onPointerEnter={(event) =>
                    showPathPreview(resolveAbsolutePath(workspacePath, path), event.currentTarget)
                  }
                  onPointerMove={(event) =>
                    showPathPreview(resolveAbsolutePath(workspacePath, path), event.currentTarget)
                  }
                  onPointerLeave={hidePathPreview}
                  onFocus={(event) =>
                    showPathPreview(resolveAbsolutePath(workspacePath, path), event.currentTarget)
                  }
                  onBlur={hidePathPreview}
                  onSelect={() => doCopyAbsolutePath(path)}
                >
                  Copy Absolute Path
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => doReveal(path)}>Reveal in Finder</ContextMenuItem>
              </>;
            })()}
            {contextTarget.type === "folder" && (() => {
              const { path } = contextTarget;
              return <>
                <ContextMenuLabel>Folder</ContextMenuLabel>
                <ContextMenuItem onSelect={() => startCreate("file", path)}>New File</ContextMenuItem>
                <ContextMenuItem onSelect={() => startCreate("dir",  path)}>New Folder</ContextMenuItem>
                <ContextMenuItem
                  disabled={!canAddClaudeContext}
                  onSelect={() => onAddClaudeContext?.(path, "folder")}
                >
                  Add to Claude Code Context
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => doRename(path)}>Rename</ContextMenuItem>
                <ContextMenuItem onSelect={() => doDelete(path, true)}>Delete</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onPointerEnter={(event) => showPathPreview(path, event.currentTarget)}
                  onPointerMove={(event) => showPathPreview(path, event.currentTarget)}
                  onPointerLeave={hidePathPreview}
                  onFocus={(event) => showPathPreview(path, event.currentTarget)}
                  onBlur={hidePathPreview}
                  onSelect={() => doCopyPath(path)}
                >
                  Copy Relative Path
                </ContextMenuItem>
                <ContextMenuItem
                  onPointerEnter={(event) =>
                    showPathPreview(resolveAbsolutePath(workspacePath, path), event.currentTarget)
                  }
                  onPointerMove={(event) =>
                    showPathPreview(resolveAbsolutePath(workspacePath, path), event.currentTarget)
                  }
                  onPointerLeave={hidePathPreview}
                  onFocus={(event) =>
                    showPathPreview(resolveAbsolutePath(workspacePath, path), event.currentTarget)
                  }
                  onBlur={hidePathPreview}
                  onSelect={() => doCopyAbsolutePath(path)}
                >
                  Copy Absolute Path
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => doReveal(path)}>Reveal in Finder</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => refreshDir(path)}>Refresh</ContextMenuItem>
                <ContextMenuItem onSelect={handleCollapseAll}>Collapse All Folders</ContextMenuItem>
              </>;
            })()}
            {contextTarget.type === "multi" && (() => {
              const { items } = contextTarget;
              const itemLabel = items.length === 1 ? "Item" : "Items";
              return <>
                <ContextMenuLabel>{`Selected ${itemLabel} (${items.length})`}</ContextMenuLabel>
                <ContextMenuItem
                  disabled={!canAddClaudeContext}
                  onSelect={() => {
                    void addClaudeContextEntries(items);
                  }}
                >
                  {`Add ${items.length} ${itemLabel} to Claude Code Context`}
                </ContextMenuItem>
              </>;
            })()}
            {contextTarget.type === "blank" && <>
              <ContextMenuLabel>Empty Area</ContextMenuLabel>
              <ContextMenuItem onSelect={() => startCreate("file", contextTarget.parentDir)}>New File</ContextMenuItem>
              <ContextMenuItem onSelect={() => startCreate("dir",  contextTarget.parentDir)}>New Folder</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={handleRefresh}>Refresh</ContextMenuItem>
              <ContextMenuItem onSelect={handleCollapseAll}>Collapse All Folders</ContextMenuItem>
            </>}
          </ContextMenuContent>
        </ContextMenu>

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
                : `${dragState.dragIds.length} items`}
            </div>
          </div>
        )}

        {pathPreview && typeof document !== "undefined"
          ? createPortal(
              <div
                className="file-tree-path-preview"
                style={{
                  left: pathPreview.x,
                  top: pathPreview.y,
                }}
              >
                {pathPreview.text}
              </div>,
              document.body
            )
          : null}

      </div>
    </FileTreeContext.Provider>
  );
}
