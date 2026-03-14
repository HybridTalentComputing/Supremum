/**
 * EditorPanel：Changes/Files 固定于右栏顶部横跨全宽；下方为对应面板内容（Files 为文件树）
 */
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileTree } from "./FileTree";

type EditorPanelProps = {
  workspacePath: string;
  onOpenFile: (path: string, content: string) => void;
};

export function EditorPanel({ workspacePath, onOpenFile }: EditorPanelProps) {
  const [activeTab, setActiveTab] = useState<"changes" | "files">("files");

  const handleSelectFile = (path: string, content: string) => {
    onOpenFile(path, content);
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) =>
        setActiveTab(value === "changes" ? "changes" : "files")
      }
      className="flex flex-col flex-1 min-h-0 w-full"
    >
      {/* Tabs 横跨整个右栏顶部，平分宽度，随窗口伸缩 */}
      <TabsList
        variant="line"
        className="w-full flex shrink-0 rounded-none border-b border-border/50 bg-transparent px-0 h-9 min-w-0"
      >
        <TabsTrigger
          value="files"
          className="flex-1 min-w-0 basis-0 rounded-none border-b-2 border-transparent data-active:border-primary px-3"
        >
          Files
        </TabsTrigger>
        <TabsTrigger
          value="changes"
          className="flex-1 min-w-0 basis-0 rounded-none border-b-2 border-transparent data-active:border-primary px-3"
        >
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
