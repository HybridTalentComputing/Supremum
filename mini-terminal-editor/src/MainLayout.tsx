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
      <ResizablePanel defaultSize={30} minSize={20}>
        <div className="main-layout-editor">
          <EditorPanel workspacePath={workspacePath!} />
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={70} minSize={30}>
        <div className="main-layout-terminal">
          <TerminalComponent cwd={workspacePath ?? undefined} />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
