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
import { useState } from "react";
import { Circle, X } from "lucide-react";

type EditorTab = {
  path: string;
  content: string;
  savedContent: string;
};

function getTabName(path: string) {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function MainLayout() {
  const { workspacePath } = useWorkspace();
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);

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

  const activeTab = openTabs.find((tab) => tab.path === activeTabPath) ?? null;

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="main-layout"
    >
      <ResizablePanel defaultSize={30} minSize={20}>
        <div className="main-layout-editor">
          <EditorPanel
            workspacePath={workspacePath!}
            onOpenFile={handleOpenFile}
          />
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={70} minSize={30}>
        <div className="main-layout-terminal">
          <TerminalComponent cwd={workspacePath ?? undefined} />
          {editorVisible && activeTab && (
            <div className="terminal-editor-overlay">
              <TooltipProvider delay={250}>
                <div className="terminal-editor-overlay-inner">
                  <Tabs
                    value={activeTab.path}
                    onValueChange={setActiveTabPath}
                    className="flex h-full min-h-0 flex-col gap-0"
                  >
                    <div className="editor-tabs-bar">
                      <ScrollArea className="min-w-0 flex-1">
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
                                      className="editor-tab group !flex-none justify-start gap-1.5 rounded-none border-0 px-2.5 py-1.5 after:hidden"
                                    >
                                      {isDirty && (
                                        <Circle className="size-2 fill-current stroke-none text-sky-400" />
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
                    <div className="flex-1 min-h-0">
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
              </TooltipProvider>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
