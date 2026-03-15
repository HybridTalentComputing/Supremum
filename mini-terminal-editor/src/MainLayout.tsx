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
import { type WheelEvent, useCallback, useRef, useState } from "react";
import { ChevronRight, Circle, FileText, Plus, SquareTerminal, X } from "lucide-react";

type EditorTab = {
  path: string;
  content: string;
  savedContent: string;
};

type TerminalTab = {
  id: string;
  title: string;
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

export function MainLayout() {
  const { workspacePath } = useWorkspace();
  const terminalCounterRef = useRef(1);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([
    {
      id: "term-1",
      title: "Terminal 1",
      cwd: workspacePath ?? undefined,
    },
  ]);
  const [activeTerminalId, setActiveTerminalId] = useState("term-1");
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);

  const handleTabsWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

    const viewport = event.currentTarget.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    );

    if (!viewport || viewport.scrollWidth <= viewport.clientWidth) return;

    viewport.scrollLeft += event.deltaY;
    event.preventDefault();
  }, []);

  const handleOpenFile = (path: string, content: string) => {
    setOpenTabs((currentTabs) => {
      const existingTab = currentTabs.find((tab) => tab.path === path);
      if (existingTab) return currentTabs;
      return [...currentTabs, { path, content, savedContent: content }];
    });
    setActiveTabPath(path);
    setEditorVisible(true);
  };

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
      if (nextTabs.length === 0) {
        setEditorVisible(false);
      }
      return nextTabs;
    });
  };

  const handleCreateTerminal = useCallback(() => {
    terminalCounterRef.current += 1;
    const id = `term-${terminalCounterRef.current}`;
    const nextTab: TerminalTab = {
      id,
      title: `Terminal ${terminalCounterRef.current}`,
      cwd: workspacePath ?? undefined,
    };

    setTerminalTabs((currentTabs) => [...currentTabs, nextTab]);
    setActiveTerminalId(id);
  }, [workspacePath]);

  const handleCloseTerminal = useCallback((terminalId: string) => {
    setTerminalTabs((currentTabs) => {
      if (currentTabs.length <= 1) {
        return currentTabs;
      }

      const tabIndex = currentTabs.findIndex((tab) => tab.id === terminalId);
      if (tabIndex === -1) return currentTabs;

      const nextTabs = currentTabs.filter((tab) => tab.id !== terminalId);
      setActiveTerminalId((currentActiveId) => {
        if (currentActiveId !== terminalId) return currentActiveId;
        return nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0].id;
      });
      return nextTabs;
    });
  }, []);

  const activeTab = openTabs.find((tab) => tab.path === activeTabPath) ?? null;

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="main-layout"
    >
      <ResizablePanel defaultSize={30} minSize={20} className="flex min-h-0 flex-col">
        <div className="main-layout-editor">
          <EditorPanel
            workspacePath={workspacePath!}
            onOpenFile={handleOpenFile}
          />
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={70} minSize={30} className="flex min-h-0 flex-col">
        <div className="main-layout-terminal">
          <TooltipProvider delay={250}>
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
                              className="terminal-tab group !flex-none justify-start gap-2 rounded-none border-0 px-3 py-2 after:hidden"
                            >
                              <SquareTerminal className="size-3.5" />
                              <span className="terminal-tab-label truncate">{tab.title}</span>
                              {terminalTabs.length > 1 && (
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
                              )}
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
                      active={tab.id === activeTerminalId}
                    />
                  </div>
                ))}

                {editorVisible && activeTab && (
                  <div className="terminal-editor-overlay">
                    <div className="terminal-editor-overlay-inner">
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
                                            className="editor-tab group !flex-none justify-start gap-2 rounded-none border-0 px-3 py-2 after:hidden"
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
                                onClick={() => setEditorVisible(false)}
                                aria-label="收起编辑器"
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
                    </div>
                  </div>
                )}
              </div>
            </Tabs>
          </TooltipProvider>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
