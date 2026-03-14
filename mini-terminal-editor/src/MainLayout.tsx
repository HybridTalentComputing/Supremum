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

export function MainLayout() {
  const { workspacePath } = useWorkspace();

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="main-layout"
    >
      <ResizablePanel defaultSize={50} minSize={25}>
        <div className="main-layout-terminal">
          <TerminalComponent cwd={workspacePath ?? undefined} />
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={50} minSize={25}>
        <div className="main-layout-editor">
          <EditorPanel workspacePath={workspacePath!} />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
