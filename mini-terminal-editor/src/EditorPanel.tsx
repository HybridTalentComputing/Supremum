/**
 * EditorPanel：Changes/Files 固定于右栏顶部横跨全宽；下方为对应面板内容（Files 为文件树）
 */
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileTree } from "./FileTree";
import { FileText, GitCompareArrows } from "lucide-react";

type EditorPanelProps = {
  workspacePath: string;
  onOpenFile: (path: string, content: string) => void;
  activeSidebarTab?: "changes" | "files";
  onSidebarTabChange?: (tab: "changes" | "files") => void;
};

export function EditorPanel({
  workspacePath,
  onOpenFile,
  activeSidebarTab,
  onSidebarTabChange,
}: EditorPanelProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<"changes" | "files">("files");
  const activeTab = activeSidebarTab ?? internalActiveTab;

  const handleTabChange = (value: string) => {
    const nextTab = value === "changes" ? "changes" : "files";
    setInternalActiveTab(nextTab);
    onSidebarTabChange?.(nextTab);
  };

  const handleSelectFile = (path: string, content: string) => {
    onOpenFile(path, content);
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="flex flex-col flex-1 min-h-0 w-full gap-0"
    >
      {/* Tabs 横跨整个右栏顶部，平分宽度，随窗口伸缩 */}
      <TabsList
        className="sidebar-workspace-tabs"
      >
        <TabsTrigger
          value="files"
          className="sidebar-workspace-tab"
        >
          <FileText className="size-3.5" />
          Files
        </TabsTrigger>
        <TabsTrigger
          value="changes"
          className="sidebar-workspace-tab"
        >
          <GitCompareArrows className="size-3.5" />
          Changes
        </TabsTrigger>
      </TabsList>
      {/* 下方：侧栏 + CodeEditor */}
      <div className="flex flex-1 min-h-0 min-w-0">
        <TabsContent
          value="files"
          className="flex-1 min-h-0 mt-0 overflow-hidden flex flex-col data-[selected=false]:hidden"
        >
          <div className="flex-1 min-h-0 overflow-hidden">
            <FileTree
              workspacePath={workspacePath}
              onSelectFile={handleSelectFile}
            />
          </div>
        </TabsContent>
        <TabsContent
          value="changes"
          className="flex-1 min-h-0 mt-0 p-2 overflow-auto data-[selected=false]:hidden"
        >
          <div className="text-muted-foreground text-sm">
            Changes 面板待实现
          </div>
        </TabsContent>
      </div>
    </Tabs>
  );
}
