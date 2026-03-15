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
import { open } from "@tauri-apps/plugin-dialog";
import { type ReactNode, type WheelEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  FolderOpen,
  FolderClosed,
  PanelLeft,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import type { PanelImperativeHandle } from "react-resizable-panels";

type EditorTab = {
  path: string;
  content: string;
  savedContent: string;
};

type TerminalTab = {
  id: string;
  title: string;
  defaultTitle: string;
  cwd?: string;
};

function getTabName(path: string) {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
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

function ActivePathBar({ path }: { path: string }) {
  const parts = getTabDir(path);
  const fileName = getTabName(path);

  return (
    <div className="editor-path-bar">
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

export function MainLayout() {
  const { workspacePath, setWorkspacePath } = useWorkspace();
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const terminalCounterRef = useRef(1);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<"terminal" | "editor">("terminal");
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"changes" | "files">("files");

  const handleTabsWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

    const viewport = event.currentTarget.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    );

    if (!viewport || viewport.scrollWidth <= viewport.clientWidth) return;

    viewport.scrollLeft += event.deltaY;
    event.preventDefault();
  }, []);

  const handleOpenFile = useCallback((path: string, content: string) => {
    setOpenTabs((currentTabs) => {
      const existingTab = currentTabs.find((tab) => tab.path === path);
      if (existingTab) return currentTabs;
      return [...currentTabs, { path, content, savedContent: content }];
    });
    setActiveTabPath(path);
    setActiveWorkspace("editor");
  }, []);

  const handleSave = async (path: string, content: string) => {
    await invoke("write_file", {
      payload: { workspacePath, path, content },
    });
    setOpenTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.path === path
          ? { ...tab, content, savedContent: content }
          : tab
      )
    );
  };

  const handleChange = (path: string, content: string) => {
    setOpenTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.path === path ? { ...tab, content } : tab
      )
    );
  };

  const handleCloseTab = (path: string) => {
    setOpenTabs((currentTabs) => {
      const tabIndex = currentTabs.findIndex((tab) => tab.path === path);
      if (tabIndex === -1) return currentTabs;

      const targetTab = currentTabs[tabIndex];
      const isDirty = targetTab.content !== targetTab.savedContent;
      if (isDirty && !window.confirm(`"${getTabName(path)}" 尚未保存，确认关闭？`)) {
        return currentTabs;
      }

      const nextTabs = currentTabs.filter((tab) => tab.path !== path);
      setActiveTabPath((currentActivePath) => {
        if (currentActivePath !== path) return currentActivePath;
        if (nextTabs.length === 0) return null;
        return nextTabs[Math.max(0, tabIndex - 1)]?.path ?? nextTabs[0].path;
      });
      return nextTabs;
    });
  };

  const handleCreateTerminal = useCallback(() => {
    terminalCounterRef.current += 1;
    const id = `term-${terminalCounterRef.current}`;
    const defaultTitle = `Terminal ${terminalCounterRef.current}`;
    const nextTab: TerminalTab = {
      id,
      title: defaultTitle,
      defaultTitle,
      cwd: workspacePath ?? undefined,
    };

    setTerminalTabs((currentTabs) => [...currentTabs, nextTab]);
    setActiveTerminalId(id);
    setActiveWorkspace("terminal");
  }, [workspacePath]);

  const handleCloseTerminal = useCallback((terminalId: string) => {
    setTerminalTabs((currentTabs) => {
      const tabIndex = currentTabs.findIndex((tab) => tab.id === terminalId);
      if (tabIndex === -1) return currentTabs;

      const nextTabs = currentTabs.filter((tab) => tab.id !== terminalId);
      setActiveTerminalId((currentActiveId) => {
        if (currentActiveId !== terminalId) return currentActiveId;
        if (nextTabs.length === 0) return null;
        return nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0].id;
      });
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

    const hasDirtyTabs = openTabs.some((tab) => tab.content !== tab.savedContent);
    const hasOpenContext = terminalTabs.length > 0 || openTabs.length > 0;

    if (hasDirtyTabs) {
      const shouldContinue = window.confirm(
        "Switch project? Unsaved editor changes will be lost and open terminals will be closed."
      );
      if (!shouldContinue) return;
    } else if (hasOpenContext) {
      const shouldContinue = window.confirm(
        "Switch project? Open terminals and editor tabs in the current project will be closed."
      );
      if (!shouldContinue) return;
    }

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
      setActiveTerminalId(null);
      setOpenTabs([]);
      setActiveTabPath(null);
      setActiveWorkspace("terminal");
      setActiveSidebarTab("files");
      setWorkspacePath(nextPath);
    } catch (error) {
      console.error("Failed to switch workspace:", error);
    }
  }, [openTabs, setWorkspacePath, terminalTabs, workspacePath]);

  useEffect(() => {
    if (openTabs.length === 0) {
      if (activeTabPath !== null) {
        setActiveTabPath(null);
      }
      return;
    }

    if (!activeTabPath || !openTabs.some((tab) => tab.path === activeTabPath)) {
      setActiveTabPath(openTabs[0].path);
    }
  }, [activeTabPath, openTabs]);

  useEffect(() => {
    if (terminalTabs.length === 0) {
      if (activeTerminalId !== null) {
        setActiveTerminalId(null);
      }
      return;
    }

    if (!activeTerminalId || !terminalTabs.some((tab) => tab.id === activeTerminalId)) {
      setActiveTerminalId(terminalTabs[0].id);
    }
  }, [activeTerminalId, terminalTabs]);

  const activeTab = openTabs.find((tab) => tab.path === activeTabPath) ?? null;
  const workspaceDisplayPath = formatWorkspacePath(workspacePath);

  return (
    <div className="main-layout-shell">
      <div className="app-titlebar" data-tauri-drag-region>
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
          defaultSize={30}
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
              activeSidebarTab={activeSidebarTab}
              onSidebarTabChange={setActiveSidebarTab}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={70} minSize={30} className="flex min-h-0 flex-col">
          <div className="main-layout-terminal">
            <TooltipProvider delay={250}>
            <div className="workspace-manager-bar">
              <div className="workspace-manager-list" role="tablist" aria-label="工作区切换">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="workspace-manager-switch"
                  data-active={activeWorkspace === "terminal" ? "true" : undefined}
                  onClick={() => setActiveWorkspace("terminal")}
                  aria-pressed={activeWorkspace === "terminal"}
                >
                  <SquareTerminal className="size-3.5" />
                  <span className="workspace-manager-title">Terminal</span>
                  <span className="workspace-manager-count">{terminalTabs.length}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="workspace-manager-switch"
                  data-active={activeWorkspace === "editor" ? "true" : undefined}
                  onClick={() => setActiveWorkspace("editor")}
                  aria-pressed={activeWorkspace === "editor"}
                >
                  <FileText className="size-3.5" />
                  <span className="workspace-manager-title">Editor</span>
                  <span className="workspace-manager-count">{openTabs.length}</span>
                </Button>
              </div>
            </div>

            <div className="workspace-content-stack">
              <div
                className="workspace-panel workspace-panel-terminal"
                data-active={activeWorkspace === "terminal" ? "true" : undefined}
              >
                {terminalTabs.length > 0 && activeTerminalId ? (
                  <Tabs
                    value={activeTerminalId}
                    onValueChange={setActiveTerminalId}
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
                          {terminalTabs.map((tab) => (
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
                      {terminalTabs.map((tab) => (
                        <div
                          key={tab.id}
                          className="terminal-tab-panel"
                          data-active={tab.id === activeTerminalId ? "true" : undefined}
                        >
                          <TerminalComponent
                            terminalId={tab.id}
                            cwd={tab.cwd}
                            active={activeWorkspace === "terminal" && tab.id === activeTerminalId}
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
                        value={activeTab.path}
                        onValueChange={setActiveTabPath}
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
                                  return (
                                    <Tooltip key={tab.path}>
                                      <TooltipTrigger
                                        render={
                                          <TabsTrigger
                                            value={tab.path}
                                            className="editor-tab group !flex-none justify-start gap-1.5 rounded-none border-0 px-2.5 py-0.5 after:hidden"
                                          >
                                            <EditorFileIcon path={tab.path} />
                                            {isDirty && (
                                              <Circle className="size-2 fill-current stroke-none text-cyan-300" />
                                            )}
                                            <span className="editor-tab-label truncate">{getTabName(tab.path)}</span>
                                            <span
                                              role="button"
                                              tabIndex={0}
                                              className="editor-tab-close"
                                              onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                handleCloseTab(tab.path);
                                              }}
                                              onKeyDown={(event) => {
                                                if (event.key !== "Enter" && event.key !== " ") return;
                                                event.preventDefault();
                                                event.stopPropagation();
                                                handleCloseTab(tab.path);
                                              }}
                                              aria-label={`关闭 ${getTabName(tab.path)}`}
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
                                onClick={() => setActiveWorkspace("terminal")}
                                aria-label="切换到终端"
                              >
                                <X className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                          <ActivePathBar path={activeTab.path} />
                        </div>
                        <div className="editor-content">
                          <CodeEditor
                            path={activeTab.path}
                            content={activeTab.content}
                            dirty={activeTab.content !== activeTab.savedContent}
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
            </div>
            </TooltipProvider>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
