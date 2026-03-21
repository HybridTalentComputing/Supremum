/**
 * 主布局：左侧 Terminal，右侧 EditorPanel；使用可拖拽分割条
 */
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TerminalComponent } from "./Terminal";
import { EditorPanel } from "./EditorPanel";
import { useWorkspace } from "./WorkspaceContext";
import { CodeEditor } from "./CodeEditor";
import { AGENT_PRESETS, type AgentPreset, type AgentPresetId } from "./agentPresets";
import { useFileIconUrl } from "./fileIcons";
import { invokeReadFile } from "./fileTreeOps";
import { gitCheckoutBranch, gitCreateBranch, gitListBranches } from "./gitApi";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { Fragment, type MouseEvent, type PointerEvent, type ReactNode, type WheelEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Circle,
  Columns2,
  Eye,
  GitBranch,
  GitCompareArrows,
  FileText,
  FileCode2,
  FoldVertical,
  FolderOpen,
  FolderClosed,
  List,
  PanelLeft,
  Plus,
  Sparkles,
  SquareTerminal,
  X,
} from "lucide-react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { useGitChanges } from "./useGitChanges";
import type { GitBranchList, GitChangedFile, GitDiffCategory } from "./gitTypes";
import { DiffEditor, type DiffEditorChrome } from "./DiffEditor";
import { AllDiffsView } from "./AllDiffsView";
import { getDiffFileName, getDiffSideLabels, getDiffTabLabel } from "./diffPresentation";
import {
  getPreviewKind,
  isPreviewablePath,
  shouldReadFileContentForOpen,
  supportsCodeViewForPath,
  type PreviewKind,
} from "./filePreview";

type FileEditorTab = {
  id: string;
  path: string;
  content: string;
  savedContent: string;
};

type DiffFileTab = {
  id: string;
  kind: "file";
  file: GitChangedFile;
  category: GitDiffCategory;
};

type DiffAllTab = {
  id: string;
  kind: "all";
};

type DiffTab = DiffFileTab | DiffAllTab;

type TerminalTab = {
  id: string;
  kind: "agent" | "native";
  title: string;
  defaultTitle: string;
  cwd?: string;
  presetId?: AgentPresetId;
  startupCommands?: string[];
};

type BranchCreateMode = "none" | "current" | "from";

type WorkspaceTabGroup = {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
};

type EditorSelectionContext = {
  text: string;
  fromLine: number;
  toLine: number;
};

function getTabName(path: string) {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function getFileTabId(path: string) {
  return `file:${path}`;
}

function getDiffTabId(path: string) {
  return `diff:${path}`;
}

function getAllDiffTabId() {
  return "diff:all";
}

function getTabDir(path: string) {
  const parts = path.split("/");
  return parts.slice(0, -1);
}

function getEditorSelectionContextKey(groupId: string | null, tabId: string) {
  return `${groupId ?? "single"}::${tabId}`;
}

function buildClaudeContextMention(path: string) {
  return `@${path}`;
}

function buildClaudeContextMentions(
  entries: Array<{ path: string; kind: "file" | "folder" }>
) {
  const uniquePaths = new Set<string>();
  const mentions: string[] = [];

  for (const entry of entries) {
    if (!entry.path || uniquePaths.has(entry.path)) continue;
    uniquePaths.add(entry.path);
    mentions.push(buildClaudeContextMention(entry.path));
  }

  return mentions.join(" ");
}

function buildClaudeSelectionPrompt(path: string, selection: EditorSelectionContext) {
  const rangeLabel =
    selection.fromLine === selection.toLine
      ? `${selection.fromLine}`
      : `${selection.fromLine}-${selection.toLine}`;

  return `Selection from ${buildClaudeContextMention(path)} (lines ${rangeLabel}):\n\`\`\`\n${selection.text}\n\`\`\`\n`;
}

function formatWorkspacePath(path: string | null) {
  if (!path) return "";
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function createWorkspaceTabGroup(id: string): WorkspaceTabGroup {
  return {
    id,
    tabIds: [],
    activeTabId: null,
  };
}

function findWorkspaceGroupByTabId(groups: WorkspaceTabGroup[], tabId: string) {
  return groups.find((group) => group.tabIds.includes(tabId)) ?? null;
}

function setWorkspaceGroupActiveTab(
  groups: WorkspaceTabGroup[],
  groupId: string,
  tabId: string | null
) {
  return groups.map((group) => {
    if (group.id !== groupId) return group;
    if (tabId !== null && !group.tabIds.includes(tabId)) return group;
    return group.activeTabId === tabId ? group : { ...group, activeTabId: tabId };
  });
}

function appendTabToWorkspaceGroup(
  groups: WorkspaceTabGroup[],
  targetGroupId: string | null,
  tabId: string,
  fallbackGroup: WorkspaceTabGroup
) {
  let foundTargetGroup = false;

  const nextGroups = groups.map((group) => {
    if (group.id !== targetGroupId) return group;
    foundTargetGroup = true;
    if (group.tabIds.includes(tabId)) {
      return group.activeTabId === tabId ? group : { ...group, activeTabId: tabId };
    }
    return {
      ...group,
      tabIds: [...group.tabIds, tabId],
      activeTabId: tabId,
    };
  });

  if (foundTargetGroup) {
    return {
      nextGroups,
      effectiveGroupId: targetGroupId,
    };
  }

  return {
    nextGroups: [
      ...nextGroups,
      {
        ...fallbackGroup,
        tabIds: [tabId],
        activeTabId: tabId,
      },
    ],
    effectiveGroupId: fallbackGroup.id,
  };
}

function removeTabFromWorkspaceGroups(groups: WorkspaceTabGroup[], tabId: string) {
  return groups.map((group) => {
    if (!group.tabIds.includes(tabId)) return group;

    const nextTabIds = group.tabIds.filter((groupTabId) => groupTabId !== tabId);
    const nextActiveTabId =
      group.activeTabId === tabId ? nextTabIds[nextTabIds.length - 1] ?? null : group.activeTabId;

    return {
      ...group,
      tabIds: nextTabIds,
      activeTabId: nextActiveTabId,
    };
  });
}

function insertWorkspaceGroupAfter(
  groups: WorkspaceTabGroup[],
  sourceGroupId: string,
  nextGroup: WorkspaceTabGroup
) {
  const sourceGroupIndex = groups.findIndex((group) => group.id === sourceGroupId);
  if (sourceGroupIndex === -1) {
    return [...groups, nextGroup];
  }

  const nextGroups = [...groups];
  nextGroups.splice(sourceGroupIndex + 1, 0, nextGroup);
  return nextGroups;
}

function closeWorkspaceTabGroup(groups: WorkspaceTabGroup[], groupId: string) {
  if (groups.length <= 1) {
    return {
      nextGroups: groups,
      nextActiveGroupId: groups[0]?.id ?? null,
    };
  }

  const groupIndex = groups.findIndex((group) => group.id === groupId);
  if (groupIndex === -1) {
    return {
      nextGroups: groups,
      nextActiveGroupId: groups[0]?.id ?? null,
    };
  }

  const targetGroupIndex = groupIndex > 0 ? groupIndex - 1 : 1;
  const closingGroup = groups[groupIndex];
  const nextGroups = groups
    .filter((group) => group.id !== groupId)
    .map((group, index) => {
      if (index !== targetGroupIndex - (groupIndex > 0 ? 0 : 1)) return group;

      const mergedTabIds = [...group.tabIds, ...closingGroup.tabIds];
      const nextActiveTabId =
        group.activeTabId ?? closingGroup.activeTabId ?? mergedTabIds[0] ?? null;

      return {
        ...group,
        tabIds: mergedTabIds,
        activeTabId: nextActiveTabId,
      };
    });

  const nextActiveGroupId = nextGroups[targetGroupIndex - (groupIndex > 0 ? 0 : 1)]?.id ?? nextGroups[0]?.id ?? null;

  return {
    nextGroups,
    nextActiveGroupId,
  };
}

function reorderTabIds(
  tabIds: string[],
  sourceTabId: string,
  targetTabId: string,
  placement: "before" | "after" = "before"
) {
  if (sourceTabId === targetTabId) {
    return tabIds;
  }

  const sourceIndex = tabIds.indexOf(sourceTabId);
  const targetIndex = tabIds.indexOf(targetTabId);
  if (sourceIndex === -1 || targetIndex === -1) {
    return tabIds;
  }

  const nextTabIds = tabIds.filter((tabId) => tabId !== sourceTabId);
  const nextTargetIndex = nextTabIds.indexOf(targetTabId);
  if (nextTargetIndex === -1) {
    return tabIds;
  }

  const insertIndex = placement === "before" ? nextTargetIndex : nextTargetIndex + 1;
  nextTabIds.splice(insertIndex, 0, sourceTabId);
  return nextTabIds;
}

function reorderItemsById<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
  placement: "before" | "after" = "before"
) {
  const nextIds = reorderTabIds(
    items.map((item) => item.id),
    sourceId,
    targetId,
    placement
  );

  if (nextIds.length !== items.length) {
    return items;
  }

  const itemsById = new Map(items.map((item) => [item.id, item]));
  return nextIds
    .map((id) => itemsById.get(id))
    .filter((item): item is T => Boolean(item));
}

function EditorFileIcon({ path }: { path: string }) {
  const iconUrl = useFileIconUrl(getTabName(path), false, false);

  if (!iconUrl) {
    return <FileText className="editor-tab-icon-svg" />;
  }

  return <img src={iconUrl} alt="" className="editor-tab-icon-img" draggable={false} />;
}

function ActivePathBar({
  path,
  previewKind,
  supportsCodeView,
  mode,
  onModeChange,
}: {
  path: string;
  previewKind?: PreviewKind | null;
  supportsCodeView?: boolean;
  mode?: "code" | "preview";
  onModeChange?: (mode: "code" | "preview") => void;
}) {
  const parts = getTabDir(path);
  const fileName = getTabName(path);

  return (
    <div className="editor-path-bar">
      <div className="editor-path-main">
        {parts.map((part, index) => (
          <div key={`${part}-${index}`} className="editor-path-segment">
            {index > 0 && <ChevronRight className="editor-path-separator" />}
            <span className="editor-path-text">{part}</span>
          </div>
        ))}
        {parts.length > 0 && <ChevronRight className="editor-path-separator" />}
        <div className="editor-path-file">
          <EditorFileIcon path={path} />
          <span className="editor-path-text editor-path-text-active">{fileName}</span>
        </div>
      </div>
      {previewKind ? (
        <div className="editor-view-switch" data-tauri-drag-region="false">
          {previewKind ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="editor-view-switch-button"
              data-active={mode === "preview" ? "true" : undefined}
              onClick={() => onModeChange?.("preview")}
            >
              <Eye className="size-3.5" />
              <span>Preview</span>
            </Button>
          ) : null}
          {previewKind && supportsCodeView ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="editor-view-switch-button"
              data-active={mode === "code" ? "true" : undefined}
              onClick={() => onModeChange?.("code")}
            >
              <FileCode2 className="size-3.5" />
              <span>Code</span>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceEmptyState({
  visual,
  title,
  description,
  meta,
  actions,
}: {
  visual: ReactNode;
  title: string;
  description: string;
  meta?: string;
  actions?: Array<{
    icon: ReactNode;
    label: string;
    hint?: string;
    onClick?: () => void;
    emphasis?: boolean;
  }>;
}) {
  return (
    <div className="workspace-empty-state">
      <div className="workspace-empty-center">
        <div className="workspace-empty-visual" aria-hidden>
          {visual}
        </div>
        <div className="workspace-empty-copy">
          <h2 className="workspace-empty-title">{title}</h2>
          <p className="workspace-empty-description">{description}</p>
          {meta ? <p className="workspace-empty-meta">{meta}</p> : null}
        </div>
        {actions?.length ? (
          <div className="workspace-empty-actions">
            {actions.map((action) => (
              <Button
                key={action.label}
                type="button"
                variant={action.emphasis ? "outline" : "ghost"}
                className={`workspace-empty-action${action.emphasis ? " workspace-empty-action-emphasis" : ""}`}
                onClick={action.onClick}
              >
                <span className="workspace-empty-action-main">
                  {action.icon}
                  <span>{action.label}</span>
                </span>
                {action.hint ? (
                  <span className="workspace-empty-action-hint">{action.hint}</span>
                ) : null}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AgentPresetLauncher({
  onSelectPreset,
}: {
  onSelectPreset: (preset: AgentPreset) => void;
}) {
  const presetRows = AGENT_PRESETS.reduce<AgentPreset[][]>((rows, preset, index) => {
    const rowIndex = Math.floor(index / 2);
    if (!rows[rowIndex]) {
      rows[rowIndex] = [];
    }
    rows[rowIndex].push(preset);
    return rows;
  }, []);

  return (
    <div className="agent-launcher-shell">
      <div className="agent-launcher">
        <div className="agent-launcher-header">
          <h2 className="workspace-empty-title">Choose an AI Coding CLI</h2>
          <p className="workspace-empty-description">
            Pick a preset to launch directly into the corresponding CLI.
          </p>
        </div>
        <div className="agent-launcher-list">
          {presetRows.map((row, rowIndex) => (
            <div key={`row-${rowIndex}`} className="agent-launcher-row">
              {row.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="outline"
                  className="agent-preset-card"
                  onClick={() => onSelectPreset(preset)}
                >
                  <span className="agent-preset-main">
                    <span className="agent-preset-icon-wrap">
                      <img
                        src={preset.iconPath}
                        alt=""
                        className="agent-preset-icon"
                        draggable={false}
                      />
                    </span>
                    <span className="agent-preset-copy">
                      <span className="agent-preset-title">{preset.label}</span>
                      <span className="agent-preset-description">{preset.description}</span>
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MainLayout() {
  const { workspacePath, setWorkspacePath } = useWorkspace();
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const agentPresetMenuRef = useRef<HTMLDivElement | null>(null);
  const agentPresetMenuPopupRef = useRef<HTMLDivElement | null>(null);
  const branchMenuRef = useRef<HTMLDivElement | null>(null);
  const titlebarDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const titlebarDraggingRef = useRef(false);
  const terminalCounterRef = useRef(1);
  const agentWorkspaceGroupCounterRef = useRef(1);
  const nativeTerminalGroupCounterRef = useRef(1);
  const editorWorkspaceGroupCounterRef = useRef(1);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [agentWorkspaceGroups, setAgentWorkspaceGroups] = useState<WorkspaceTabGroup[]>([]);
  const [nativeTerminalGroups, setNativeTerminalGroups] = useState<WorkspaceTabGroup[]>([]);
  const [activeNativeTerminalId, setActiveNativeTerminalId] = useState<string | null>(null);
  const [activeAgentTerminalId, setActiveAgentTerminalId] = useState<string | null>(null);
  const [activeAgentWorkspaceGroupId, setActiveAgentWorkspaceGroupId] = useState<string | null>(null);
  const [activeNativeTerminalGroupId, setActiveNativeTerminalGroupId] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<"agent" | "terminal" | "editor" | "diff">("agent");
  const [openTabs, setOpenTabs] = useState<FileEditorTab[]>([]);
  const [editorLayoutMode, setEditorLayoutMode] = useState<"single" | "split">("single");
  const [editorWorkspaceGroups, setEditorWorkspaceGroups] = useState<WorkspaceTabGroup[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activeEditorWorkspaceGroupId, setActiveEditorWorkspaceGroupId] = useState<string | null>(null);
  const [diffTabs, setDiffTabs] = useState<DiffTab[]>([]);
  const [activeDiffTabId, setActiveDiffTabId] = useState<string | null>(null);
  const [diffDirtyState, setDiffDirtyState] = useState<Record<string, boolean>>({});
  const [diffChromeState, setDiffChromeState] = useState<Record<string, DiffEditorChrome | null>>({});
  const [allDiffsCollapseRequest, setAllDiffsCollapseRequest] = useState(0);
  const [allDiffsExpandRequest, setAllDiffsExpandRequest] = useState(0);
  const [allDiffsAreCollapsed, setAllDiffsAreCollapsed] = useState(true);
  const [editorViewModes, setEditorViewModes] = useState<Record<string, "code" | "preview">>({});
  const [editorSelectionContexts, setEditorSelectionContexts] = useState<
    Record<string, EditorSelectionContext | null>
  >({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"changes" | "files">("files");
  const previousSidebarTabRef = useRef<"changes" | "files">("files");
  const editorTabDragStartRef = useRef<{ groupId: string | null; tabId: string; x: number; y: number } | null>(null);
  const editorTabSuppressClickRef = useRef(false);
  const editorTabDropTargetRef = useRef<{ groupId: string | null; tabId: string; edge: "before" | "after" } | null>(null);
  const [draggedEditorTab, setDraggedEditorTab] = useState<{ groupId: string | null; tabId: string } | null>(null);
  const [editorTabDropTarget, setEditorTabDropTarget] = useState<{
    groupId: string | null;
    tabId: string;
    edge: "before" | "after";
  } | null>(null);
  const [editorTabDragPreviewPosition, setEditorTabDragPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const agentTabDragStartRef = useRef<{ groupId: string; tabId: string; x: number; y: number } | null>(null);
  const agentTabSuppressClickRef = useRef(false);
  const agentTabDropTargetRef = useRef<{ groupId: string; tabId: string; edge: "before" | "after" } | null>(null);
  const [draggedAgentTab, setDraggedAgentTab] = useState<{ groupId: string; tabId: string } | null>(null);
  const [agentTabDropTarget, setAgentTabDropTarget] = useState<{
    groupId: string;
    tabId: string;
    edge: "before" | "after";
  } | null>(null);
  const [agentTabDragPreviewPosition, setAgentTabDragPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const nativeTerminalTabDragStartRef = useRef<{ groupId: string; tabId: string; x: number; y: number } | null>(null);
  const nativeTerminalTabSuppressClickRef = useRef(false);
  const nativeTerminalTabDropTargetRef = useRef<{ groupId: string; tabId: string; edge: "before" | "after" } | null>(null);
  const [draggedNativeTerminalTab, setDraggedNativeTerminalTab] = useState<{ groupId: string; tabId: string } | null>(null);
  const [nativeTerminalTabDropTarget, setNativeTerminalTabDropTarget] = useState<{
    groupId: string;
    tabId: string;
    edge: "before" | "after";
  } | null>(null);
  const [nativeTerminalTabDragPreviewPosition, setNativeTerminalTabDragPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const diffTabDragStartRef = useRef<{ tabId: string; x: number; y: number } | null>(null);
  const diffTabSuppressClickRef = useRef(false);
  const diffTabDropTargetRef = useRef<{ tabId: string; edge: "before" | "after" } | null>(null);
  const [draggedDiffTab, setDraggedDiffTab] = useState<{ tabId: string } | null>(null);
  const [diffTabDropTarget, setDiffTabDropTarget] = useState<{
    tabId: string;
    edge: "before" | "after";
  } | null>(null);
  const [diffTabDragPreviewPosition, setDiffTabDragPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const [agentPresetMenuOpen, setAgentPresetMenuOpen] = useState(false);
  const [agentPresetMenuPosition, setAgentPresetMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchMenuLoading, setBranchMenuLoading] = useState(false);
  const [branchMenuError, setBranchMenuError] = useState<string | null>(null);
  const [branchList, setBranchList] = useState<GitBranchList | null>(null);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchCreateMode, setBranchCreateMode] = useState<BranchCreateMode>("none");
  const [branchCreateName, setBranchCreateName] = useState("");
  const [branchCreateSource, setBranchCreateSource] = useState("");
  const [branchActionPending, setBranchActionPending] = useState<"checkout" | "create" | null>(null);
  const activeDiffTabForPolling = diffTabs.find((tab) => tab.id === activeDiffTabId) ?? null;
  const git = useGitChanges({
    workspacePath,
    active:
      Boolean(workspacePath) &&
      activeSidebarTab === "changes" &&
      !(activeWorkspace === "diff" && activeDiffTabForPolling?.kind === "all"),
  });

  useEffect(() => {
    const previousSidebarTab = previousSidebarTabRef.current;
    previousSidebarTabRef.current = activeSidebarTab;

    if (!workspacePath) return;
    if (activeSidebarTab !== "changes" || previousSidebarTab === "changes") return;

    void git.refresh({ silent: true });
  }, [activeSidebarTab, git.refresh, workspacePath]);

  useEffect(() => {
    setBranchMenuOpen(false);
    setBranchList(null);
    setBranchMenuError(null);
    setBranchMenuLoading(false);
    setBranchQuery("");
    setBranchCreateMode("none");
    setBranchCreateName("");
    setBranchCreateSource("");
    setBranchActionPending(null);
  }, [workspacePath]);

  const loadBranchList = useCallback(async () => {
    if (!workspacePath || git.capability?.status !== "available") return;
    setBranchMenuLoading(true);
    setBranchMenuError(null);
    try {
      const nextBranches = await gitListBranches(workspacePath);
      setBranchList(nextBranches);
      if (!branchCreateSource) {
        setBranchCreateSource(nextBranches.current);
      }
    } catch (error) {
      setBranchMenuError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchMenuLoading(false);
    }
  }, [branchCreateSource, git.capability?.status, workspacePath]);

  const createAgentWorkspaceGroup = useCallback(() => {
    const nextIndex = agentWorkspaceGroupCounterRef.current;
    agentWorkspaceGroupCounterRef.current += 1;
    return createWorkspaceTabGroup(`agent-group-${nextIndex}`);
  }, []);

  const createNativeTerminalGroup = useCallback(() => {
    const nextIndex = nativeTerminalGroupCounterRef.current;
    nativeTerminalGroupCounterRef.current += 1;
    return createWorkspaceTabGroup(`native-terminal-group-${nextIndex}`);
  }, []);

  const createEditorWorkspaceGroup = useCallback(() => {
    const nextIndex = editorWorkspaceGroupCounterRef.current;
    editorWorkspaceGroupCounterRef.current += 1;
    return createWorkspaceTabGroup(`editor-group-${nextIndex}`);
  }, []);

  const handleTabsWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

    const viewport = event.currentTarget.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    );

    if (!viewport || viewport.scrollWidth <= viewport.clientWidth) return;

    viewport.scrollLeft += event.deltaY;
    event.preventDefault();
  }, []);

  const handleTitlebarMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('[data-tauri-drag-region="false"]')) return;
    if (event.detail === 2) {
      titlebarDragStartRef.current = null;
      titlebarDraggingRef.current = false;
      void invoke("toggle_window_zoom").catch((error) => {
        console.error("Failed to toggle window zoom:", error);
      });
      return;
    }
    titlebarDragStartRef.current = { x: event.clientX, y: event.clientY };
    titlebarDraggingRef.current = false;
  }, []);

  const handleTitlebarMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if ((event.buttons & 1) !== 1) return;
    if (!titlebarDragStartRef.current || titlebarDraggingRef.current) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-tauri-drag-region="false"]')) {
      titlebarDragStartRef.current = null;
      return;
    }

    const deltaX = Math.abs(event.clientX - titlebarDragStartRef.current.x);
    const deltaY = Math.abs(event.clientY - titlebarDragStartRef.current.y);
    if (deltaX < 4 && deltaY < 4) return;

    titlebarDraggingRef.current = true;
    titlebarDragStartRef.current = null;
    void getCurrentWindow().startDragging().catch((error) => {
      console.error("Failed to start window dragging:", error);
    });
  }, []);

  const handleTitlebarMouseUp = useCallback(() => {
    titlebarDragStartRef.current = null;
    titlebarDraggingRef.current = false;
  }, []);

  useEffect(() => {
    if (!agentPresetMenuOpen) return;

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (agentPresetMenuRef.current?.contains(target) ||
          agentPresetMenuPopupRef.current?.contains(target))
      ) {
        return;
      }
      setAgentPresetMenuOpen(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setAgentPresetMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [agentPresetMenuOpen]);

  useLayoutEffect(() => {
    if (!agentPresetMenuOpen) {
      setAgentPresetMenuPosition(null);
      return;
    }

    const syncPosition = () => {
      const anchor = agentPresetMenuRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      setAgentPresetMenuPosition({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };

    syncPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);

    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [agentPresetMenuOpen, activeAgentWorkspaceGroupId]);

  useEffect(() => {
    if (!branchMenuOpen) return;

    void loadBranchList();

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null;
      if (target && branchMenuRef.current?.contains(target)) return;
      setBranchMenuOpen(false);
      setBranchCreateMode("none");
      setBranchCreateName("");
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (branchCreateMode !== "none") {
        setBranchCreateMode("none");
        setBranchCreateName("");
        return;
      }
      setBranchMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [branchCreateMode, branchMenuOpen, loadBranchList]);

  const handleOpenFile = useCallback((path: string, content: string) => {
    const tabId = getFileTabId(path);
    setOpenTabs((currentTabs) => {
      const existingTab = currentTabs.find((tab) => tab.id === tabId);
      if (existingTab) return currentTabs;
      return [...currentTabs, { id: tabId, path, content, savedContent: content }];
    });
    setEditorViewModes((currentModes) =>
      currentModes[tabId]
        ? currentModes
        : {
            ...currentModes,
            [tabId]: isPreviewablePath(path) ? "preview" : "code",
          }
    );
    if (editorLayoutMode === "split" && editorWorkspaceGroups.length > 0) {
      const existingGroup = findWorkspaceGroupByTabId(editorWorkspaceGroups, tabId);
      const targetGroup =
        existingGroup ??
        editorWorkspaceGroups.find((group) => group.id === activeEditorWorkspaceGroupId) ??
        editorWorkspaceGroups[0] ??
        null;

      if (targetGroup) {
        setEditorWorkspaceGroups((currentGroups) => {
          if (targetGroup.tabIds.includes(tabId)) {
            return setWorkspaceGroupActiveTab(currentGroups, targetGroup.id, tabId);
          }

          const fallbackGroup = createEditorWorkspaceGroup();
          return appendTabToWorkspaceGroup(currentGroups, targetGroup.id, tabId, fallbackGroup).nextGroups;
        });
        setActiveEditorWorkspaceGroupId(targetGroup.id);
      }
    }
    setActiveTabId(tabId);
    setActiveWorkspace("editor");
  }, [
    activeEditorWorkspaceGroupId,
    createEditorWorkspaceGroup,
    editorLayoutMode,
    editorWorkspaceGroups,
  ]);

  const handleOpenDiff = useCallback((file: GitChangedFile, category: GitDiffCategory) => {
    const tabId = getDiffTabId(file.path);
    setDiffTabs((currentTabs) => {
      const existingTab = currentTabs.find((tab) => tab.id === tabId);
      if (existingTab?.kind === "file") {
        return currentTabs.map((tab) =>
          tab.id === tabId && tab.kind === "file"
            ? { ...tab, file, category }
            : tab
        );
      }
      return [...currentTabs, { id: tabId, kind: "file", file, category }];
    });
    setActiveDiffTabId(tabId);
    setActiveWorkspace("diff");
  }, []);

  const handleOpenAllDiffs = useCallback(() => {
    const allDiffTabId = getAllDiffTabId();
    setDiffTabs((currentTabs) =>
      currentTabs.some((tab) => tab.id === allDiffTabId)
        ? currentTabs
        : [{ id: allDiffTabId, kind: "all" }, ...currentTabs]
    );
    setAllDiffsCollapseRequest((current) => current + 1);
    setActiveDiffTabId(allDiffTabId);
    setActiveWorkspace("diff");
  }, []);

  const handleOpenDiffFile = useCallback(async (path: string) => {
    if (!workspacePath) return;

    try {
      if (!shouldReadFileContentForOpen(path)) {
        handleOpenFile(path, "");
        return;
      }

      const content = await invokeReadFile(workspacePath, path);
      handleOpenFile(path, content);
    } catch (error) {
      console.error(`Failed to open file ${path}:`, error);
    }
  }, [handleOpenFile, workspacePath]);

  const handleAddClaudeContextBatch = useCallback(async (
    entries: Array<{ path: string; kind: "file" | "folder" }>
  ) => {
    if (entries.length === 0) return;

    const activeAgentTab =
      terminalTabs.find((tab) => tab.id === activeAgentTerminalId && tab.kind === "agent") ?? null;
    if (!activeAgentTab || activeAgentTab.presetId !== "claude") {
      return;
    }

    const targetGroup = findWorkspaceGroupByTabId(agentWorkspaceGroups, activeAgentTab.id);
    if (targetGroup) {
      setAgentWorkspaceGroups((currentGroups) =>
        setWorkspaceGroupActiveTab(currentGroups, targetGroup.id, activeAgentTab.id)
      );
      setActiveAgentWorkspaceGroupId(targetGroup.id);
    }

    setActiveAgentTerminalId(activeAgentTab.id);
    setActiveWorkspace("agent");

    try {
      const mentions = buildClaudeContextMentions(entries);
      if (!mentions) return;
      await invoke("write_terminal", {
        terminalId: activeAgentTab.id,
        data: `${mentions} `,
      });
    } catch (error) {
      console.error("Failed to add Claude context:", error);
    }
  }, [activeAgentTerminalId, agentWorkspaceGroups, terminalTabs]);

  const handleAddClaudeContext = useCallback(async (path: string, kind: "file" | "folder") => {
    await handleAddClaudeContextBatch([{ path, kind }]);
  }, [handleAddClaudeContextBatch]);

  const handleAddClaudeSelection = useCallback(async (
    path: string,
    selection: EditorSelectionContext
  ) => {
    const activeAgentTab =
      terminalTabs.find((tab) => tab.id === activeAgentTerminalId && tab.kind === "agent") ?? null;
    if (!activeAgentTab || activeAgentTab.presetId !== "claude") {
      return;
    }

    const targetGroup = findWorkspaceGroupByTabId(agentWorkspaceGroups, activeAgentTab.id);
    if (targetGroup) {
      setAgentWorkspaceGroups((currentGroups) =>
        setWorkspaceGroupActiveTab(currentGroups, targetGroup.id, activeAgentTab.id)
      );
      setActiveAgentWorkspaceGroupId(targetGroup.id);
    }

    setActiveAgentTerminalId(activeAgentTab.id);
    setActiveWorkspace("agent");

    try {
      await invoke("write_terminal", {
        terminalId: activeAgentTab.id,
        data: buildClaudeSelectionPrompt(path, selection),
      });
    } catch (error) {
      console.error("Failed to add Claude selection context:", error);
    }
  }, [activeAgentTerminalId, agentWorkspaceGroups, terminalTabs]);

  const handleSendTerminalSelectionToClaude = useCallback(async (
    selection: string,
    sourceTerminalId: string,
  ) => {
    const normalizedSelection = selection.trim();
    if (!normalizedSelection) return;

    const targetClaudeTab =
      terminalTabs.find((tab) => tab.id === activeAgentTerminalId && tab.kind === "agent" && tab.presetId === "claude") ??
      terminalTabs.find((tab) => tab.kind === "agent" && tab.presetId === "claude") ??
      null;
    if (!targetClaudeTab) return;

    const sourceTab = terminalTabs.find((tab) => tab.id === sourceTerminalId) ?? null;
    const sourceLabel = sourceTab?.title?.trim() || sourceTab?.defaultTitle?.trim() || "Terminal";

    const targetGroup = findWorkspaceGroupByTabId(agentWorkspaceGroups, targetClaudeTab.id);
    if (targetGroup) {
      setAgentWorkspaceGroups((currentGroups) =>
        setWorkspaceGroupActiveTab(currentGroups, targetGroup.id, targetClaudeTab.id)
      );
      setActiveAgentWorkspaceGroupId(targetGroup.id);
    }

    setActiveAgentTerminalId(targetClaudeTab.id);
    setActiveWorkspace("agent");

    try {
      await invoke("write_terminal", {
        terminalId: targetClaudeTab.id,
        data: `Terminal output from ${sourceLabel}:\n\`\`\`\n${normalizedSelection}\n\`\`\`\n`,
      });
    } catch (error) {
      console.error("Failed to send terminal selection to Claude:", error);
    }
  }, [activeAgentTerminalId, agentWorkspaceGroups, terminalTabs]);

  const setDiffTabDirty = useCallback((tabId: string, dirty: boolean) => {
    setDiffDirtyState((currentState) => {
      if (dirty) {
        if (currentState[tabId]) return currentState;
        return { ...currentState, [tabId]: true };
      }

      if (!(tabId in currentState)) return currentState;
      const nextState = { ...currentState };
      delete nextState[tabId];
      return nextState;
    });
  }, []);

  const handleSave = async (path: string, content: string) => {
    await invoke("write_file", {
      payload: { workspacePath, path, content },
    });
    setOpenTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.path === path ? { ...tab, content, savedContent: content } : tab
      )
    );
  };

  const handleChange = (path: string, content: string) => {
    setOpenTabs((currentTabs) =>
      currentTabs.map((tab) => (tab.path === path ? { ...tab, content } : tab))
    );
  };

  const handleEditorSelectionChange = useCallback((
    groupId: string | null,
    tabId: string,
    selection: EditorSelectionContext | null
  ) => {
    const key = getEditorSelectionContextKey(groupId, tabId);
    setEditorSelectionContexts((currentSelections) => {
      const currentSelection = currentSelections[key] ?? null;
      const isSameSelection =
        currentSelection?.text === selection?.text &&
        currentSelection?.fromLine === selection?.fromLine &&
        currentSelection?.toLine === selection?.toLine;

      if (isSameSelection) {
        return currentSelections;
      }

      if (!selection) {
        if (!(key in currentSelections)) return currentSelections;
        const nextSelections = { ...currentSelections };
        delete nextSelections[key];
        return nextSelections;
      }

      return {
        ...currentSelections,
        [key]: selection,
      };
    });
  }, []);

  const handleCloseTab = useCallback((tabId: string, groupId?: string) => {
    void (async () => {
      const targetTab = openTabs.find((tab) => tab.id === tabId);
      if (!targetTab) return;

      const isDirty = targetTab.content !== targetTab.savedContent;
      if (isDirty) {
        const confirmed = await confirm(`"${getTabName(targetTab.path)}" has unsaved changes. Close it anyway?`, {
          title: "Subset",
          kind: "warning",
          okLabel: "OK",
          cancelLabel: "Cancel",
        });
        if (!confirmed) return;
      }

      if (editorLayoutMode === "split" && groupId) {
        setEditorWorkspaceGroups((currentGroups) => {
          const targetGroup = currentGroups.find((group) => group.id === groupId);
          if (!targetGroup) return currentGroups;

          const nextGroups = currentGroups.map((group) => {
            if (group.id !== groupId) return group;

            const nextTabIds = group.tabIds.filter((groupTabId) => groupTabId !== tabId);
            const nextActiveTabId =
              group.activeTabId === tabId ? nextTabIds[nextTabIds.length - 1] ?? null : group.activeTabId;

            return {
              ...group,
              tabIds: nextTabIds,
              activeTabId: nextActiveTabId,
            };
          });

          const remainingReferences = nextGroups.some((group) => group.tabIds.includes(tabId));
          if (!remainingReferences) {
            setOpenTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== tabId));
            setEditorViewModes((currentModes) => {
              if (!(tabId in currentModes)) return currentModes;
              const nextModes = { ...currentModes };
              delete nextModes[tabId];
              return nextModes;
            });
          }
          setEditorSelectionContexts((currentSelections) => {
            const selectionKey = getEditorSelectionContextKey(groupId, tabId);
            if (!(selectionKey in currentSelections)) return currentSelections;
            const nextSelections = { ...currentSelections };
            delete nextSelections[selectionKey];
            return nextSelections;
          });

          const resolvedActiveGroup =
            nextGroups.find((group) => group.id === activeEditorWorkspaceGroupId) ??
            nextGroups.find((group) => group.id === groupId) ??
            nextGroups[0] ??
            null;

          setActiveEditorWorkspaceGroupId(resolvedActiveGroup?.id ?? null);
          setActiveTabId(resolvedActiveGroup?.activeTabId ?? null);

          return nextGroups;
        });
        return;
      }

      setOpenTabs((currentTabs) => {
        const tabIndex = currentTabs.findIndex((tab) => tab.id === tabId);
        if (tabIndex === -1) return currentTabs;

        const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);
        setActiveTabId((currentActiveId) => {
          if (currentActiveId !== tabId) return currentActiveId;
          if (nextTabs.length === 0) return null;
          return nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0].id;
        });
        setEditorViewModes((currentModes) => {
          if (!(tabId in currentModes)) return currentModes;
          const nextModes = { ...currentModes };
          delete nextModes[tabId];
          return nextModes;
        });
        setEditorSelectionContexts((currentSelections) => {
          const selectionKey = getEditorSelectionContextKey(null, tabId);
          if (!(selectionKey in currentSelections)) return currentSelections;
          const nextSelections = { ...currentSelections };
          delete nextSelections[selectionKey];
          return nextSelections;
        });
        if (nextTabs.length === 0) {
          setActiveWorkspace(diffTabs.length > 0 ? "diff" : "agent");
        }
        return nextTabs;
      });
    })();
  }, [activeEditorWorkspaceGroupId, diffTabs.length, editorLayoutMode, openTabs]);

  const handleCloseDiffTab = useCallback((tabId: string) => {
    void (async () => {
      const targetTab = diffTabs.find((tab) => tab.id === tabId);
      if (!targetTab) return;

      if (diffDirtyState[tabId]) {
        const label = targetTab.kind === "all" ? "All Changes" : getDiffFileName(targetTab.file.path);
        const confirmed = await confirm(`"${label}" has unsaved changes. Close it anyway?`, {
          title: "Subset",
          kind: "warning",
          okLabel: "OK",
          cancelLabel: "Cancel",
        });
        if (!confirmed) return;
      }

      setDiffTabs((currentTabs) => {
        const tabIndex = currentTabs.findIndex((tab) => tab.id === tabId);
        if (tabIndex === -1) return currentTabs;

        const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);
        setActiveDiffTabId((currentActiveId) => {
          if (currentActiveId !== tabId) return currentActiveId;
          if (nextTabs.length === 0) return null;
          return nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0].id;
        });

        if (nextTabs.length === 0) {
          setActiveWorkspace(openTabs.length > 0 ? "editor" : "agent");
        }

        return nextTabs;
      });
      setDiffTabDirty(tabId, false);
    })();
  }, [diffDirtyState, diffTabs, openTabs.length, setDiffTabDirty]);

  const handleCloseAllDiffTabs = useCallback(() => {
    void (async () => {
      const dirtyDiffTabs = diffTabs.filter((tab) => diffDirtyState[tab.id]);
      if (dirtyDiffTabs.length > 0) {
        const confirmed = await confirm(
          dirtyDiffTabs.length === 1
            ? `"${dirtyDiffTabs[0]?.kind === "all" ? "All Changes" : getDiffFileName(dirtyDiffTabs[0].file.path)}" has unsaved changes. Close all diff tabs anyway?`
            : `${dirtyDiffTabs.length} diff tabs have unsaved changes. Close all diff tabs anyway?`,
          {
            title: "Subset",
            kind: "warning",
            okLabel: "Close All",
            cancelLabel: "Cancel",
          }
        );
        if (!confirmed) return;
      }

      setDiffTabs([]);
      setActiveDiffTabId(null);
      setDiffDirtyState({});
      setDiffChromeState({});
    })();
  }, [diffDirtyState, diffTabs]);

  const handleCreateTerminal = useCallback((targetGroupId?: string) => {
    const nextIndex = terminalCounterRef.current;
    terminalCounterRef.current += 1;
    const id = `term-${nextIndex}`;
    const defaultTitle = `Terminal ${nextIndex}`;
    const nextTab: TerminalTab = {
      id,
      kind: "native",
      title: defaultTitle,
      defaultTitle,
      cwd: workspacePath ?? undefined,
    };

    setTerminalTabs((currentTabs) => [...currentTabs, nextTab]);
    setNativeTerminalGroups((currentGroups) => {
      const resolvedTargetGroupId =
        targetGroupId ??
        activeNativeTerminalGroupId ??
        currentGroups.find((group) => group.tabIds.length === 0)?.id ??
        null;
      const fallbackGroup = createNativeTerminalGroup();
      const { nextGroups, effectiveGroupId } = appendTabToWorkspaceGroup(
        currentGroups,
        resolvedTargetGroupId,
        id,
        fallbackGroup
      );
      setActiveNativeTerminalGroupId(effectiveGroupId);
      return nextGroups;
    });
    setActiveNativeTerminalId(id);
    setActiveWorkspace("terminal");
  }, [activeNativeTerminalGroupId, createNativeTerminalGroup, workspacePath]);

  const handleCreateAgentTerminal = useCallback(
    (preset: AgentPreset) => {
      const nextIndex = terminalCounterRef.current;
      terminalCounterRef.current += 1;
      const id = `term-${nextIndex}`;
      const nextTab: TerminalTab = {
        id,
        kind: "agent",
        title: preset.label,
        defaultTitle: preset.label,
        cwd: workspacePath ?? undefined,
        presetId: preset.id,
        startupCommands: [preset.command],
      };

      setTerminalTabs((currentTabs) => [...currentTabs, nextTab]);
      setAgentWorkspaceGroups((currentGroups) => {
        const fallbackGroup = createAgentWorkspaceGroup();
        const { nextGroups, effectiveGroupId } = appendTabToWorkspaceGroup(
          currentGroups,
          activeAgentWorkspaceGroupId,
          id,
          fallbackGroup
        );
        setActiveAgentWorkspaceGroupId(effectiveGroupId);
        return nextGroups;
      });
      setActiveAgentTerminalId(id);
      setActiveWorkspace("agent");
      setAgentPresetMenuOpen(false);
    },
    [activeAgentWorkspaceGroupId, createAgentWorkspaceGroup, workspacePath]
  );

  const handleCloseTerminal = useCallback((terminalId: string) => {
    const targetTab = terminalTabs.find((tab) => tab.id === terminalId);
    if (!targetTab) return;

    setTerminalTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== terminalId));

    if (targetTab.kind === "native") {
      setNativeTerminalGroups((currentGroups) => {
        const nextGroups = removeTabFromWorkspaceGroups(currentGroups, terminalId);
        const nextActiveGroup =
          nextGroups.find((group) => group.id === activeNativeTerminalGroupId) ??
          nextGroups[0] ??
          null;

        setActiveNativeTerminalGroupId(nextActiveGroup?.id ?? null);
        setActiveNativeTerminalId((currentActiveId) =>
          currentActiveId === terminalId ? nextActiveGroup?.activeTabId ?? null : currentActiveId
        );

        return nextGroups;
      });
      return;
    }

    setAgentWorkspaceGroups((currentGroups) => {
      const nextGroups = removeTabFromWorkspaceGroups(currentGroups, terminalId);
      const nextActiveGroup =
        nextGroups.find((group) => group.id === activeAgentWorkspaceGroupId) ??
        nextGroups[0] ??
        null;

      setActiveAgentWorkspaceGroupId(nextActiveGroup?.id ?? null);
      setActiveAgentTerminalId((currentActiveId) =>
        currentActiveId === terminalId ? nextActiveGroup?.activeTabId ?? null : currentActiveId
      );

      return nextGroups;
    });
  }, [activeAgentWorkspaceGroupId, activeNativeTerminalGroupId, terminalTabs]);

  const handleTerminalTitleChange = useCallback((terminalId: string, title: string) => {
    setTerminalTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === terminalId && tab.title !== title
          ? { ...tab, title }
          : tab
      )
    );
  }, []);

  const handleToggleSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;

    if (panel.isCollapsed()) {
      panel.expand();
      setSidebarCollapsed(false);
      return;
    }

    panel.collapse();
    setSidebarCollapsed(true);
  }, []);

  const handleShowSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    setActiveSidebarTab("files");
    if (!panel || !panel.isCollapsed()) return;
    panel.expand();
    setSidebarCollapsed(false);
  }, []);

  const handleSwitchWorkspace = useCallback(async () => {
    if (!workspacePath) return;

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Switch Project",
        defaultPath: workspacePath,
      });

      const nextPath =
        typeof selected === "string" ? selected : Array.isArray(selected) ? selected[0] : null;
      if (!nextPath || nextPath === workspacePath) return;

      await Promise.all(
        terminalTabs.map((tab) =>
          invoke("close_terminal", { terminalId: tab.id }).catch((error) => {
            console.error(`Failed to close terminal ${tab.id}:`, error);
          })
        )
      );

      setTerminalTabs([]);
      setAgentWorkspaceGroups([]);
      setNativeTerminalGroups([]);
      setActiveNativeTerminalId(null);
      setActiveAgentTerminalId(null);
      setActiveAgentWorkspaceGroupId(null);
      setActiveNativeTerminalGroupId(null);
      setOpenTabs([]);
      setEditorWorkspaceGroups([]);
      setActiveTabId(null);
      setActiveEditorWorkspaceGroupId(null);
      setEditorLayoutMode("single");
      setDiffTabs([]);
      setActiveDiffTabId(null);
      setDiffDirtyState({});
      setEditorViewModes({});
      setEditorSelectionContexts({});
      setActiveWorkspace("agent");
      setActiveSidebarTab("files");
      setAgentPresetMenuOpen(false);
      setWorkspacePath(nextPath);
    } catch (error) {
      console.error("Failed to switch workspace:", error);
    }
  }, [setWorkspacePath, terminalTabs, workspacePath]);

  const handleSetEditorViewMode = useCallback((tabId: string, mode: "code" | "preview") => {
    setEditorViewModes((currentModes) => ({
      ...currentModes,
      [tabId]: mode,
    }));
  }, []);

  const handleActivateAgentWorkspaceTab = useCallback((groupId: string, tabId: string) => {
    setAgentWorkspaceGroups((currentGroups) =>
      setWorkspaceGroupActiveTab(currentGroups, groupId, tabId)
    );
    setActiveAgentWorkspaceGroupId(groupId);
    setActiveAgentTerminalId(tabId);
  }, []);

  const handleAgentTabPointerDown = useCallback((
    groupId: string,
    tabId: string,
    event: PointerEvent<HTMLElement>
  ) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".terminal-tab-close")) return;

    agentTabDragStartRef.current = { groupId, tabId, x: event.clientX, y: event.clientY };

    const cleanup = () => {
      agentTabDragStartRef.current = null;
      setDraggedAgentTab(null);
      setAgentTabDropTarget(null);
      setAgentTabDragPreviewPosition(null);
      agentTabDropTargetRef.current = null;
      document.body.classList.remove("cli-tab-dragging");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const start = agentTabDragStartRef.current;
      if (!start) return;

      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= 5) return;

      if (!agentTabSuppressClickRef.current) {
        setDraggedAgentTab({ groupId: start.groupId, tabId: start.tabId });
        setAgentTabDragPreviewPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        document.body.classList.add("cli-tab-dragging");
        agentTabSuppressClickRef.current = true;
      }

      setAgentTabDragPreviewPosition({ x: moveEvent.clientX, y: moveEvent.clientY });

      const targetElement = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
      const targetTabElement = targetElement?.closest<HTMLElement>("[data-agent-tab-id]");
      const targetGroupId = targetTabElement?.dataset.agentGroupId;
      const targetTabId = targetTabElement?.dataset.agentTabId;

      if (
        !targetGroupId ||
        !targetTabId ||
        targetGroupId !== start.groupId ||
        targetTabId === start.tabId
      ) {
        setAgentTabDropTarget(null);
        agentTabDropTargetRef.current = null;
        return;
      }

      const targetRect = targetTabElement.getBoundingClientRect();
      const edge: "before" | "after" =
        moveEvent.clientX < targetRect.left + targetRect.width / 2 ? "before" : "after";
      const nextDropTarget = { groupId: targetGroupId, tabId: targetTabId, edge };
      agentTabDropTargetRef.current = nextDropTarget;
      setAgentTabDropTarget(nextDropTarget);
    };

    const handlePointerUp = () => {
      const start = agentTabDragStartRef.current;
      const dropTarget = agentTabDropTargetRef.current;
      if (start && dropTarget?.groupId === start.groupId && dropTarget.tabId !== start.tabId) {
        setAgentWorkspaceGroups((currentGroups) =>
          currentGroups.map((group) => {
            if (group.id !== start.groupId) return group;
            const nextTabIds = reorderTabIds(group.tabIds, start.tabId, dropTarget.tabId, dropTarget.edge);
            return nextTabIds === group.tabIds ? group : { ...group, tabIds: nextTabIds };
          })
        );
      }

      cleanup();
      requestAnimationFrame(() => {
        agentTabSuppressClickRef.current = false;
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, []);

  const handleAgentTabClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!agentTabSuppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleNativeTerminalTabPointerDown = useCallback((
    groupId: string,
    tabId: string,
    event: PointerEvent<HTMLElement>
  ) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".terminal-tab-close")) return;

    nativeTerminalTabDragStartRef.current = { groupId, tabId, x: event.clientX, y: event.clientY };

    const cleanup = () => {
      nativeTerminalTabDragStartRef.current = null;
      setDraggedNativeTerminalTab(null);
      setNativeTerminalTabDropTarget(null);
      setNativeTerminalTabDragPreviewPosition(null);
      nativeTerminalTabDropTargetRef.current = null;
      document.body.classList.remove("terminal-tab-dragging");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const start = nativeTerminalTabDragStartRef.current;
      if (!start) return;

      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= 5) return;

      if (!nativeTerminalTabSuppressClickRef.current) {
        setDraggedNativeTerminalTab({ groupId: start.groupId, tabId: start.tabId });
        setNativeTerminalTabDragPreviewPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        document.body.classList.add("terminal-tab-dragging");
        nativeTerminalTabSuppressClickRef.current = true;
      }

      setNativeTerminalTabDragPreviewPosition({ x: moveEvent.clientX, y: moveEvent.clientY });

      const targetElement = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
      const targetTabElement = targetElement?.closest<HTMLElement>("[data-native-terminal-tab-id]");
      const targetGroupId = targetTabElement?.dataset.nativeTerminalGroupId;
      const targetTabId = targetTabElement?.dataset.nativeTerminalTabId;

      if (
        !targetGroupId ||
        !targetTabId ||
        targetGroupId !== start.groupId ||
        targetTabId === start.tabId
      ) {
        setNativeTerminalTabDropTarget(null);
        nativeTerminalTabDropTargetRef.current = null;
        return;
      }

      const targetRect = targetTabElement.getBoundingClientRect();
      const edge: "before" | "after" =
        moveEvent.clientX < targetRect.left + targetRect.width / 2 ? "before" : "after";
      const nextDropTarget = { groupId: targetGroupId, tabId: targetTabId, edge };
      nativeTerminalTabDropTargetRef.current = nextDropTarget;
      setNativeTerminalTabDropTarget(nextDropTarget);
    };

    const handlePointerUp = () => {
      const start = nativeTerminalTabDragStartRef.current;
      const dropTarget = nativeTerminalTabDropTargetRef.current;
      if (start && dropTarget?.groupId === start.groupId && dropTarget.tabId !== start.tabId) {
        setNativeTerminalGroups((currentGroups) =>
          currentGroups.map((group) => {
            if (group.id !== start.groupId) return group;
            const nextTabIds = reorderTabIds(group.tabIds, start.tabId, dropTarget.tabId, dropTarget.edge);
            return nextTabIds === group.tabIds ? group : { ...group, tabIds: nextTabIds };
          })
        );
      }

      cleanup();
      requestAnimationFrame(() => {
        nativeTerminalTabSuppressClickRef.current = false;
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, []);

  const handleNativeTerminalTabClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!nativeTerminalTabSuppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleActivateNativeTerminalTab = useCallback((groupId: string, tabId: string) => {
    setNativeTerminalGroups((currentGroups) =>
      setWorkspaceGroupActiveTab(currentGroups, groupId, tabId)
    );
    setActiveNativeTerminalGroupId(groupId);
    setActiveNativeTerminalId(tabId);
  }, []);

  const handleEditorTabPointerDown = useCallback((
    groupId: string | null,
    tabId: string,
    event: PointerEvent<HTMLElement>
  ) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".code-tab-close")) return;

    editorTabDragStartRef.current = { groupId, tabId, x: event.clientX, y: event.clientY };

    const cleanup = () => {
      editorTabDragStartRef.current = null;
      setDraggedEditorTab(null);
      setEditorTabDropTarget(null);
      setEditorTabDragPreviewPosition(null);
      editorTabDropTargetRef.current = null;
      document.body.classList.remove("editor-tab-dragging");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const start = editorTabDragStartRef.current;
      if (!start) return;

      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= 5) return;

      if (!editorTabSuppressClickRef.current) {
        setDraggedEditorTab({ groupId: start.groupId, tabId: start.tabId });
        setEditorTabDragPreviewPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        document.body.classList.add("editor-tab-dragging");
        editorTabSuppressClickRef.current = true;
      }

      setEditorTabDragPreviewPosition({ x: moveEvent.clientX, y: moveEvent.clientY });

      const targetElement = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
      const targetTabElement = targetElement?.closest<HTMLElement>("[data-editor-tab-id]");
      const targetGroupId = targetTabElement?.dataset.editorGroupId ?? null;
      const targetTabId = targetTabElement?.dataset.editorTabId;

      if (
        !targetTabId ||
        targetGroupId !== start.groupId ||
        targetTabId === start.tabId
      ) {
        setEditorTabDropTarget(null);
        editorTabDropTargetRef.current = null;
        return;
      }

      const targetRect = targetTabElement.getBoundingClientRect();
      const edge: "before" | "after" =
        moveEvent.clientX < targetRect.left + targetRect.width / 2 ? "before" : "after";
      const nextDropTarget = { groupId: targetGroupId, tabId: targetTabId, edge };
      editorTabDropTargetRef.current = nextDropTarget;
      setEditorTabDropTarget(nextDropTarget);
    };

    const handlePointerUp = () => {
      const start = editorTabDragStartRef.current;
      const dropTarget = editorTabDropTargetRef.current;
      if (start && dropTarget && dropTarget.groupId === start.groupId && dropTarget.tabId !== start.tabId) {
        if (start.groupId) {
          setEditorWorkspaceGroups((currentGroups) =>
            currentGroups.map((group) => {
              if (group.id !== start.groupId) return group;
              const nextTabIds = reorderTabIds(group.tabIds, start.tabId, dropTarget.tabId, dropTarget.edge);
              return nextTabIds === group.tabIds ? group : { ...group, tabIds: nextTabIds };
            })
          );
        } else {
          setOpenTabs((currentTabs) =>
            reorderItemsById(currentTabs, start.tabId, dropTarget.tabId, dropTarget.edge)
          );
        }
      }

      cleanup();
      requestAnimationFrame(() => {
        editorTabSuppressClickRef.current = false;
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, []);

  const handleEditorTabClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!editorTabSuppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDiffTabPointerDown = useCallback((
    tabId: string,
    event: PointerEvent<HTMLElement>
  ) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".diff-tab-close")) return;

    diffTabDragStartRef.current = { tabId, x: event.clientX, y: event.clientY };

    const cleanup = () => {
      diffTabDragStartRef.current = null;
      setDraggedDiffTab(null);
      setDiffTabDropTarget(null);
      setDiffTabDragPreviewPosition(null);
      diffTabDropTargetRef.current = null;
      document.body.classList.remove("diff-tab-dragging");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const start = diffTabDragStartRef.current;
      if (!start) return;

      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= 5) return;

      if (!diffTabSuppressClickRef.current) {
        setDraggedDiffTab({ tabId: start.tabId });
        setDiffTabDragPreviewPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        document.body.classList.add("diff-tab-dragging");
        diffTabSuppressClickRef.current = true;
      }

      setDiffTabDragPreviewPosition({ x: moveEvent.clientX, y: moveEvent.clientY });

      const targetElement = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
      const targetTabElement = targetElement?.closest<HTMLElement>("[data-diff-tab-id]");
      const targetTabId = targetTabElement?.dataset.diffTabId;

      if (!targetTabId || targetTabId === start.tabId) {
        setDiffTabDropTarget(null);
        diffTabDropTargetRef.current = null;
        return;
      }

      const targetRect = targetTabElement.getBoundingClientRect();
      const edge: "before" | "after" =
        moveEvent.clientX < targetRect.left + targetRect.width / 2 ? "before" : "after";
      const nextDropTarget = { tabId: targetTabId, edge };
      diffTabDropTargetRef.current = nextDropTarget;
      setDiffTabDropTarget(nextDropTarget);
    };

    const handlePointerUp = () => {
      const start = diffTabDragStartRef.current;
      const dropTarget = diffTabDropTargetRef.current;
      if (start && dropTarget && dropTarget.tabId !== start.tabId) {
        setDiffTabs((currentTabs) =>
          reorderItemsById(currentTabs, start.tabId, dropTarget.tabId, dropTarget.edge)
        );
      }

      cleanup();
      requestAnimationFrame(() => {
        diffTabSuppressClickRef.current = false;
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, []);

  const handleDiffTabClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!diffTabSuppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleActivateEditorWorkspaceTab = useCallback((groupId: string, tabId: string) => {
    setEditorWorkspaceGroups((currentGroups) =>
      setWorkspaceGroupActiveTab(currentGroups, groupId, tabId)
    );
    setActiveEditorWorkspaceGroupId(groupId);
    setActiveTabId(tabId);
  }, []);

  const handleSplitAgentWorkspaceGroup = useCallback((groupId: string) => {
    const nextGroup = createAgentWorkspaceGroup();
    setAgentWorkspaceGroups((currentGroups) => insertWorkspaceGroupAfter(currentGroups, groupId, nextGroup));
    setActiveAgentWorkspaceGroupId(nextGroup.id);
    setActiveAgentTerminalId(null);
  }, [createAgentWorkspaceGroup]);

  const handleSplitNativeTerminalGroup = useCallback((groupId: string) => {
    const nextGroup = createNativeTerminalGroup();
    setNativeTerminalGroups((currentGroups) => insertWorkspaceGroupAfter(currentGroups, groupId, nextGroup));
    setActiveNativeTerminalGroupId(nextGroup.id);
    setActiveNativeTerminalId(null);
  }, [createNativeTerminalGroup]);

  const handleSplitEditorWorkspaceGroup = useCallback((groupId?: string) => {
    if (editorLayoutMode === "single") {
      const resolvedActiveTabId = activeTabId ?? openTabs[0]?.id ?? null;
      if (!resolvedActiveTabId) return;

      const leftGroup = createEditorWorkspaceGroup();
      const rightGroup = createEditorWorkspaceGroup();
      setEditorWorkspaceGroups([
        {
          ...leftGroup,
          tabIds: openTabs.map((tab) => tab.id),
          activeTabId: resolvedActiveTabId,
        },
        {
          ...rightGroup,
          tabIds: [resolvedActiveTabId],
          activeTabId: resolvedActiveTabId,
        },
      ]);
      setActiveEditorWorkspaceGroupId(rightGroup.id);
      setActiveTabId(resolvedActiveTabId);
      setEditorLayoutMode("split");
      return;
    }

    if (!groupId) return;
    const sourceGroup = editorWorkspaceGroups.find((group) => group.id === groupId) ?? null;
    const sourceTabId = sourceGroup?.activeTabId ?? sourceGroup?.tabIds[0] ?? null;
    const nextGroup = createEditorWorkspaceGroup();
    setEditorWorkspaceGroups((currentGroups) =>
      insertWorkspaceGroupAfter(
        currentGroups,
        groupId,
        sourceTabId
          ? {
              ...nextGroup,
              tabIds: [sourceTabId],
              activeTabId: sourceTabId,
            }
          : nextGroup
      )
    );
    setActiveEditorWorkspaceGroupId(nextGroup.id);
    setActiveTabId(sourceTabId);
  }, [activeTabId, createEditorWorkspaceGroup, editorLayoutMode, editorWorkspaceGroups, openTabs]);

  const handleCloseAgentWorkspaceGroup = useCallback((groupId: string) => {
    setAgentWorkspaceGroups((currentGroups) => {
      const { nextGroups, nextActiveGroupId } = closeWorkspaceTabGroup(currentGroups, groupId);
      const resolvedActiveGroupId =
        activeAgentWorkspaceGroupId === groupId
          ? nextActiveGroupId
          : nextGroups.find((group) => group.id === activeAgentWorkspaceGroupId)?.id ??
            nextActiveGroupId;
      const resolvedActiveGroup = nextGroups.find((group) => group.id === resolvedActiveGroupId) ?? null;
      setActiveAgentWorkspaceGroupId(resolvedActiveGroupId);
      setActiveAgentTerminalId((currentActiveId) =>
        currentGroups.some((group) => group.id === groupId && group.tabIds.includes(currentActiveId ?? ""))
          ? resolvedActiveGroup?.activeTabId ?? null
          : currentActiveId
      );
      return nextGroups;
    });
  }, [activeAgentWorkspaceGroupId]);

  const handleCloseNativeTerminalGroup = useCallback((groupId: string) => {
    setNativeTerminalGroups((currentGroups) => {
      const { nextGroups, nextActiveGroupId } = closeWorkspaceTabGroup(currentGroups, groupId);
      const resolvedActiveGroupId =
        activeNativeTerminalGroupId === groupId
          ? nextActiveGroupId
          : nextGroups.find((group) => group.id === activeNativeTerminalGroupId)?.id ??
            nextActiveGroupId;
      const resolvedActiveGroup = nextGroups.find((group) => group.id === resolvedActiveGroupId) ?? null;
      setActiveNativeTerminalGroupId(resolvedActiveGroupId);
      setActiveNativeTerminalId((currentActiveId) =>
        currentGroups.some((group) => group.id === groupId && group.tabIds.includes(currentActiveId ?? ""))
          ? resolvedActiveGroup?.activeTabId ?? null
          : currentActiveId
      );
      return nextGroups;
    });
  }, [activeNativeTerminalGroupId]);

  const handleCloseEditorWorkspaceGroup = useCallback((groupId: string) => {
    setEditorWorkspaceGroups((currentGroups) => {
      const targetGroupIndex = currentGroups.findIndex((group) => group.id === groupId);
      if (targetGroupIndex === -1) return currentGroups;

      const nextGroups = currentGroups.filter((group) => group.id !== groupId);
      const remainingTabIds = new Set(nextGroups.flatMap((group) => group.tabIds));
      setOpenTabs((currentTabs) => currentTabs.filter((tab) => remainingTabIds.has(tab.id)));
      setEditorViewModes((currentModes) => {
        const nextModes: Record<string, "code" | "preview"> = {};
        let changed = false;

        for (const [tabId, mode] of Object.entries(currentModes)) {
          if (!remainingTabIds.has(tabId)) {
            changed = true;
            continue;
          }
          nextModes[tabId] = mode;
        }

        return changed ? nextModes : currentModes;
      });
      setEditorSelectionContexts((currentSelections) => {
        const nextSelections: Record<string, EditorSelectionContext | null> = {};
        let changed = false;

        for (const [selectionKey, selection] of Object.entries(currentSelections)) {
          if (selectionKey.startsWith(`${groupId}::`)) {
            changed = true;
            continue;
          }
          nextSelections[selectionKey] = selection;
        }

        return changed ? nextSelections : currentSelections;
      });

      if (nextGroups.length <= 1) {
        const remainingGroup = nextGroups[0] ?? null;
        setEditorLayoutMode("single");
        setActiveEditorWorkspaceGroupId(null);
        setActiveTabId(remainingGroup?.activeTabId ?? null);
        return [];
      }

      const resolvedActiveGroup =
        nextGroups[Math.max(0, targetGroupIndex - 1)] ??
        nextGroups[0] ??
        null;
      setActiveEditorWorkspaceGroupId(resolvedActiveGroup?.id ?? null);
      setActiveTabId(resolvedActiveGroup?.activeTabId ?? null);
      return nextGroups;
    });
  }, []);

  const handleCloseAllEditorTabs = useCallback(() => {
    void (async () => {
      const dirtyTabs = openTabs.filter((tab) => tab.content !== tab.savedContent);
      if (dirtyTabs.length > 0) {
        const confirmed = await confirm(
          dirtyTabs.length === 1
            ? `"${getTabName(dirtyTabs[0].path)}" has unsaved changes. Close all editor tabs anyway?`
            : `${dirtyTabs.length} editor tabs have unsaved changes. Close all editor tabs anyway?`,
          {
            title: "Subset",
            kind: "warning",
            okLabel: "Close All",
            cancelLabel: "Cancel",
          }
        );
        if (!confirmed) return;
      }

      setOpenTabs([]);
      setEditorWorkspaceGroups([]);
      setActiveTabId(null);
      setActiveEditorWorkspaceGroupId(null);
      setEditorViewModes({});
      setEditorSelectionContexts({});
      setEditorLayoutMode("single");
    })();
  }, [openTabs]);

  const handleLeaveEditorWorkspace = useCallback(() => {
    setActiveWorkspace(diffTabs.length > 0 ? "diff" : "terminal");
  }, [diffTabs.length]);

  useEffect(() => {
    if (agentWorkspaceGroups.length === 0) {
      if (activeAgentWorkspaceGroupId !== null) {
        setActiveAgentWorkspaceGroupId(null);
      }
      return;
    }

    if (!activeAgentWorkspaceGroupId || !agentWorkspaceGroups.some((group) => group.id === activeAgentWorkspaceGroupId)) {
      setActiveAgentWorkspaceGroupId(agentWorkspaceGroups[0].id);
    }
  }, [activeAgentWorkspaceGroupId, agentWorkspaceGroups]);

  useEffect(() => {
    if (nativeTerminalGroups.length === 0) {
      if (activeNativeTerminalGroupId !== null) {
        setActiveNativeTerminalGroupId(null);
      }
      return;
    }

    if (!activeNativeTerminalGroupId || !nativeTerminalGroups.some((group) => group.id === activeNativeTerminalGroupId)) {
      setActiveNativeTerminalGroupId(nativeTerminalGroups[0].id);
    }
  }, [activeNativeTerminalGroupId, nativeTerminalGroups]);

  useEffect(() => {
    if (editorLayoutMode !== "split") {
      if (editorWorkspaceGroups.length > 0) {
        setEditorWorkspaceGroups([]);
      }
      if (activeEditorWorkspaceGroupId !== null) {
        setActiveEditorWorkspaceGroupId(null);
      }
      return;
    }

    if (editorWorkspaceGroups.length === 0) {
      if (activeEditorWorkspaceGroupId !== null) {
        setActiveEditorWorkspaceGroupId(null);
      }
      return;
    }

    if (!activeEditorWorkspaceGroupId || !editorWorkspaceGroups.some((group) => group.id === activeEditorWorkspaceGroupId)) {
      setActiveEditorWorkspaceGroupId(editorWorkspaceGroups[0].id);
    }
  }, [activeEditorWorkspaceGroupId, editorLayoutMode, editorWorkspaceGroups]);

  useEffect(() => {
    if (editorLayoutMode !== "single") return;

    if (openTabs.length === 0) {
      if (activeTabId !== null) {
        setActiveTabId(null);
      }
      return;
    }

    if (!activeTabId || !openTabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(openTabs[0].id);
    }
  }, [activeTabId, editorLayoutMode, openTabs]);

  useEffect(() => {
    if (editorLayoutMode !== "split") return;

    if (openTabs.length === 0) {
      setEditorLayoutMode("single");
      setEditorWorkspaceGroups([]);
      setActiveEditorWorkspaceGroupId(null);
      if (activeTabId !== null) {
        setActiveTabId(null);
      }
      return;
    }

    setEditorWorkspaceGroups((currentGroups) => {
      const validTabIds = new Set(openTabs.map((tab) => tab.id));
      let changed = false;
      const nextGroups = currentGroups.map((group) => {
        const nextTabIds = group.tabIds.filter((tabId) => validTabIds.has(tabId));
        const nextActiveTabId =
          group.activeTabId && nextTabIds.includes(group.activeTabId)
            ? group.activeTabId
            : nextTabIds[nextTabIds.length - 1] ?? null;

        if (
          nextTabIds.length === group.tabIds.length &&
          nextActiveTabId === group.activeTabId
        ) {
          return group;
        }

        changed = true;
        return {
          ...group,
          tabIds: nextTabIds,
          activeTabId: nextActiveTabId,
        };
      });

      return changed ? nextGroups : currentGroups;
    });
  }, [activeTabId, editorLayoutMode, openTabs]);

  useEffect(() => {
    if (!workspacePath) return;

    if (git.capability?.status && git.capability.status !== "available") {
      setDiffTabs([]);
      setActiveDiffTabId(null);
      setDiffDirtyState({});
      return;
    }

    const stagedByPath = new Map((git.status?.staged ?? []).map((file) => [file.path, file]));
    const unstagedByPath = new Map(git.combinedChanges.map((file) => [file.path, file]));

    setDiffTabs((currentTabs) => {
      let changed = false;
      const nextTabs: DiffTab[] = [];

      for (const tab of currentTabs) {
        if (tab.kind === "all") {
          nextTabs.push(tab);
          continue;
        }

        const nextStaged = stagedByPath.get(tab.file.path);
        if (nextStaged) {
          if (tab.category !== "staged" || tab.file !== nextStaged) {
            changed = true;
            nextTabs.push({ ...tab, file: nextStaged, category: "staged" });
          } else {
            nextTabs.push(tab);
          }
          continue;
        }

        const nextUnstaged = unstagedByPath.get(tab.file.path);
        if (nextUnstaged) {
          if (tab.category !== "unstaged" || tab.file !== nextUnstaged) {
            changed = true;
            nextTabs.push({ ...tab, file: nextUnstaged, category: "unstaged" });
          } else {
            nextTabs.push(tab);
          }
          continue;
        }

        changed = true;
      }

      if (!changed) {
        return currentTabs;
      }

      if (nextTabs.length === 0) {
        setActiveDiffTabId(null);
      } else if (activeDiffTabId && !nextTabs.some((tab) => tab.id === activeDiffTabId)) {
        setActiveDiffTabId(nextTabs[nextTabs.length - 1]?.id ?? null);
      }

      return nextTabs;
    });
  }, [activeDiffTabId, git.capability?.status, git.combinedChanges, git.status?.staged, workspacePath]);

  useEffect(() => {
    if (diffTabs.length === 0) {
      if (activeDiffTabId !== null) {
        setActiveDiffTabId(null);
      }
      return;
    }

    if (!activeDiffTabId || !diffTabs.some((tab) => tab.id === activeDiffTabId)) {
      setActiveDiffTabId(diffTabs[0].id);
    }
  }, [activeDiffTabId, diffTabs]);

  useEffect(() => {
    setDiffDirtyState((currentState) => {
      const validIds = new Set(diffTabs.map((tab) => tab.id));
      let changed = false;
      const nextState: Record<string, boolean> = {};

      for (const [tabId, dirty] of Object.entries(currentState)) {
        if (!validIds.has(tabId)) {
          changed = true;
          continue;
        }
        nextState[tabId] = dirty;
      }

      return changed ? nextState : currentState;
    });
  }, [diffTabs]);

  useEffect(() => {
    const nativeTabs = terminalTabs.filter((tab) => tab.kind === "native");
    if (nativeTabs.length === 0) {
      if (activeNativeTerminalId !== null) {
        setActiveNativeTerminalId(null);
      }
      if (nativeTerminalGroups.length > 0) {
        setNativeTerminalGroups([]);
      }
      if (activeNativeTerminalGroupId !== null) {
        setActiveNativeTerminalGroupId(null);
      }
      return;
    }

    if (
      !activeNativeTerminalId ||
      !nativeTabs.some((tab) => tab.id === activeNativeTerminalId)
    ) {
      setActiveNativeTerminalId(nativeTabs[0].id);
    }
  }, [
    activeNativeTerminalGroupId,
    activeNativeTerminalId,
    nativeTerminalGroups.length,
    terminalTabs,
  ]);

  useEffect(() => {
    const agentTabs = terminalTabs.filter((tab) => tab.kind === "agent");
    if (agentTabs.length === 0) {
      if (activeAgentTerminalId !== null) {
        setActiveAgentTerminalId(null);
      }
      return;
    }

    if (
      !activeAgentTerminalId ||
      !agentTabs.some((tab) => tab.id === activeAgentTerminalId)
    ) {
      setActiveAgentTerminalId(agentTabs[0].id);
    }
  }, [activeAgentTerminalId, terminalTabs]);

  const activeTab = openTabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeEditorMode =
    activeTab && isPreviewablePath(activeTab.path)
      ? supportsCodeViewForPath(activeTab.path)
        ? (editorViewModes[activeTab.id] ?? "preview")
        : "preview"
      : "code";
  const activeDiffTab = activeDiffTabForPolling;
  const activeDiffSelection =
    activeDiffTab?.kind === "file"
      ? { file: activeDiffTab.file, category: activeDiffTab.category }
      : null;
  const activeDiffChrome =
    activeDiffTab?.kind === "file" ? (diffChromeState[activeDiffTab.id] ?? null) : null;
  const agentTerminalTabs = terminalTabs.filter((tab) => tab.kind === "agent");
  const nativeTerminalTabs = terminalTabs.filter((tab) => tab.kind === "native");
  const activeClaudeAgentTab =
    agentTerminalTabs.find((tab) => tab.id === activeAgentTerminalId && tab.presetId === "claude") ?? null;
  const canAddClaudeContext = Boolean(activeClaudeAgentTab);
  const agentTerminalTabsById = useMemo(
    () => new Map(agentTerminalTabs.map((tab) => [tab.id, tab])),
    [agentTerminalTabs]
  );
  const nativeTerminalTabsById = useMemo(
    () => new Map(nativeTerminalTabs.map((tab) => [tab.id, tab])),
    [nativeTerminalTabs]
  );
  const editorTabsById = useMemo(
    () => new Map(openTabs.map((tab) => [tab.id, tab])),
    [openTabs]
  );
  const agentWorkspaceGroupsForRender = useMemo(
    () =>
      agentWorkspaceGroups.map((group) => ({
        ...group,
        tabs: group.tabIds
          .map((tabId) => agentTerminalTabsById.get(tabId))
          .filter((tab): tab is TerminalTab => Boolean(tab)),
      })),
    [agentTerminalTabsById, agentWorkspaceGroups]
  );
  const nativeTerminalGroupsForRender = useMemo(
    () =>
      nativeTerminalGroups.map((group) => ({
        ...group,
        tabs: group.tabIds
          .map((tabId) => nativeTerminalTabsById.get(tabId))
          .filter((tab): tab is TerminalTab => Boolean(tab)),
      })),
    [nativeTerminalGroups, nativeTerminalTabsById]
  );
  const editorWorkspaceGroupsForRender = useMemo(
    () =>
      editorWorkspaceGroups.map((group) => ({
        ...group,
        tabs: group.tabIds
          .map((tabId) => editorTabsById.get(tabId))
          .filter((tab): tab is FileEditorTab => Boolean(tab)),
      })),
    [editorTabsById, editorWorkspaceGroups]
  );
  const totalChangedFiles = (git.status?.staged.length ?? 0) + git.combinedChanges.length;
  const workspaceDisplayPath = formatWorkspacePath(workspacePath);
  const currentBranchName = branchList?.current ?? git.status?.branch ?? "HEAD";
  const branchFilter = branchQuery.trim().toLowerCase();
  const filteredLocalBranches = useMemo(
    () =>
      (branchList?.local ?? []).filter((branch) =>
        branchFilter ? branch.toLowerCase().includes(branchFilter) : true,
      ),
    [branchFilter, branchList?.local],
  );
  const filteredRemoteBranches = useMemo(
    () =>
      (branchList?.remote ?? []).filter((branch) =>
        branchFilter ? branch.toLowerCase().includes(branchFilter) : true,
      ),
    [branchFilter, branchList?.remote],
  );
  const draggedAgentTabLabel =
    draggedAgentTab ? agentTerminalTabsById.get(draggedAgentTab.tabId)?.title ?? null : null;
  const draggedNativeTerminalTabLabel =
    draggedNativeTerminalTab ? nativeTerminalTabsById.get(draggedNativeTerminalTab.tabId)?.title ?? null : null;
  const draggedEditorTabLabel =
    draggedEditorTab ? openTabs.find((tab) => tab.id === draggedEditorTab.tabId)?.path ?? null : null;
  const draggedDiffTabLabel = draggedDiffTab
    ? (() => {
        const tab = diffTabs.find((item) => item.id === draggedDiffTab.tabId);
        if (!tab) return null;
        return tab.kind === "all"
          ? `All Changes (${totalChangedFiles} files)`
          : getDiffTabLabel(tab.file, tab.category);
      })()
    : null;
  const branchSourceOptions = useMemo(() => {
    const unique = new Set<string>();
    const options: string[] = [];
    for (const branch of [
      currentBranchName,
      ...(branchList?.local ?? []),
      ...(branchList?.remote ?? []),
    ]) {
      if (unique.has(branch)) continue;
      unique.add(branch);
      options.push(branch);
    }
    return options;
  }, [branchList?.local, branchList?.remote, currentBranchName]);
  const agentPresetMenu =
    agentPresetMenuOpen && agentPresetMenuPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={agentPresetMenuPopupRef}
            className="agent-preset-menu"
            role="menu"
            aria-label="AI Coding CLI presets"
            style={{
              position: "fixed",
              top: agentPresetMenuPosition.top,
              right: agentPresetMenuPosition.right,
            }}
          >
            {AGENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="agent-preset-menu-item"
                onClick={() => handleCreateAgentTerminal(preset)}
              >
                <span className="agent-preset-menu-main">
                  <img
                    src={preset.iconPath}
                    alt=""
                    className="agent-preset-menu-icon"
                    draggable={false}
                  />
                  <span className="agent-preset-menu-copy">
                    <span className="agent-preset-menu-title">{preset.label}</span>
                    <span className="agent-preset-menu-description">{preset.description}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>,
          document.body
        )
      : null;
  const branchMenu = branchMenuOpen ? (
    <div className="git-branch-menu" role="menu" aria-label="Git branches">
      <input
        value={branchQuery}
        onChange={(event) => setBranchQuery(event.target.value)}
        className="git-branch-menu-search"
        placeholder="Select a branch or tag to checkout"
        autoFocus
      />
      <div className="git-branch-menu-actions">
        <button
          type="button"
          className="git-branch-menu-row git-branch-menu-row--action"
          onClick={() => {
            setBranchCreateMode("current");
            setBranchCreateName("");
            setBranchCreateSource(currentBranchName);
          }}
        >
          <span className="git-branch-menu-row-main">
            <Plus className="size-3.5" />
            <span className="git-branch-menu-row-title">Create new branch...</span>
          </span>
        </button>
        <button
          type="button"
          className="git-branch-menu-row git-branch-menu-row--action"
          onClick={() => {
            setBranchCreateMode("from");
            setBranchCreateName("");
            setBranchCreateSource(
              filteredLocalBranches[0] ?? filteredRemoteBranches[0] ?? currentBranchName,
            );
          }}
        >
          <span className="git-branch-menu-row-main">
            <Plus className="size-3.5" />
            <span className="git-branch-menu-row-title">Create new branch from...</span>
          </span>
        </button>
      </div>
      {branchCreateMode !== "none" ? (
        <form
          className="git-branch-menu-create"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!workspacePath) return;
            const name = branchCreateName.trim();
            if (!name) {
              setBranchMenuError("Branch name is required.");
              return;
            }
            setBranchActionPending("create");
            setBranchMenuError(null);
            try {
              await gitCreateBranch(
                workspacePath,
                name,
                branchCreateMode === "from" ? branchCreateSource : currentBranchName,
              );
              await git.refresh({ silent: true });
              await loadBranchList();
              setBranchMenuOpen(false);
              setBranchCreateMode("none");
              setBranchCreateName("");
            } catch (error) {
              setBranchMenuError(error instanceof Error ? error.message : String(error));
            } finally {
              setBranchActionPending(null);
            }
          }}
        >
          <div className="git-branch-menu-create-header">
            <span className="git-branch-menu-section-title">
              {branchCreateMode === "from" ? "Create branch from" : "Create branch"}
            </span>
            <button
              type="button"
              className="git-branch-menu-link"
              onClick={() => {
                setBranchCreateMode("none");
                setBranchCreateName("");
                setBranchMenuError(null);
              }}
            >
              Back
            </button>
          </div>
          <input
            value={branchCreateName}
            onChange={(event) => setBranchCreateName(event.target.value)}
            className="git-branch-menu-search"
            placeholder="Branch name"
            autoFocus
          />
          {branchCreateMode === "from" ? (
            <select
              value={branchCreateSource}
              onChange={(event) => setBranchCreateSource(event.target.value)}
              className="git-branch-menu-select"
            >
              {branchSourceOptions.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          ) : (
            <div className="git-branch-menu-meta">From {currentBranchName}</div>
          )}
          <div className="git-branch-menu-submit">
            <Button
              type="submit"
              size="xs"
              disabled={branchActionPending === "create"}
            >
              {branchActionPending === "create" ? "Creating..." : "Create branch"}
            </Button>
          </div>
        </form>
      ) : null}
      {branchMenuError ? <div className="git-branch-menu-error">{branchMenuError}</div> : null}
      {branchMenuLoading ? (
        <div className="git-branch-menu-empty">Loading branches...</div>
      ) : (
        <div className="git-branch-menu-groups">
          <div className="git-branch-menu-group">
            <div className="git-branch-menu-section-title">branches</div>
            {filteredLocalBranches.length > 0 ? (
              filteredLocalBranches.map((branch) => (
                <button
                  key={`local:${branch}`}
                  type="button"
                  className="git-branch-menu-row"
                  data-current={branch === currentBranchName ? "true" : undefined}
                  disabled={branchActionPending === "checkout" || branch === currentBranchName}
                  onClick={async () => {
                    if (!workspacePath) return;
                    setBranchActionPending("checkout");
                    setBranchMenuError(null);
                    try {
                      await gitCheckoutBranch(workspacePath, branch, "local");
                      await git.refresh({ silent: true });
                      await loadBranchList();
                      setBranchMenuOpen(false);
                    } catch (error) {
                      setBranchMenuError(error instanceof Error ? error.message : String(error));
                    } finally {
                      setBranchActionPending(null);
                    }
                  }}
                >
                  <span className="git-branch-menu-row-main">
                    <GitBranch className="size-3.5" />
                    <span className="git-branch-menu-row-copy">
                      <span className="git-branch-menu-row-title">{branch}</span>
                      {branch === currentBranchName ? (
                        <span className="git-branch-menu-row-meta">current branch</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="git-branch-menu-row-tag">branches</span>
                </button>
              ))
            ) : (
              <div className="git-branch-menu-empty">No matching local branches</div>
            )}
          </div>
          <div className="git-branch-menu-group">
            <div className="git-branch-menu-section-title">remote branches</div>
            {filteredRemoteBranches.length > 0 ? (
              filteredRemoteBranches.map((branch) => (
                <button
                  key={`remote:${branch}`}
                  type="button"
                  className="git-branch-menu-row"
                  disabled={branchActionPending === "checkout"}
                  onClick={async () => {
                    if (!workspacePath) return;
                    setBranchActionPending("checkout");
                    setBranchMenuError(null);
                    try {
                      await gitCheckoutBranch(workspacePath, branch, "remote");
                      await git.refresh({ silent: true });
                      await loadBranchList();
                      setBranchMenuOpen(false);
                    } catch (error) {
                      setBranchMenuError(error instanceof Error ? error.message : String(error));
                    } finally {
                      setBranchActionPending(null);
                    }
                  }}
                >
                  <span className="git-branch-menu-row-main">
                    <GitBranch className="size-3.5" />
                    <span className="git-branch-menu-row-copy">
                      <span className="git-branch-menu-row-title">{branch}</span>
                    </span>
                  </span>
                  <span className="git-branch-menu-row-tag">remote</span>
                </button>
              ))
            ) : (
              <div className="git-branch-menu-empty">No matching remote branches</div>
            )}
          </div>
        </div>
      )}
    </div>
  ) : null;

  const handleDiffChromeChange = useCallback((tabId: string, chrome: DiffEditorChrome | null) => {
    setDiffChromeState((current) => {
      if ((current[tabId] ?? null) === chrome) return current;
      if (chrome === null) {
        if (!(tabId in current)) return current;
        const next = { ...current };
        delete next[tabId];
        return next;
      }
      return { ...current, [tabId]: chrome };
    });
  }, []);

  const agentTabDragPreview =
    draggedAgentTab && agentTabDragPreviewPosition && draggedAgentTabLabel
      ? createPortal(
          <div
            className="cli-tab-drag-preview"
            style={{
              left: agentTabDragPreviewPosition.x + 14,
              top: agentTabDragPreviewPosition.y + 16,
            }}
          >
            <Sparkles className="size-3.5" />
            <span className="cli-tab-drag-preview-label">{draggedAgentTabLabel}</span>
          </div>,
          document.body
        )
      : null;
  const nativeTerminalTabDragPreview =
    draggedNativeTerminalTab && nativeTerminalTabDragPreviewPosition && draggedNativeTerminalTabLabel
      ? createPortal(
          <div
            className="cli-tab-drag-preview"
            style={{
              left: nativeTerminalTabDragPreviewPosition.x + 14,
              top: nativeTerminalTabDragPreviewPosition.y + 16,
            }}
          >
            <SquareTerminal className="size-3.5" />
            <span className="cli-tab-drag-preview-label">{draggedNativeTerminalTabLabel}</span>
          </div>,
          document.body
        )
      : null;
  const editorTabDragPreview =
    draggedEditorTab && editorTabDragPreviewPosition && draggedEditorTabLabel
      ? createPortal(
          <div
            className="cli-tab-drag-preview"
            style={{
              left: editorTabDragPreviewPosition.x + 14,
              top: editorTabDragPreviewPosition.y + 16,
            }}
          >
            <FileText className="size-3.5" />
            <span className="cli-tab-drag-preview-label">{getTabName(draggedEditorTabLabel)}</span>
          </div>,
          document.body
        )
      : null;
  const diffTabDragPreview =
    draggedDiffTab && diffTabDragPreviewPosition && draggedDiffTabLabel
      ? createPortal(
          <div
            className="cli-tab-drag-preview"
            style={{
              left: diffTabDragPreviewPosition.x + 14,
              top: diffTabDragPreviewPosition.y + 16,
            }}
          >
            <GitCompareArrows className="size-3.5" />
            <span className="cli-tab-drag-preview-label">{draggedDiffTabLabel}</span>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="main-layout-shell">
      {agentTabDragPreview}
      {nativeTerminalTabDragPreview}
      {editorTabDragPreview}
      {diffTabDragPreview}
      <div
        className="app-titlebar"
        onMouseDown={handleTitlebarMouseDown}
        onMouseMove={handleTitlebarMouseMove}
        onMouseUp={handleTitlebarMouseUp}
        onMouseLeave={handleTitlebarMouseUp}
      >
        <div className="app-titlebar-controls">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="app-titlebar-toggle"
            onClick={handleToggleSidebar}
            data-tauri-drag-region="false"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="app-titlebar-path-button"
            onClick={() => void handleSwitchWorkspace()}
            data-tauri-drag-region="false"
            title={workspacePath ?? undefined}
          >
            <FolderClosed className="size-3.5" />
            <span className="app-titlebar-path-text truncate">{workspaceDisplayPath}</span>
            <ChevronDown className="size-3.5 app-titlebar-path-chevron" />
          </Button>
          {git.capability?.status === "available" ? (
            <div className="git-branch-menu-anchor" ref={branchMenuRef}>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="app-titlebar-branch-button"
                onClick={() => {
                  setAgentPresetMenuOpen(false);
                  setBranchMenuOpen((current) => {
                    const next = !current;
                    if (next) {
                      setBranchQuery("");
                      setBranchCreateMode("none");
                      setBranchCreateName("");
                      setBranchMenuError(null);
                      setBranchMenuLoading(true);
                    } else {
                      setBranchCreateMode("none");
                      setBranchCreateName("");
                      setBranchMenuError(null);
                    }
                    return next;
                  });
                }}
                data-tauri-drag-region="false"
                title={`Current branch: ${currentBranchName}`}
                aria-expanded={branchMenuOpen}
                aria-haspopup="menu"
              >
                <GitBranch className="size-3.5" />
                <span className="app-titlebar-branch-text truncate">{currentBranchName}</span>
                <ChevronDown className="size-3.5 app-titlebar-path-chevron" />
              </Button>
              {branchMenu}
            </div>
          ) : null}
        </div>
        <div className="app-titlebar-drag-region" />
      </div>

      <ResizablePanelGroup
        orientation="horizontal"
        className="main-layout"
      >
        <ResizablePanel
          defaultSize={22}
          minSize={20}
          collapsible
          collapsedSize={0}
          panelRef={sidebarPanelRef}
          onResize={() => setSidebarCollapsed(sidebarPanelRef.current?.isCollapsed() ?? false)}
          className="flex min-h-0 flex-col"
        >
          <div className="main-layout-editor">
            <EditorPanel
              workspacePath={workspacePath!}
              onOpenFile={handleOpenFile}
              onAddClaudeContext={handleAddClaudeContext}
              onAddClaudeContextBatch={handleAddClaudeContextBatch}
              canAddClaudeContext={canAddClaudeContext}
              onOpenDiff={handleOpenDiff}
              onOpenAllDiffs={handleOpenAllDiffs}
              git={git}
              activeSidebarTab={activeSidebarTab}
              onSidebarTabChange={setActiveSidebarTab}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={78} minSize={30} className="flex min-h-0 flex-col">
          <div className="main-layout-terminal">
            <TooltipProvider delay={250}>
              <div className="workspace-manager-bar">
                <div className="workspace-manager-list" role="tablist" aria-label="Workspace switcher">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="workspace-manager-switch"
                    data-active={activeWorkspace === "agent" ? "true" : undefined}
                    onClick={() => setActiveWorkspace("agent")}
                    aria-pressed={activeWorkspace === "agent"}
                  >
                    <Sparkles className="size-3.5" />
                    <span className="workspace-manager-title">AI Coding CLI</span>
                    <span className="workspace-manager-count">{agentTerminalTabs.length}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="workspace-manager-switch"
                    data-active={activeWorkspace === "terminal" ? "true" : undefined}
                    onClick={() => {
                      setAgentPresetMenuOpen(false);
                      setActiveWorkspace("terminal");
                    }}
                    aria-pressed={activeWorkspace === "terminal"}
                  >
                    <SquareTerminal className="size-3.5" />
                    <span className="workspace-manager-title">Terminal</span>
                    <span className="workspace-manager-count">{nativeTerminalTabs.length}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="workspace-manager-switch"
                    data-active={activeWorkspace === "editor" ? "true" : undefined}
                    onClick={() => {
                      setAgentPresetMenuOpen(false);
                      setActiveWorkspace("editor");
                    }}
                    aria-pressed={activeWorkspace === "editor"}
                  >
                    <FileText className="size-3.5" />
                    <span className="workspace-manager-title">Editor</span>
                    <span className="workspace-manager-count">{openTabs.length}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="workspace-manager-switch"
                    data-active={activeWorkspace === "diff" ? "true" : undefined}
                    onClick={() => {
                      setAgentPresetMenuOpen(false);
                      setActiveWorkspace("diff");
                    }}
                    aria-pressed={activeWorkspace === "diff"}
                  >
                    <GitCompareArrows className="size-3.5" />
                    <span className="workspace-manager-title">Diff</span>
                    <span className="workspace-manager-count">{diffTabs.length}</span>
                  </Button>
                </div>
              </div>

              <div className="workspace-content-stack">
                <div
                  className="workspace-panel workspace-panel-agent"
                  data-active={activeWorkspace === "agent" ? "true" : undefined}
                >
                  {agentTerminalTabs.length > 0 ? (
                    <ResizablePanelGroup orientation="horizontal" className="workspace-split-layout">
                      {agentWorkspaceGroupsForRender.map((group, groupIndex) => {
                        const activeGroupTab =
                          group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0] ?? null;
                        const groupPanelTabs = agentTerminalTabs.filter((tab) =>
                          group.tabIds.includes(tab.id)
                        );

                        return (
                          <Fragment key={group.id}>
                            <ResizablePanel
                              defaultSize={100 / agentWorkspaceGroupsForRender.length}
                              minSize={20}
                              className="workspace-split-panel"
                            >
                              <div
                                className="workspace-split-group"
                                data-active={group.id === activeAgentWorkspaceGroupId ? "true" : undefined}
                                onMouseDown={() => setActiveAgentWorkspaceGroupId(group.id)}
                              >
                                {activeGroupTab ? (
                                  <Tabs
                                    value={activeGroupTab.id}
                                    onValueChange={(tabId) => {
                                      handleActivateAgentWorkspaceTab(group.id, tabId);
                                    }}
                                    className="terminal-shell terminal-group-shell"
                                  >
                                    <div className="terminal-tabs-bar">
                                      <ScrollArea
                                        className="terminal-tabs-scroll min-w-0 flex-1"
                                        onWheel={handleTabsWheel}
                                      >
                                        <TabsList
                                          variant="line"
                                          className="terminal-tabs-list min-w-max rounded-none border-0 bg-transparent p-0"
                                        >
                                          {group.tabs.map((tab) => (
                                            <Tooltip key={tab.id}>
                                              <TooltipTrigger
                                                render={
                                                  <TabsTrigger
                                                    value={tab.id}
                                                    className="terminal-tab group !flex-none justify-start gap-1.5 rounded-none border-0 px-2.5 py-0.5 after:hidden"
                                                    data-draggable="true"
                                                    data-agent-group-id={group.id}
                                                    data-agent-tab-id={tab.id}
                                                    data-dragging={
                                                      draggedAgentTab?.groupId === group.id &&
                                                      draggedAgentTab?.tabId === tab.id
                                                        ? "true"
                                                        : undefined
                                                    }
                                                    data-drop-target={
                                                      agentTabDropTarget?.groupId === group.id &&
                                                      agentTabDropTarget?.tabId === tab.id
                                                        ? "true"
                                                        : undefined
                                                    }
                                                    data-drop-edge={
                                                      agentTabDropTarget?.groupId === group.id &&
                                                      agentTabDropTarget?.tabId === tab.id
                                                        ? agentTabDropTarget.edge
                                                        : undefined
                                                    }
                                                    onPointerDown={(event) => {
                                                      handleAgentTabPointerDown(group.id, tab.id, event);
                                                    }}
                                                    onClickCapture={handleAgentTabClickCapture}
                                                  >
                                                    <span className="terminal-tab-label truncate">{tab.title}</span>
                                                    <span
                                                      role="button"
                                                      tabIndex={0}
                                                      className="terminal-tab-close"
                                                      onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        handleCloseTerminal(tab.id);
                                                      }}
                                                      onKeyDown={(event) => {
                                                        if (event.key !== "Enter" && event.key !== " ") return;
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        handleCloseTerminal(tab.id);
                                                      }}
                                                      aria-label={`Close ${tab.title}`}
                                                    >
                                                      <X className="size-3.5" />
                                                    </span>
                                                  </TabsTrigger>
                                                }
                                              />
                                              <TooltipContent>{tab.title}</TooltipContent>
                                            </Tooltip>
                                          ))}
                                        </TabsList>
                                        <ScrollBar orientation="horizontal" />
                                      </ScrollArea>
                                      <div
                                        className="terminal-tabs-actions agent-preset-menu-anchor"
                                        ref={group.id === activeAgentWorkspaceGroupId ? agentPresetMenuRef : undefined}
                                      >
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          className="terminal-tab-create"
                                          onClick={() => handleSplitAgentWorkspaceGroup(group.id)}
                                          aria-label="Split AI Coding CLI group"
                                        >
                                          <Columns2 className="size-3.5" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          className="terminal-tab-create"
                                          onClick={() => {
                                            setActiveAgentWorkspaceGroupId(group.id);
                                            setAgentPresetMenuOpen((openState) => !openState);
                                          }}
                                          aria-label="Launch AI Coding CLI"
                                          aria-expanded={
                                            group.id === activeAgentWorkspaceGroupId && agentPresetMenuOpen
                                          }
                                        >
                                          <Plus className="size-3.5" />
                                        </Button>
                                        {group.id === activeAgentWorkspaceGroupId ? agentPresetMenu : null}
                                        {agentWorkspaceGroupsForRender.length > 1 ? (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            className="terminal-tab-create"
                                            onClick={() => handleCloseAgentWorkspaceGroup(group.id)}
                                            aria-label="Close AI Coding CLI group"
                                          >
                                            <X className="size-3.5" />
                                          </Button>
                                        ) : null}
                                      </div>
                                    </div>

                                    <div className="terminal-stage">
                                      {groupPanelTabs.map((tab) => (
                                        <div
                                          key={tab.id}
                                          className="terminal-tab-panel"
                                          data-active={tab.id === activeGroupTab.id ? "true" : undefined}
                                        >
                                          <TerminalComponent
                                            terminalId={tab.id}
                                            cwd={tab.cwd}
                                            active={
                                              activeWorkspace === "agent" &&
                                              group.id === activeAgentWorkspaceGroupId &&
                                              tab.id === activeGroupTab.id
                                            }
                                            defaultTitle={tab.defaultTitle}
                                            startupCommands={tab.startupCommands}
                                            onTitleChange={(title) => handleTerminalTitleChange(tab.id, title)}
                                            canSendSelectionToClaude={canAddClaudeContext}
                                            onSendSelectionToClaude={(selection) =>
                                              handleSendTerminalSelectionToClaude(selection, tab.id)
                                            }
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  </Tabs>
                                ) : (
                                  <div className="terminal-shell terminal-group-shell">
                                    <div className="terminal-tabs-bar">
                                      <div className="terminal-tabs-empty-label">Empty split</div>
                                      <div
                                        className="terminal-tabs-actions agent-preset-menu-anchor"
                                        ref={group.id === activeAgentWorkspaceGroupId ? agentPresetMenuRef : undefined}
                                      >
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          className="terminal-tab-create"
                                          onClick={() => handleSplitAgentWorkspaceGroup(group.id)}
                                          aria-label="Split AI Coding CLI group"
                                        >
                                          <Columns2 className="size-3.5" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          className="terminal-tab-create"
                                          onClick={() => {
                                            setActiveAgentWorkspaceGroupId(group.id);
                                            setAgentPresetMenuOpen((openState) => !openState);
                                          }}
                                          aria-label="Launch AI Coding CLI"
                                          aria-expanded={
                                            group.id === activeAgentWorkspaceGroupId && agentPresetMenuOpen
                                          }
                                        >
                                          <Plus className="size-3.5" />
                                        </Button>
                                        {group.id === activeAgentWorkspaceGroupId ? agentPresetMenu : null}
                                        {agentWorkspaceGroupsForRender.length > 1 ? (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            className="terminal-tab-create"
                                            onClick={() => handleCloseAgentWorkspaceGroup(group.id)}
                                            aria-label="Close AI Coding CLI group"
                                          >
                                            <X className="size-3.5" />
                                          </Button>
                                        ) : null}
                                      </div>
                                    </div>
                                    <div className="workspace-group-empty-state">
                                      <div className="workspace-group-empty-title">Empty AI Coding CLI pane</div>
                                      <div className="workspace-group-empty-description">
                                        Launch a preset into this split.
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </ResizablePanel>
                            {groupIndex < agentWorkspaceGroupsForRender.length - 1 ? (
                              <ResizableHandle withHandle className="workspace-split-handle" />
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </ResizablePanelGroup>
                  ) : (
                    <div className="terminal-shell terminal-shell-empty">
                      <div className="terminal-tabs-bar terminal-tabs-bar-empty">
                        <div className="terminal-tabs-empty-label">Choose an AI Coding CLI</div>
                        <div
                          className="terminal-tabs-actions agent-preset-menu-anchor"
                          ref={agentPresetMenuRef}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="terminal-tab-create"
                            onClick={() => setAgentPresetMenuOpen((openState) => !openState)}
                            aria-label="Launch AI Coding CLI"
                            aria-expanded={agentPresetMenuOpen}
                          >
                            <Plus className="size-3.5" />
                          </Button>
                          {agentPresetMenu}
                        </div>
                      </div>
                      <div className="terminal-stage">
                        <AgentPresetLauncher onSelectPreset={handleCreateAgentTerminal} />
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className="workspace-panel workspace-panel-terminal"
                  data-active={activeWorkspace === "terminal" ? "true" : undefined}
                >
                  {nativeTerminalTabs.length > 0 ? (
                    <ResizablePanelGroup orientation="horizontal" className="workspace-split-layout">
                      {nativeTerminalGroupsForRender.map((group, groupIndex) => {
                        const activeGroupTab =
                          group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0] ?? null;
                        const groupPanelTabs = nativeTerminalTabs.filter((tab) =>
                          group.tabIds.includes(tab.id)
                        );

                        return (
                          <Fragment key={group.id}>
                            <ResizablePanel
                              defaultSize={100 / nativeTerminalGroupsForRender.length}
                              minSize={20}
                              className="workspace-split-panel"
                            >
                              <div
                                className="workspace-split-group"
                                data-active={group.id === activeNativeTerminalGroupId ? "true" : undefined}
                                onMouseDown={() => setActiveNativeTerminalGroupId(group.id)}
                              >
                                {activeGroupTab ? (
                                  <Tabs
                                    value={activeGroupTab.id}
                                    onValueChange={(tabId) => {
                                      handleActivateNativeTerminalTab(group.id, tabId);
                                    }}
                                    className="terminal-shell terminal-group-shell"
                                  >
                                    <div className="terminal-tabs-bar">
                                      <ScrollArea
                                        className="terminal-tabs-scroll min-w-0 flex-1"
                                        onWheel={handleTabsWheel}
                                      >
                                        <TabsList
                                          variant="line"
                                          className="terminal-tabs-list min-w-max rounded-none border-0 bg-transparent p-0"
                                        >
                                          {group.tabs.map((tab) => (
                                            <Tooltip key={tab.id}>
                                              <TooltipTrigger
                                                render={
                                                  <TabsTrigger
                                                    value={tab.id}
                                                    className="terminal-tab group !flex-none justify-start gap-1.5 rounded-none border-0 px-2.5 py-0.5 after:hidden"
                                                    data-draggable="true"
                                                    data-native-terminal-group-id={group.id}
                                                    data-native-terminal-tab-id={tab.id}
                                                    data-dragging={
                                                      draggedNativeTerminalTab?.groupId === group.id &&
                                                      draggedNativeTerminalTab?.tabId === tab.id
                                                        ? "true"
                                                        : undefined
                                                    }
                                                    data-drop-target={
                                                      nativeTerminalTabDropTarget?.groupId === group.id &&
                                                      nativeTerminalTabDropTarget?.tabId === tab.id
                                                        ? "true"
                                                        : undefined
                                                    }
                                                    data-drop-edge={
                                                      nativeTerminalTabDropTarget?.groupId === group.id &&
                                                      nativeTerminalTabDropTarget?.tabId === tab.id
                                                        ? nativeTerminalTabDropTarget.edge
                                                        : undefined
                                                    }
                                                    onPointerDown={(event) => {
                                                      handleNativeTerminalTabPointerDown(group.id, tab.id, event);
                                                    }}
                                                    onClickCapture={handleNativeTerminalTabClickCapture}
                                                  >
                                                    <SquareTerminal className="size-3.5" />
                                                    <span className="terminal-tab-label truncate">{tab.title}</span>
                                                    <span
                                                      role="button"
                                                      tabIndex={0}
                                                      className="terminal-tab-close"
                                                      onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        handleCloseTerminal(tab.id);
                                                      }}
                                                      onKeyDown={(event) => {
                                                        if (event.key !== "Enter" && event.key !== " ") return;
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        handleCloseTerminal(tab.id);
                                                      }}
                                                      aria-label={`Close ${tab.title}`}
                                                    >
                                                      <X className="size-3.5" />
                                                    </span>
                                                  </TabsTrigger>
                                                }
                                              />
                                              <TooltipContent>{tab.title}</TooltipContent>
                                            </Tooltip>
                                          ))}
                                        </TabsList>
                                        <ScrollBar orientation="horizontal" />
                                      </ScrollArea>
                                      <div className="terminal-tabs-actions">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          className="terminal-tab-create"
                                          onClick={() => handleSplitNativeTerminalGroup(group.id)}
                                          aria-label="Split terminal group"
                                        >
                                          <Columns2 className="size-3.5" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          className="terminal-tab-create"
                                          onClick={() => {
                                            setActiveNativeTerminalGroupId(group.id);
                                            handleCreateTerminal(group.id);
                                          }}
                                          aria-label="New terminal"
                                        >
                                          <Plus className="size-3.5" />
                                        </Button>
                                        {nativeTerminalGroupsForRender.length > 1 ? (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            className="terminal-tab-create"
                                            onClick={() => handleCloseNativeTerminalGroup(group.id)}
                                            aria-label="Close terminal group"
                                          >
                                            <X className="size-3.5" />
                                          </Button>
                                        ) : null}
                                      </div>
                                    </div>

                                    <div className="terminal-stage">
                                      {groupPanelTabs.map((tab) => (
                                        <div
                                          key={tab.id}
                                          className="terminal-tab-panel"
                                          data-active={tab.id === activeGroupTab.id ? "true" : undefined}
                                        >
                                          <TerminalComponent
                                            terminalId={tab.id}
                                            cwd={tab.cwd}
                                            active={
                                              activeWorkspace === "terminal" &&
                                              group.id === activeNativeTerminalGroupId &&
                                              tab.id === activeGroupTab.id
                                            }
                                            defaultTitle={tab.defaultTitle}
                                            onTitleChange={(title) => handleTerminalTitleChange(tab.id, title)}
                                            canSendSelectionToClaude={canAddClaudeContext}
                                            onSendSelectionToClaude={(selection) =>
                                              handleSendTerminalSelectionToClaude(selection, tab.id)
                                            }
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  </Tabs>
                                ) : (
                                  <div className="terminal-shell terminal-group-shell">
                                    <div className="terminal-tabs-bar">
                                      <div className="terminal-tabs-empty-label">Empty split</div>
                                      <div className="terminal-tabs-actions">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          className="terminal-tab-create"
                                          onClick={() => handleSplitNativeTerminalGroup(group.id)}
                                          aria-label="Split terminal group"
                                        >
                                          <Columns2 className="size-3.5" />
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          className="terminal-tab-create"
                                          onClick={() => {
                                            setActiveNativeTerminalGroupId(group.id);
                                            handleCreateTerminal(group.id);
                                          }}
                                          aria-label="New terminal"
                                        >
                                          <Plus className="size-3.5" />
                                        </Button>
                                        {nativeTerminalGroupsForRender.length > 1 ? (
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-xs"
                                            className="terminal-tab-create"
                                            onClick={() => handleCloseNativeTerminalGroup(group.id)}
                                            aria-label="Close terminal group"
                                          >
                                            <X className="size-3.5" />
                                          </Button>
                                        ) : null}
                                      </div>
                                    </div>
                                    <div className="workspace-group-empty-state">
                                      <div className="workspace-group-empty-title">Empty terminal pane</div>
                                      <div className="workspace-group-empty-description">
                                        Create a terminal in this split.
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </ResizablePanel>
                            {groupIndex < nativeTerminalGroupsForRender.length - 1 ? (
                              <ResizableHandle withHandle className="workspace-split-handle" />
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </ResizablePanelGroup>
                  ) : (
                    <div className="terminal-shell terminal-shell-empty">
                      <div className="terminal-tabs-bar terminal-tabs-bar-empty">
                        <div className="terminal-tabs-empty-label">No terminal yet</div>
                        <div className="terminal-tabs-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="terminal-tab-create"
                            onClick={() => handleCreateTerminal()}
                            aria-label="New terminal"
                          >
                            <Plus className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="terminal-stage">
                        <WorkspaceEmptyState
                          visual={<SquareTerminal className="workspace-empty-icon" />}
                          title="Workspace ready"
                          description="Open a terminal only when you need one. Keep the canvas clean until there is actual work to run."
                          meta={workspaceDisplayPath ? `Workspace: ${workspaceDisplayPath}` : undefined}
                          actions={[
                            {
                              icon: <SquareTerminal className="size-4" />,
                              label: "New Terminal",
                              hint: "create",
                              onClick: handleCreateTerminal,
                              emphasis: true,
                            },
                          ]}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className="workspace-panel workspace-panel-editor"
                  data-active={activeWorkspace === "editor" ? "true" : undefined}
                >
                  <div className="code-workspace">
                    <div className="code-workspace-inner">
                      {editorLayoutMode === "split" && editorWorkspaceGroupsForRender.length > 0 ? (
                        <ResizablePanelGroup orientation="horizontal" className="workspace-split-layout">
                          {editorWorkspaceGroupsForRender.map((group, groupIndex) => {
                            const activeGroupTab =
                              group.tabs.find((tab) => tab.id === group.activeTabId) ?? group.tabs[0] ?? null;
                            const activeGroupMode =
                              activeGroupTab && isPreviewablePath(activeGroupTab.path)
                                ? supportsCodeViewForPath(activeGroupTab.path)
                                  ? (editorViewModes[activeGroupTab.id] ?? "preview")
                                  : "preview"
                                : "code";

                            return (
                              <Fragment key={group.id}>
                                <ResizablePanel
                                  defaultSize={100 / editorWorkspaceGroupsForRender.length}
                                  minSize={22}
                                  className="workspace-split-panel"
                                >
                                  <div
                                    className="workspace-split-group"
                                    data-active={group.id === activeEditorWorkspaceGroupId ? "true" : undefined}
                                    onMouseDown={() => {
                                      setActiveEditorWorkspaceGroupId(group.id);
                                      setActiveTabId(activeGroupTab?.id ?? null);
                                    }}
                                  >
                                    {activeGroupTab ? (
                                      <Tabs
                                        value={activeGroupTab.id}
                                        onValueChange={(tabId) => {
                                          handleActivateEditorWorkspaceTab(group.id, tabId);
                                        }}
                                        className="flex h-full min-h-0 w-full flex-1 flex-col gap-0"
                                      >
                                        <div className="editor-header">
                                          <div className="code-tabs-bar">
                                            <ScrollArea
                                              className="code-tabs-scroll min-w-0 flex-1"
                                              onWheel={handleTabsWheel}
                                            >
                                              <TabsList
                                                variant="line"
                                                className="code-tabs-list min-w-max rounded-none border-0 bg-transparent p-0"
                                              >
                                                {group.tabs.map((tab) => {
                                                  const isDirty = tab.content !== tab.savedContent;
                                                  const tabLabel = getTabName(tab.path);
                                                  return (
                                                    <Tooltip key={`${group.id}:${tab.id}`}>
                                                      <TooltipTrigger
                                                        render={
                                                          <TabsTrigger
                                                            value={tab.id}
                                                            className="code-tab group !flex-none justify-start gap-1.5 rounded-none border-0 px-2.5 py-0.5 after:hidden"
                                                            data-draggable="true"
                                                            data-editor-group-id={group.id}
                                                            data-editor-tab-id={tab.id}
                                                            data-dragging={
                                                              draggedEditorTab?.groupId === group.id &&
                                                              draggedEditorTab?.tabId === tab.id
                                                                ? "true"
                                                                : undefined
                                                            }
                                                            data-drop-target={
                                                              editorTabDropTarget?.groupId === group.id &&
                                                              editorTabDropTarget?.tabId === tab.id
                                                                ? "true"
                                                                : undefined
                                                            }
                                                            data-drop-edge={
                                                              editorTabDropTarget?.groupId === group.id &&
                                                              editorTabDropTarget?.tabId === tab.id
                                                                ? editorTabDropTarget.edge
                                                                : undefined
                                                            }
                                                            onPointerDown={(event) => {
                                                              handleEditorTabPointerDown(group.id, tab.id, event);
                                                            }}
                                                            onClickCapture={handleEditorTabClickCapture}
                                                          >
                                                            <EditorFileIcon path={tab.path} />
                                                            {isDirty ? (
                                                              <Circle className="size-2 fill-current stroke-none text-cyan-300" />
                                                            ) : null}
                                                            <span className="code-tab-label truncate">{tabLabel}</span>
                                                            <span
                                                              role="button"
                                                              tabIndex={0}
                                                              className="code-tab-close"
                                                              onClick={(event) => {
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                                handleCloseTab(tab.id, group.id);
                                                              }}
                                                              onKeyDown={(event) => {
                                                                if (event.key !== "Enter" && event.key !== " ") return;
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                                handleCloseTab(tab.id, group.id);
                                                              }}
                                                              aria-label={`Close ${tabLabel}`}
                                                            >
                                                              <X className="size-3.5" />
                                                            </span>
                                                          </TabsTrigger>
                                                        }
                                                      />
                                                      <TooltipContent>{tab.path}</TooltipContent>
                                                    </Tooltip>
                                                  );
                                                })}
                                              </TabsList>
                                              <ScrollBar orientation="horizontal" />
                                            </ScrollArea>
                                            <div className="code-workspace-tabs-actions">
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                className="code-workspace-close"
                                                onClick={() => handleSplitEditorWorkspaceGroup(group.id)}
                                                aria-label="Split editor group"
                                              >
                                                <Columns2 className="size-3.5" />
                                              </Button>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                className="code-workspace-close"
                                                onClick={handleCloseAllEditorTabs}
                                                aria-label="Close all editor tabs"
                                              >
                                                <X className="size-3.5" />
                                              </Button>
                                            </div>
                                          </div>
                                          <ActivePathBar
                                            path={activeGroupTab.path}
                                            previewKind={getPreviewKind(activeGroupTab.path)}
                                            supportsCodeView={supportsCodeViewForPath(activeGroupTab.path)}
                                            mode={activeGroupMode}
                                            onModeChange={(mode) => {
                                              handleSetEditorViewMode(activeGroupTab.id, mode);
                                            }}
                                          />
                                        </div>
                                        <div className="editor-content">
                                          <CodeEditor
                                            path={activeGroupTab.path}
                                            workspacePath={workspacePath}
                                            content={activeGroupTab.content}
                                            dirty={activeGroupTab.content !== activeGroupTab.savedContent}
                                            mode={activeGroupMode}
                                            canAddSelectionToClaude={canAddClaudeContext}
                                            onAddSelectionToClaude={handleAddClaudeSelection}
                                            onSelectionChange={(_path, selection) => {
                                              handleEditorSelectionChange(group.id, activeGroupTab.id, selection);
                                            }}
                                            onChange={handleChange}
                                            onSave={handleSave}
                                          />
                                        </div>
                                      </Tabs>
                                    ) : (
                                      <div className="terminal-shell terminal-group-shell">
                                        <div className="code-tabs-bar">
                                          <div className="terminal-tabs-empty-label">Empty split</div>
                                          <div className="code-workspace-tabs-actions">
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon-xs"
                                              className="code-workspace-close"
                                              onClick={() => handleSplitEditorWorkspaceGroup(group.id)}
                                              aria-label="Split editor group"
                                            >
                                              <Columns2 className="size-3.5" />
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon-xs"
                                              className="code-workspace-close"
                                              onClick={handleCloseAllEditorTabs}
                                              aria-label="Close all editor tabs"
                                            >
                                              <X className="size-3.5" />
                                            </Button>
                                          </div>
                                        </div>
                                        <div className="workspace-group-empty-state">
                                          <div className="workspace-group-empty-title">Empty editor pane</div>
                                          <div className="workspace-group-empty-description">
                                            Open a file from the Files panel into this split.
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </ResizablePanel>
                                {groupIndex < editorWorkspaceGroupsForRender.length - 1 ? (
                                  <ResizableHandle withHandle className="workspace-split-handle" />
                                ) : null}
                              </Fragment>
                            );
                          })}
                        </ResizablePanelGroup>
                      ) : activeTab ? (
                        <Tabs
                          value={activeTab.id}
                          onValueChange={setActiveTabId}
                          className="flex h-full min-h-0 w-full flex-1 flex-col gap-0"
                        >
                          <div className="editor-header">
                            <div className="code-tabs-bar">
                              <ScrollArea className="code-tabs-scroll min-w-0 flex-1" onWheel={handleTabsWheel}>
                                <TabsList
                                  variant="line"
                                  className="code-tabs-list min-w-max rounded-none border-0 bg-transparent p-0"
                                >
                                  {openTabs.map((tab) => {
                                    const isDirty = tab.content !== tab.savedContent;
                                    const tabLabel = getTabName(tab.path);
                                    return (
                                      <Tooltip key={tab.id}>
                                        <TooltipTrigger
                                          render={
                                            <TabsTrigger
                                              value={tab.id}
                                              className="code-tab group !flex-none justify-start gap-1.5 rounded-none border-0 px-2.5 py-0.5 after:hidden"
                                              data-draggable="true"
                                              data-editor-tab-id={tab.id}
                                              data-dragging={
                                                draggedEditorTab?.groupId === null &&
                                                draggedEditorTab?.tabId === tab.id
                                                  ? "true"
                                                  : undefined
                                              }
                                              data-drop-target={
                                                editorTabDropTarget?.groupId === null &&
                                                editorTabDropTarget?.tabId === tab.id
                                                  ? "true"
                                                  : undefined
                                              }
                                              data-drop-edge={
                                                editorTabDropTarget?.groupId === null &&
                                                editorTabDropTarget?.tabId === tab.id
                                                  ? editorTabDropTarget.edge
                                                  : undefined
                                              }
                                              onPointerDown={(event) => {
                                                handleEditorTabPointerDown(null, tab.id, event);
                                              }}
                                              onClickCapture={handleEditorTabClickCapture}
                                            >
                                              <EditorFileIcon path={tab.path} />
                                              {isDirty ? (
                                                <Circle className="size-2 fill-current stroke-none text-cyan-300" />
                                              ) : null}
                                              <span className="code-tab-label truncate">{tabLabel}</span>
                                              <span
                                                role="button"
                                                tabIndex={0}
                                                className="code-tab-close"
                                                onClick={(event) => {
                                                  event.preventDefault();
                                                  event.stopPropagation();
                                                  handleCloseTab(tab.id);
                                                }}
                                                onKeyDown={(event) => {
                                                  if (event.key !== "Enter" && event.key !== " ") return;
                                                  event.preventDefault();
                                                  event.stopPropagation();
                                                  handleCloseTab(tab.id);
                                                }}
                                                aria-label={`Close ${tabLabel}`}
                                              >
                                                <X className="size-3.5" />
                                              </span>
                                            </TabsTrigger>
                                          }
                                        />
                                        <TooltipContent>{tab.path}</TooltipContent>
                                      </Tooltip>
                                    );
                                  })}
                                </TabsList>
                                <ScrollBar orientation="horizontal" />
                              </ScrollArea>
                              <div className="code-workspace-tabs-actions">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  className="code-workspace-close"
                                  onClick={() => handleSplitEditorWorkspaceGroup()}
                                  aria-label="Split editor group"
                                >
                                  <Columns2 className="size-3.5" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  className="code-workspace-close"
                                  onClick={handleCloseAllEditorTabs}
                                  aria-label="Close all editor tabs"
                                >
                                  <X className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                            <ActivePathBar
                              path={activeTab.path}
                              previewKind={getPreviewKind(activeTab.path)}
                              supportsCodeView={supportsCodeViewForPath(activeTab.path)}
                              mode={activeEditorMode}
                              onModeChange={(mode) => {
                                handleSetEditorViewMode(activeTab.id, mode);
                              }}
                            />
                          </div>
                          <div className="editor-content">
                            <CodeEditor
                              path={activeTab.path}
                              workspacePath={workspacePath}
                              content={activeTab.content}
                              dirty={activeTab.content !== activeTab.savedContent}
                              mode={activeEditorMode}
                              canAddSelectionToClaude={canAddClaudeContext}
                              onAddSelectionToClaude={handleAddClaudeSelection}
                              onSelectionChange={(_path, selection) => {
                                handleEditorSelectionChange(null, activeTab.id, selection);
                              }}
                              onChange={handleChange}
                              onSave={handleSave}
                            />
                          </div>
                        </Tabs>
                      ) : (
                        <div className="terminal-shell terminal-shell-empty">
                          <div className="terminal-tabs-bar terminal-tabs-bar-empty">
                            <div className="terminal-tabs-empty-label">No file open yet</div>
                          </div>
                          <div className="terminal-stage">
                            <WorkspaceEmptyState
                              visual={<FolderOpen className="workspace-empty-icon" />}
                              title="Editor is empty"
                              description="Choose a file from the Files panel when you want to edit. Until then, this space stays quiet and focused."
                              meta={workspaceDisplayPath ? `Workspace: ${workspaceDisplayPath}` : undefined}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  className="workspace-panel workspace-panel-diff"
                  data-active={activeWorkspace === "diff" ? "true" : undefined}
                >
                  <div className="diff-workspace">
                    <div className="diff-workspace-inner">
                      {activeDiffTab ? (
                        <Tabs
                          value={activeDiffTab.id}
                          onValueChange={setActiveDiffTabId}
                          className="flex h-full min-h-0 flex-col gap-0"
                        >
                          <div className="editor-header">
                            <div className="diff-tabs-bar">
                              <ScrollArea
                                className="diff-tabs-scroll min-w-0 flex-1"
                                onWheel={handleTabsWheel}
                              >
                                <TabsList
                                  variant="line"
                                  className="diff-tabs-list min-w-max rounded-none border-0 bg-transparent p-0"
                                >
                                  {diffTabs.map((tab) => {
                                    const tabLabel =
                                      tab.kind === "all"
                                        ? `All Changes (${totalChangedFiles} files)`
                                        : getDiffTabLabel(tab.file, tab.category);
                                    const tooltipLabel =
                                      tab.kind === "all"
                                        ? "Open all changes"
                                        : `${tab.file.path} • ${getDiffSideLabels(tab.file, tab.category).tabSource}`;
                                    return (
                                      <Tooltip key={tab.id}>
                                        <TooltipTrigger
                                          render={
                                            <TabsTrigger
                                              value={tab.id}
                                              className="diff-tab group !flex-none justify-start gap-1.5 rounded-none border-0 px-2.5 py-0.5 after:hidden"
                                              data-draggable="true"
                                              data-diff-tab-id={tab.id}
                                              data-dragging={
                                                draggedDiffTab?.tabId === tab.id ? "true" : undefined
                                              }
                                              data-drop-target={
                                                diffTabDropTarget?.tabId === tab.id ? "true" : undefined
                                              }
                                              data-drop-edge={
                                                diffTabDropTarget?.tabId === tab.id
                                                  ? diffTabDropTarget.edge
                                                  : undefined
                                              }
                                              onPointerDown={(event) => handleDiffTabPointerDown(tab.id, event)}
                                              onClickCapture={handleDiffTabClickCapture}
                                            >
                                              {tab.kind === "all" ? (
                                                <GitCompareArrows className="editor-tab-icon-svg" />
                                              ) : (
                                                <EditorFileIcon path={tab.file.path} />
                                              )}
                                              <span className="diff-tab-label truncate">{tabLabel}</span>
                                              {diffDirtyState[tab.id] ? (
                                                <span className="diff-tab-dirty-indicator" aria-hidden />
                                              ) : null}
                                              <span
                                                role="button"
                                                tabIndex={0}
                                                className="diff-tab-close"
                                                onClick={(event) => {
                                                  event.preventDefault();
                                                  event.stopPropagation();
                                                  handleCloseDiffTab(tab.id);
                                                }}
                                                onKeyDown={(event) => {
                                                  if (event.key !== "Enter" && event.key !== " ") return;
                                                  event.preventDefault();
                                                  event.stopPropagation();
                                                  handleCloseDiffTab(tab.id);
                                                }}
                                                aria-label={`Close ${tabLabel}`}
                                              >
                                                <X className="size-3.5" />
                                              </span>
                                            </TabsTrigger>
                                          }
                                        />
                                        <TooltipContent>{tooltipLabel}</TooltipContent>
                                      </Tooltip>
                                    );
                                  })}
                                </TabsList>
                                <ScrollBar orientation="horizontal" />
                              </ScrollArea>
                              <div className="diff-workspace-tabs-actions">
                                {activeDiffTab?.kind === "all" ? (
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          className="diff-workspace-close"
                                          onClick={() => {
                                            if (allDiffsAreCollapsed) {
                                              setAllDiffsExpandRequest((current) => current + 1);
                                            } else {
                                              setAllDiffsCollapseRequest((current) => current + 1);
                                            }
                                          }}
                                          aria-label={allDiffsAreCollapsed ? "Expand all files" : "Collapse all files"}
                                        >
                                          <FoldVertical className="size-3.5" />
                                        </Button>
                                      }
                                    />
                                    <TooltipContent>
                                      {allDiffsAreCollapsed ? "Expand all files" : "Collapse all files"}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  className="diff-workspace-close"
                                  onClick={handleCloseAllDiffTabs}
                                  aria-label="Close all diff tabs"
                                >
                                  <X className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                            {activeDiffTab.kind === "all" ? null : (
                              <div className="diff-workspace-pathbar">
                                {activeDiffSelection ? (
                                  <>
                                    <div className="diff-workspace-pathbar-main">
                                      <EditorFileIcon path={activeDiffSelection.file.path} />
                                      <span className="diff-workspace-pathbar-path">
                                        {activeDiffSelection.file.oldPath ? `${activeDiffSelection.file.oldPath} → ` : ""}
                                        {activeDiffSelection.file.path}
                                      </span>
                                    </div>
                                    {activeDiffChrome ? (
                                      <div className="diff-workspace-pathbar-meta">
                                        <span className={cn("diff-editor-category", `is-${activeDiffSelection.category}`)}>
                                          {activeDiffChrome.categoryLabel}
                                        </span>
                                        <span className="all-diffs-item-separator">•</span>
                                        <span className={cn("diff-editor-status-code", `is-${activeDiffSelection.file.status}`)}>
                                          {activeDiffChrome.statusCode}
                                        </span>
                                        {activeDiffChrome.editableLabel ? (
                                          <>
                                            <span className="all-diffs-item-separator">•</span>
                                            <span
                                              className="diff-editor-edit-state"
                                              data-dirty={diffDirtyState[activeDiffTab.id] ? "true" : undefined}
                                            >
                                              {activeDiffChrome.editableLabel}
                                            </span>
                                          </>
                                        ) : null}
                                        <span className="all-diffs-item-controls">
                                          <span className="diff-editor-chunk-count">
                                            {activeDiffChrome.currentChunkNumber}/{activeDiffChrome.chunkCount || 0}
                                          </span>
                                          <Tooltip>
                                            <TooltipTrigger
                                              render={
                                                <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="icon-xs"
                                                  className="diff-editor-action"
                                                  disabled={activeDiffChrome.chunkCount === 0}
                                                  onClick={activeDiffChrome.navigatePrevious}
                                                >
                                                  <ChevronUp className="size-3.5" />
                                                </Button>
                                              }
                                            />
                                            <TooltipContent>Previous change</TooltipContent>
                                          </Tooltip>
                                          <Tooltip>
                                            <TooltipTrigger
                                              render={
                                                <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="icon-xs"
                                                  className="diff-editor-action"
                                                  disabled={activeDiffChrome.chunkCount === 0}
                                                  onClick={activeDiffChrome.navigateNext}
                                                >
                                                  <ChevronDown className="size-3.5" />
                                                </Button>
                                              }
                                            />
                                            <TooltipContent>Next change</TooltipContent>
                                          </Tooltip>
                                          <Tooltip>
                                            <TooltipTrigger
                                              render={
                                                <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="icon-xs"
                                                  className="diff-editor-action"
                                                  data-active="true"
                                                  onClick={activeDiffChrome.toggleMode}
                                                >
                                                  {activeDiffChrome.mode === "inline" ? (
                                                    <List className="size-3.5" />
                                                  ) : (
                                                    <Columns2 className="size-3.5" />
                                                  )}
                                                </Button>
                                              }
                                            />
                                            <TooltipContent>
                                              {activeDiffChrome.mode === "inline"
                                                ? "Switch to side by side diff"
                                                : "Switch to inline diff"}
                                            </TooltipContent>
                                          </Tooltip>
                                          <Tooltip>
                                            <TooltipTrigger
                                              render={
                                                <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="icon-xs"
                                                  className="diff-editor-action"
                                                  data-active={activeDiffChrome.hideUnchanged ? "true" : undefined}
                                                  onClick={activeDiffChrome.toggleUnchanged}
                                                >
                                                  <FoldVertical className="size-3.5" />
                                                </Button>
                                              }
                                            />
                                            <TooltipContent>
                                              {activeDiffChrome.hideUnchanged
                                                ? "Show unchanged lines"
                                                : "Hide unchanged lines"}
                                            </TooltipContent>
                                          </Tooltip>
                                        </span>
                                      </div>
                                    ) : null}
                                  </>
                                ) : (
                                <>
                                  <div className="diff-workspace-pathbar-main">
                                    <EditorFileIcon path={activeDiffTab.file.path} />
                                    <span className="diff-workspace-pathbar-path">
                                      {activeDiffTab.file.oldPath ? `${activeDiffTab.file.oldPath} → ` : ""}
                                      {activeDiffTab.file.path}
                                    </span>
                                  </div>
                                </>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="editor-content">
                            {activeDiffTab.kind === "all" ? (
                              <AllDiffsView
                                workspacePath={workspacePath!}
                                stagedFiles={git.status?.staged ?? []}
                                unstagedFiles={git.combinedChanges}
                                collapseAllRequest={allDiffsCollapseRequest}
                                expandAllRequest={allDiffsExpandRequest}
                                onOpenFile={handleOpenDiffFile}
                                onStageFile={git.stageFile}
                                onUnstageFile={git.unstageFile}
                                onDiscardFile={git.discardFile}
                                onSaved={() => git.refresh({ silent: true })}
                                onAllCollapsedChange={setAllDiffsAreCollapsed}
                                onDirtyChange={(dirty) => {
                                  setDiffTabDirty(activeDiffTab.id, dirty);
                                }}
                              />
                            ) : (
                              <DiffEditor
                                workspacePath={workspacePath!}
                                file={activeDiffTab.file}
                                category={activeDiffTab.category}
                                refreshToken={git.refreshToken}
                                chromePlacement="external"
                                onOpenFile={handleOpenDiffFile}
                                onStageFile={git.stageFile}
                                onUnstageFile={git.unstageFile}
                                onDiscardFile={git.discardFile}
                                onSaved={() => git.refresh({ silent: true })}
                                onChromeChange={(chrome) => {
                                  handleDiffChromeChange(activeDiffTab.id, chrome);
                                }}
                                onDirtyChange={(dirty) => {
                                  setDiffTabDirty(activeDiffTab.id, dirty);
                                }}
                              />
                            )}
                          </div>
                        </Tabs>
                      ) : (
                        <div className="terminal-shell terminal-shell-empty">
                          <div className="terminal-tabs-bar terminal-tabs-bar-empty">
                            <div className="terminal-tabs-empty-label">No diff yet</div>
                          </div>
                          <div className="terminal-stage">
                            <WorkspaceEmptyState
                              visual={<GitCompareArrows className="workspace-empty-icon" />}
                              title="Diff workspace is empty"
                              description="Open a changed file or use Open Changes from Source Control when you want a repository-level diff view."
                              meta={workspaceDisplayPath ? `Workspace: ${workspaceDisplayPath}` : undefined}
                              actions={[
                                {
                                  icon: <GitCompareArrows className="size-4" />,
                                  label: "Open Changes",
                                  hint: "review",
                                  onClick: handleOpenAllDiffs,
                                  emphasis: true,
                                },
                              ]}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </TooltipProvider>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
