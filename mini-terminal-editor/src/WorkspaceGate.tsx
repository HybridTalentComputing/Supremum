/**
 * 工作区选择入口：未选工作区时显示「选择项目文件夹」；已选则渲染 MainLayout
 */
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "./WorkspaceContext";
import { MainLayout } from "./MainLayout";

export function WorkspaceGate() {
  const { workspacePath, setWorkspacePath } = useWorkspace();

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected) {
        const path =
          typeof selected === "string" ? selected : Array.isArray(selected) ? selected[0] : null;
        if (path) setWorkspacePath(path);
      }
    } catch (err) {
      console.error("Failed to open folder dialog:", err);
    }
  };

  if (!workspacePath) {
    return (
      <div className="workspace-gate">
        <div className="workspace-gate-content">
          <div className="workspace-gate-visual" aria-hidden>
            <img
              src="/app-icons/icon-dark.svg"
              alt=""
              className="workspace-gate-project-icon"
              draggable={false}
            />
          </div>
          <h2 className="workspace-gate-title">Select Project Folder</h2>
          <p className="workspace-gate-desc">
            Choose a folder to use as your workspace. The terminal and editor
            will share this path.
          </p>
          <Button type="button" className="workspace-gate-btn" onClick={handleSelectFolder}>
            Select Folder
          </Button>
        </div>
      </div>
    );
  }

  return <MainLayout />;
}
