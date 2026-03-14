/**
 * 自定义拖拽系统 - 基于 Pointer Events
 *
 * 由于 react-arborist 内部使用的 react-dnd + HTML5Backend
 * 在 Tauri/WKWebView 中无法正常工作，
 * 我们实现一个基于 pointer events 的拖拽系统来替代。
 */

import { useCallback, useEffect,
 useRef,
 useState
} from "react";
import type { FileNode } from "./fileTreeTypes";

// ─── Types ───────────────────────────────────────────────────────────────

export type DragState = {
  dragIds: string[];
  startY: number;
  currentY: number;
  dropTargetId: string | null;  // 目标文件夹 ID
  dropIndex: number | null;     // 在目标中的插入位置
  dragPreviewY: number;         // 拖拽预览的 Y 坐标
};

type DropTarget = {
  id: string | null;
  index: number | null;
  isFolder: boolean;
};

// ─── Hook: useFileTreeDnd ─────────────────────────────────────────────────

interface FileTreeDndOptions {
  onMove: (args: {
    dragIds: string[];
    parentId: string | null;
    index: number;
  }) => void | Promise<void>;
  getVisibleNodeIds: () => string[];
  getNodeElement: (id: string) => HTMLElement | null;
  getNodeData: (id: string) => FileNode | null;
  rowHeight: number;
}

export function useFileTreeDnd({
  onMove,
  getVisibleNodeIds,
  getNodeElement,
  getNodeData,
  rowHeight,
}: FileTreeDndOptions) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragIdsRef = useRef<Set<string>>(new Set());

  // 开始拖拽
  const startDrag = useCallback(
    (dragIds: string[], clientY: number) => {
      dragIdsRef.current = new Set(dragIds);
      setDragState({
        dragIds,
        startY: clientY,
        currentY: clientY,
        dropTargetId: null,
        dropIndex: null,
        dragPreviewY: clientY,
      });
    },
    []
  );

  // 更新拖拽位置
  const updateDrag = useCallback(
    (clientY: number) => {
      if (!dragState) return;

      // 计算放置目标
      const visibleIds = getVisibleNodeIds();
      const dropTarget = computeDropTarget(
        clientY,
        visibleIds,
        getNodeElement,
        getNodeData,
        rowHeight
      );

      setDragState((prev) =>
        prev
          ? {
              ...prev,
              currentY: clientY,
              dragPreviewY: clientY,
              dropTargetId: dropTarget.id,
              dropIndex: dropTarget.index,
            }
          : null
      );
    },
    [dragState, getVisibleNodeIds, getNodeElement, getNodeData, rowHeight]
  );

  // 结束拖拽
  const endDrag = useCallback(async () => {
    if (!dragState) return;

    const { dragIds, dropTargetId, dropIndex } = dragState;

    // 执行移动操作
    if (dropTargetId !== undefined && dropIndex !== undefined) {
      try {
        await onMove({
          dragIds,
          parentId: dropTargetId,
          index: dropIndex ?? 0,
        });
      } catch (err) {
        console.error("Failed to move files:", err);
      }
    }

    setDragState(null);
    dragIdsRef.current.clear();
  }, [dragState, onMove]);

  // 取消拖拽
  const cancelDrag = useCallback(() => {
    setDragState(null);
    dragIdsRef.current.clear();
  }, []);

  // 全局 pointer move/up 监听
  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (e: PointerEvent) => {
      updateDrag(e.clientY);
    };

    const handlePointerUp = () => {
      endDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelDrag();
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dragState, updateDrag, endDrag, cancelDrag]);

  return {
    dragState,
    startDrag,
    cancelDrag,
    isDragging: (id: string) => dragState?.dragIds.includes(id) ?? false,
    getDropTarget: () =>
      dragState
        ? { id: dragState.dropTargetId, index: dragState.dropIndex }
        : null,
  };
}

// ─── Helper: 计算放置目标 ─────────────────────────────────────────

function computeDropTarget(
  clientY: number,
  visibleIds: string[],
  getNodeElement: (id: string) => HTMLElement | null,
  getNodeData: (id: string) => FileNode | null,
  rowHeight: number
): DropTarget {
  // 遍历可见节点，找到鼠标位置对应的行
  for (let i = 0; i < visibleIds.length; i++) {
    const id = visibleIds[i];
    const el = getNodeElement(id);
    if (!el) continue;

    const rect = el.getBoundingClientRect();
    const rowTop = rect.top;
    const rowBottom = rect.bottom;
    const rowMiddle = rowTop + rowHeight / 2;

    // 判断鼠标在行的哪个位置
    if (clientY < rowTop) continue;
    if (clientY > rowBottom) continue;

    const nodeData = getNodeData(id);
    if (!nodeData) continue;

    // 在行的上半部分 → 作为兄弟节点插入在该节点之前
    // 在行的下半部分 → 如果是文件夹，插入到文件夹内；否则作为兄弟节点插入在该节点之后
    const inUpperHalf = clientY < rowMiddle;

    if (inUpperHalf) {
      // 插入到该节点之前（作为兄弟）
      return { id: getParentId(id), index: i, isFolder: false };
    } else {
      // 下半部分
      if (nodeData.isDir) {
        // 插入到文件夹内（作为第一个子节点）
        return { id, index: 0, isFolder: true };
      } else {
        // 插入到该节点之后（作为兄弟）
        return { id: getParentId(id), index: i + 1, isFolder: false };
      }
    }
  }

  // 鼠标在所有节点下方 → 揾取到最后一个节点的父节点
  if (visibleIds.length > 0) {
    const lastId = visibleIds[visibleIds.length - 1];
    return { id: getParentId(lastId), index: visibleIds.length, isFolder: false };
  }

  return { id: null, index: 0, isFolder: false };
}

function getParentId(nodeId: string): string {
  const lastSlash = nodeId.lastIndexOf("/");
  return lastSlash > 0 ? nodeId.substring(0, lastSlash) : "";
}
