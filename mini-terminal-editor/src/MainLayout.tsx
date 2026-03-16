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
import { CodeEditor, isPreviewablePath } from "./CodeEditor";
import { AGENT_PRESETS, type AgentPreset, type AgentPresetId } from "./agentPresets";
import { useFileIconUrl } from "./fileIcons";
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
import { open } from "@tauri-apps/plugin-dialog";
import { type MouseEvent, type ReactNode, type WheelEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  GitCompareArrows,
  FileText,
  FileCode2,
  FolderOpen,
  FolderClosed,
  PanelLeft,
  Plus,
  Sparkles,
  SquareTerminal,
  X,
} from "lucide-react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { useGitChanges } from "./useGitChanges";
import type { GitChangedFile, GitDiffCategory } from "./gitTypes";
import { DiffEditor } from "./DiffEditor";
import { AllDiffsView } from "./AllDiffsView";

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

function formatWorkspacePath(path: string | null) {
  if (!path) return "";
  return path.replace(/^\/Users\/[^/]+/, "~");
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
  previewable,
  mode,
  onModeChange,
}: {
  path: string;
  previewable?: boolean;
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
      {previewable ? (
        <div className="editor-view-switch" data-tauri-drag-region="false">
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
          <h2 className="workspace-empty-title">Choose an AI agent</h2>
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
  const titlebarDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const titlebarDraggingRef = useRef(false);
  const terminalCounterRef = useRef(1);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeNativeTerminalId, setActiveNativeTerminalId] = useState<string | null>(null);
  const [activeAgentTerminalId, setActiveAgentTerminalId] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<"agent" | "terminal" | "editor" | "diff">("agent");
  const [openTabs, setOpenTabs] = useState<FileEditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [diffTabs, setDiffTabs] = useState<DiffTab[]>([]);
  const [activeDiffTabId, setActiveDiffTabId] = useState<string | null>(null);
  const [editorViewModes, setEditorViewModes] = useState<Record<string, "code" | "preview">>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"changes" | "files">("files");
  const [agentPresetMenuOpen, setAgentPresetMenuOpen] = useState(false);
  const git = useGitChanges({
    workspacePath,
    active: Boolean(workspacePath) && activeSidebarTab === "changes",
  });

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
      if (target && agentPresetMenuRef.current?.contains(target)) return;
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
    setActiveTabId(tabId);
    setActiveWorkspace("editor");
  }, []);

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
    setActiveDiffTabId(allDiffTabId);
    setActiveWorkspace("diff");
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

  const handleCloseTab = (tabId: string) => {
    setOpenTabs((currentTabs) => {
      const tabIndex = currentTabs.findIndex((tab) => tab.id === tabId);
      if (tabIndex === -1) return currentTabs;

      const targetTab = currentTabs[tabIndex];
      const isDirty = targetTab.content !== targetTab.savedContent;
      const targetPath = targetTab.path;
      if (isDirty && !window.confirm(`"${getTabName(targetPath)}" 尚未保存，确认关闭？`)) {
        return currentTabs;
      }

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
      if (nextTabs.length === 0) {
        setActiveWorkspace(diffTabs.length > 0 ? "diff" : "agent");
      }
      return nextTabs;
    });
  };

  const handleCloseDiffTab = useCallback((tabId: string) => {
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
  }, [openTabs.length]);

  const handleCreateTerminal = useCallback(() => {
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
    setActiveNativeTerminalId(id);
    setActiveWorkspace("terminal");
  }, [workspacePath]);

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
      setActiveAgentTerminalId(id);
      setActiveWorkspace("agent");
      setAgentPresetMenuOpen(false);
    },
    [workspacePath]
  );

  const handleCloseTerminal = useCallback((terminalId: string) => {
    setTerminalTabs((currentTabs) => {
      const targetTab = currentTabs.find((tab) => tab.id === terminalId);
      if (!targetTab) return currentTabs;

      const nextTabs = currentTabs.filter((tab) => tab.id !== terminalId);
      const sameKindTabs = currentTabs.filter((tab) => tab.kind === targetTab.kind);
      const sameKindIndex = sameKindTabs.findIndex((tab) => tab.id === terminalId);
      const nextSameKindTabs = nextTabs.filter((tab) => tab.kind === targetTab.kind);

      if (targetTab.kind === "native") {
        setActiveNativeTerminalId((currentActiveId) => {
          if (currentActiveId !== terminalId) return currentActiveId;
          if (nextSameKindTabs.length === 0) return null;
          return (
            nextSameKindTabs[Math.max(0, sameKindIndex - 1)]?.id ?? nextSameKindTabs[0].id
          );
        });
      } else {
        setActiveAgentTerminalId((currentActiveId) => {
          if (currentActiveId !== terminalId) return currentActiveId;
          if (nextSameKindTabs.length === 0) return null;
          return (
            nextSameKindTabs[Math.max(0, sameKindIndex - 1)]?.id ?? nextSameKindTabs[0].id
          );
        });
      }

      return nextTabs;
    });
  }, []);

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
      setActiveNativeTerminalId(null);
      setActiveAgentTerminalId(null);
      setOpenTabs([]);
      setActiveTabId(null);
      setDiffTabs([]);
      setActiveDiffTabId(null);
      setEditorViewModes({});
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

  useEffect(() => {
    if (openTabs.length === 0) {
      if (activeTabId !== null) {
        setActiveTabId(null);
      }
      return;
    }

    if (!activeTabId || !openTabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(openTabs[0].id);
    }
  }, [activeTabId, openTabs]);

  useEffect(() => {
    if (!workspacePath) return;

    if (git.capability?.status && git.capability.status !== "available") {
      setDiffTabs([]);
      setActiveDiffTabId(null);
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
    const nativeTabs = terminalTabs.filter((tab) => tab.kind === "native");
    if (nativeTabs.length === 0) {
      if (activeNativeTerminalId !== null) {
        setActiveNativeTerminalId(null);
      }
      return;
    }

    if (
      !activeNativeTerminalId ||
      !nativeTabs.some((tab) => tab.id === activeNativeTerminalId)
    ) {
      setActiveNativeTerminalId(nativeTabs[0].id);
    }
  }, [activeNativeTerminalId, terminalTabs]);

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
  const activeDiffTab = diffTabs.find((tab) => tab.id === activeDiffTabId) ?? null;
  const activeEditorMode =
    activeTab && isPreviewablePath(activeTab.path)
      ? (editorViewModes[activeTab.id] ?? "preview")
      : "code";
  const agentTerminalTabs = terminalTabs.filter((tab) => tab.kind === "agent");
  const nativeTerminalTabs = terminalTabs.filter((tab) => tab.kind === "native");
  const totalChangedFiles = (git.status?.staged.length ?? 0) + git.combinedChanges.length;
  const workspaceDisplayPath = formatWorkspacePath(workspacePath);
  const agentPresetMenu = agentPresetMenuOpen ? (
    <div className="agent-preset-menu" role="menu" aria-label="AI Agent presets">
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
    </div>
  ) : null;

  return (
    <div className="main-layout-shell">
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
            aria-label={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
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
        </div>
        <div className="app-titlebar-drag-region" />
      </div>

      <ResizablePanelGroup
        orientation="horizontal"
        className="main-layout"
      >
        <ResizablePanel
          defaultSize={20}
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
              onOpenDiff={handleOpenDiff}
              onOpenAllDiffs={handleOpenAllDiffs}
              git={git}
              activeSidebarTab={activeSidebarTab}
              onSidebarTabChange={setActiveSidebarTab}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={80} minSize={30} className="flex min-h-0 flex-col">
          <div className="main-layout-terminal">
            <TooltipProvider delay={250}>
              <div className="workspace-manager-bar">
                <div className="workspace-manager-list" role="tablist" aria-label="工作区切换">
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
                    <span className="workspace-manager-title">AI Agent</span>
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
                  {agentTerminalTabs.length > 0 && activeAgentTerminalId ? (
                    <Tabs
                      value={activeAgentTerminalId}
                      onValueChange={setActiveAgentTerminalId}
                      className="terminal-shell"
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
                            {agentTerminalTabs.map((tab) => (
                              <Tooltip key={tab.id}>
                                <TooltipTrigger
                                  render={
                                    <TabsTrigger
                                      value={tab.id}
                                      className="terminal-tab group !flex-none justify-start gap-1.5 rounded-none border-0 px-2.5 py-0.5 after:hidden"
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
                                        aria-label={`关闭 ${tab.title}`}
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
                          ref={agentPresetMenuRef}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="terminal-tab-create"
                            onClick={() => setAgentPresetMenuOpen((openState) => !openState)}
                            aria-label="启动 AI Agent"
                            aria-expanded={agentPresetMenuOpen}
                          >
                            <Plus className="size-3.5" />
                          </Button>
                          {agentPresetMenu}
                        </div>
                      </div>

                      <div className="terminal-stage">
                        {agentTerminalTabs.map((tab) => (
                          <div
                            key={tab.id}
                            className="terminal-tab-panel"
                            data-active={tab.id === activeAgentTerminalId ? "true" : undefined}
                          >
                            <TerminalComponent
                              terminalId={tab.id}
                              cwd={tab.cwd}
                              active={activeWorkspace === "agent" && tab.id === activeAgentTerminalId}
                              defaultTitle={tab.defaultTitle}
                              startupCommands={tab.startupCommands}
                              onTitleChange={(title) => handleTerminalTitleChange(tab.id, title)}
                            />
                          </div>
                        ))}
                      </div>
                    </Tabs>
                  ) : (
                    <div className="terminal-shell terminal-shell-empty">
                      <div className="terminal-tabs-bar terminal-tabs-bar-empty">
                        <div className="terminal-tabs-empty-label">Choose an AI agent</div>
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
                            aria-label="启动 AI Agent"
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
                  {nativeTerminalTabs.length > 0 && activeNativeTerminalId ? (
                    <Tabs
                      value={activeNativeTerminalId}
                      onValueChange={setActiveNativeTerminalId}
                      className="terminal-shell"
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
                            {nativeTerminalTabs.map((tab) => (
                              <Tooltip key={tab.id}>
                                <TooltipTrigger
                                  render={
                                    <TabsTrigger
                                      value={tab.id}
                                      className="terminal-tab group !flex-none justify-start gap-1.5 rounded-none border-0 px-2.5 py-0.5 after:hidden"
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
                                        aria-label={`关闭 ${tab.title}`}
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
                            onClick={handleCreateTerminal}
                            aria-label="新建终端"
                          >
                            <Plus className="size-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="terminal-stage">
                        {nativeTerminalTabs.map((tab) => (
                          <div
                            key={tab.id}
                            className="terminal-tab-panel"
                            data-active={tab.id === activeNativeTerminalId ? "true" : undefined}
                          >
                            <TerminalComponent
                              terminalId={tab.id}
                              cwd={tab.cwd}
                              active={
                                activeWorkspace === "terminal" && tab.id === activeNativeTerminalId
                              }
                              defaultTitle={tab.defaultTitle}
                              onTitleChange={(title) => handleTerminalTitleChange(tab.id, title)}
                            />
                          </div>
                        ))}
                      </div>
                    </Tabs>
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
                            onClick={handleCreateTerminal}
                            aria-label="新建终端"
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
                  <div className="editor-workspace">
                    <div className="editor-workspace-inner">
                      {activeTab ? (
                        <Tabs
                          value={activeTab.id}
                          onValueChange={setActiveTabId}
                          className="flex h-full min-h-0 flex-col gap-0"
                        >
                          <div className="editor-header">
                            <div className="editor-tabs-bar">
                              <ScrollArea
                                className="editor-tabs-scroll min-w-0 flex-1"
                                onWheel={handleTabsWheel}
                              >
                                <TabsList
                                  variant="line"
                                  className="editor-tabs-list min-w-max rounded-none border-0 bg-transparent p-0"
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
                                              className="editor-tab group !flex-none justify-start gap-1.5 rounded-none border-0 px-2.5 py-0.5 after:hidden"
                                            >
                                              <EditorFileIcon path={tab.path} />
                                              {isDirty && (
                                                <Circle className="size-2 fill-current stroke-none text-cyan-300" />
                                              )}
                                              <span className="editor-tab-label truncate">{tabLabel}</span>
                                              <span
                                                role="button"
                                                tabIndex={0}
                                                className="editor-tab-close"
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
                                                aria-label={`关闭 ${tabLabel}`}
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
                              <div className="editor-tabs-actions">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  className="editor-overlay-close"
                                  onClick={() => setActiveWorkspace(diffTabs.length > 0 ? "diff" : "terminal")}
                                  aria-label="关闭编辑区"
                                >
                                  <X className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                            <ActivePathBar
                              path={activeTab.path}
                              previewable={isPreviewablePath(activeTab.path)}
                              mode={activeEditorMode}
                              onModeChange={(mode) => {
                                handleSetEditorViewMode(activeTab.id, mode);
                              }}
                            />
                          </div>
                          <div className="editor-content">
                            <CodeEditor
                              path={activeTab.path}
                              content={activeTab.content}
                              dirty={activeTab.content !== activeTab.savedContent}
                              mode={activeEditorMode}
                              onChange={handleChange}
                              onSave={handleSave}
                            />
                          </div>
                        </Tabs>
                      ) : (
                        <div className="editor-empty-shell">
                          <WorkspaceEmptyState
                            visual={<FolderOpen className="workspace-empty-icon" />}
                            title="Editor is empty"
                            description="Choose a file from the Files panel when you want to edit. Until then, this space stays quiet and focused."
                            meta={workspaceDisplayPath ? `Workspace: ${workspaceDisplayPath}` : undefined}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  className="workspace-panel workspace-panel-diff"
                  data-active={activeWorkspace === "diff" ? "true" : undefined}
                >
                  <div className="editor-workspace diff-workspace">
                    <div className="editor-workspace-inner">
                      {activeDiffTab ? (
                        <Tabs
                          value={activeDiffTab.id}
                          onValueChange={setActiveDiffTabId}
                          className="flex h-full min-h-0 flex-col gap-0"
                        >
                          <div className="editor-header">
                            <div className="editor-tabs-bar">
                              <ScrollArea
                                className="editor-tabs-scroll min-w-0 flex-1"
                                onWheel={handleTabsWheel}
                              >
                                <TabsList
                                  variant="line"
                                  className="editor-tabs-list min-w-max rounded-none border-0 bg-transparent p-0"
                                >
                                  {diffTabs.map((tab) => {
                                    const tabLabel =
                                      tab.kind === "all"
                                        ? `Git: Changes (${totalChangedFiles} files)`
                                        : `${getTabName(tab.file.path)} (Diff)`;
                                    const tooltipLabel =
                                      tab.kind === "all"
                                        ? "Open all changes"
                                        : `${tab.file.path} • ${tab.category}`;
                                    return (
                                      <Tooltip key={tab.id}>
                                        <TooltipTrigger
                                          render={
                                            <TabsTrigger
                                              value={tab.id}
                                              className="editor-tab group !flex-none justify-start gap-1.5 rounded-none border-0 px-2.5 py-0.5 after:hidden"
                                            >
                                              {tab.kind === "all" ? (
                                                <GitCompareArrows className="editor-tab-icon-svg" />
                                              ) : (
                                                <EditorFileIcon path={tab.file.path} />
                                              )}
                                              <span className="editor-tab-label truncate">{tabLabel}</span>
                                              <span
                                                role="button"
                                                tabIndex={0}
                                                className="editor-tab-close"
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
                                                aria-label={`关闭 ${tabLabel}`}
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
                              <div className="editor-tabs-actions">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  className="editor-overlay-close"
                                  onClick={() => setActiveWorkspace(openTabs.length > 0 ? "editor" : "terminal")}
                                  aria-label="关闭 Diff 工作区"
                                >
                                  <X className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                            <div className="diff-workspace-pathbar">
                              {activeDiffTab.kind === "all" ? (
                                <>
                                  <GitCompareArrows className="size-3.5" />
                                  <span>All repository changes</span>
                                </>
                              ) : (
                                <>
                                  <EditorFileIcon path={activeDiffTab.file.path} />
                                  <span>{activeDiffTab.file.oldPath ? `${activeDiffTab.file.oldPath} → ` : ""}{activeDiffTab.file.path}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="editor-content">
                            {activeDiffTab.kind === "all" ? (
                              <AllDiffsView
                                workspacePath={workspacePath!}
                                stagedFiles={git.status?.staged ?? []}
                                unstagedFiles={git.combinedChanges}
                                refreshToken={git.refreshToken}
                              />
                            ) : (
                              <DiffEditor
                                workspacePath={workspacePath!}
                                file={activeDiffTab.file}
                                category={activeDiffTab.category}
                                refreshToken={git.refreshToken}
                              />
                            )}
                          </div>
                        </Tabs>
                      ) : (
                        <div className="editor-empty-shell">
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
