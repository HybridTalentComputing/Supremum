/**
 * EditorPanel：Changes/Files 固定于右栏顶部横跨全宽；下方为文件树侧栏 + CodeEditor
 */
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileTree } from "./FileTree";
import { CodeEditor } from "./CodeEditor";

type EditorPanelProps = {
  workspacePath: string;
};

export function EditorPanel({ workspacePath }: EditorPanelProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string>("");

  const handleSelectFile = (path: string, content: string) => {
    setSelectedPath(path);
    setSelectedContent(content);
  };

  const handleSave = async (path: string, content: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_file", {
      payload: { workspacePath, path, content },
    });
    setSelectedContent(content);
  };

  return (
    <Tabs defaultValue="files" className="flex flex-col flex-1 min-h-0 w-full">
      {/* Tabs 横跨整个右栏顶部，平分宽度，随窗口伸缩 */}
      <TabsList
        variant="line"
        className="w-full flex shrink-0 rounded-none border-b border-border/50 bg-transparent px-0 h-9 min-w-0"
      >
        <TabsTrigger
          value="changes"
          className="flex-1 min-w-0 basis-0 rounded-none border-b-2 border-transparent data-active:border-primary px-3"
        >
          Changes
        </TabsTrigger>
        <TabsTrigger
          value="files"
          className="flex-1 min-w-0 basis-0 rounded-none border-b-2 border-transparent data-active:border-primary px-3"
        >
          Files
        </TabsTrigger>
      </TabsList>
      {/* 下方：侧栏 + CodeEditor */}
      <div className="flex flex-1 min-h-0 min-w-0">
        <div className="flex flex-col w-[220px] min-w-[180px] shrink-0 border-r border-border/50 overflow-hidden">
          <TabsContent
            value="changes"
            className="flex-1 min-h-0 mt-0 p-2 overflow-auto data-[selected=false]:hidden"
          >
            <div className="text-muted-foreground text-sm" />
          </TabsContent>
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
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <CodeEditor
            path={selectedPath}
            content={selectedContent}
            workspacePath={workspacePath}
            onSave={handleSave}
          />
        </div>
      </div>
    </Tabs>
  );
}
