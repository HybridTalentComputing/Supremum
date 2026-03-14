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
import { X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

export function MainLayout() {
  const { workspacePath } = useWorkspace();
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorVisible, setEditorVisible] = useState(false);

  const handleOpenFile = (path: string, content: string) => {
    setEditorPath(path);
    setEditorContent(content);
    setEditorVisible(true);
  };

  const handleCloseEditor = () => {
    setEditorVisible(false);
  };

  const handleSave = async (path: string, content: string) => {
    await invoke("write_file", {
      payload: { workspacePath, path, content },
    });
    setEditorContent(content);
  };

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
          {editorVisible && (
            <div className="terminal-editor-overlay">
              <div className="terminal-editor-overlay-inner">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="terminal-editor-close"
                  onClick={handleCloseEditor}
                  aria-label="关闭编辑器"
                >
                  <X className="size-4" />
                </Button>
                <CodeEditor
                  path={editorPath}
                  content={editorContent}
                  workspacePath={workspacePath!}
                  onSave={handleSave}
                />
              </div>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
