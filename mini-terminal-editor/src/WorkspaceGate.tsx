/**
 * 工作区选择入口：未选工作区时显示「选择项目文件夹」；已选则渲染 MainLayout
 */
import { open } from "@tauri-apps/plugin-dialog";
import { homeDir } from "@tauri-apps/api/path";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "./WorkspaceContext";
import { MainLayout } from "./MainLayout";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { FolderOpen, FolderPlus, History } from "lucide-react";

const CREATE_PROJECT_LOCATION_STORAGE_KEY = "subset.create-project-location";

function getProjectName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function getProjectParent(path: string) {
  const normalizedPath = path.replace(/\\/g, "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length <= 1) return "~";

  const parentSegments = segments.slice(0, -1);
  const parentPath = `${normalizedPath.startsWith("/") ? "/" : ""}${parentSegments.join("/")}`;
  return parentPath.replace(/^\/Users\/[^/]+/, "~");
}

function formatDisplayPath(path: string) {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

export function WorkspaceGate() {
  const { workspacePath, setWorkspacePath, recentProjects } = useWorkspace();
  const [createProjectName, setCreateProjectName] = useState("");
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [createParentPath, setCreateParentPath] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadDefaultLocation = async () => {
      try {
        const savedLocation = window.localStorage.getItem(CREATE_PROJECT_LOCATION_STORAGE_KEY);
        if (savedLocation) {
          if (!cancelled) setCreateParentPath(savedLocation);
          return;
        }

        const systemHomeDir = await homeDir();
        if (!cancelled) setCreateParentPath(systemHomeDir);
      } catch (error) {
        console.error("Failed to restore create-project location:", error);
      }
    };

    void loadDefaultLocation();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!createPanelOpen) return;
    createInputRef.current?.focus();
  }, [createPanelOpen]);

  const handleOpenProject = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Project",
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

  const handleCreateProject = async () => {
    try {
      const projectName = createProjectName.trim();
      if (!projectName || !createParentPath || /[\\/]/.test(projectName)) return;

      const createdPath = await invoke<string>("create_project_root", {
        payload: { parentPath: createParentPath, projectName },
      });
      setCreateProjectName("");
      setCreatePanelOpen(false);
      setWorkspacePath(createdPath);
    } catch (err) {
      console.error("Failed to create project:", err);
      window.alert(String(err));
    }
  };

  const handleChooseCreateLocation = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Project Location",
        defaultPath: createParentPath ?? undefined,
      });

      const parentPath =
        typeof selected === "string" ? selected : Array.isArray(selected) ? selected[0] : null;
      if (parentPath) {
        setCreateParentPath(parentPath);
        window.localStorage.setItem(CREATE_PROJECT_LOCATION_STORAGE_KEY, parentPath);
      }
    } catch (err) {
      console.error("Failed to choose project location:", err);
    }
  };

  const createProjectNameTrimmed = createProjectName.trim();
  const createNameInvalid = /[\\/]/.test(createProjectNameTrimmed);
  const canCreateProject =
    createProjectNameTrimmed.length > 0 && !createNameInvalid && Boolean(createParentPath);
  const createProjectPreview =
    canCreateProject && createParentPath
      ? `${formatDisplayPath(createParentPath)}/${createProjectNameTrimmed}`
      : null;

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
          <h2 className="workspace-gate-title">Welcome to Subset</h2>
          <p className="workspace-gate-desc">
            Open a project to start working with terminal and editor in one focused workspace.
          </p>
          <div className="workspace-gate-actions">
            <Button
              type="button"
              variant="outline"
              className="workspace-gate-action"
              onClick={handleOpenProject}
            >
              <span className="workspace-gate-action-icon">
                <FolderOpen className="size-4" />
              </span>
              <span className="workspace-gate-action-copy">
                <span className="workspace-gate-action-title">Open Project</span>
                <span className="workspace-gate-action-desc">Choose an existing workspace folder</span>
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="workspace-gate-action"
              onClick={() => {
                setCreatePanelOpen(true);
              }}
            >
              <span className="workspace-gate-action-icon">
                <FolderPlus className="size-4" />
              </span>
              <span className="workspace-gate-action-copy">
                <span className="workspace-gate-action-title">Create a new project</span>
                <span className="workspace-gate-action-desc">Create a folder and open it as a workspace</span>
              </span>
            </Button>
          </div>
          {createPanelOpen ? (
            <div className="workspace-gate-create-panel">
              <div className="workspace-gate-create-fields">
                <div className="workspace-gate-create-field">
                  <label className="workspace-gate-create-label">Location</label>
                  <div className="workspace-gate-create-location">
                    <Button
                      type="button"
                      variant="outline"
                    className="workspace-gate-create-location-button"
                    onClick={handleChooseCreateLocation}
                  >
                      {createParentPath ? formatDisplayPath(createParentPath) : "Choose Folder"}
                    </Button>
                  </div>
                </div>
                <div className="workspace-gate-create-field">
                  <label className="workspace-gate-create-label" htmlFor="project-name">
                    Project name
                  </label>
                  <input
                    id="project-name"
                    ref={createInputRef}
                    className="workspace-gate-create-input"
                    value={createProjectName}
                    onChange={(event) => setCreateProjectName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && canCreateProject) {
                        event.preventDefault();
                        void handleCreateProject();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setCreatePanelOpen(false);
                      }
                    }}
                    placeholder="my-app"
                  />
                  {createNameInvalid ? (
                    <p className="workspace-gate-create-hint">
                      Project name cannot contain slashes.
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="workspace-gate-create-footer">
                <div className="workspace-gate-create-preview">
                  <span className="workspace-gate-create-preview-label">Will create:</span>
                  <span className="workspace-gate-create-preview-path">
                    {createProjectPreview ?? "Choose a location and enter a project name"}
                  </span>
                </div>
                <div className="workspace-gate-create-actions">
                  <Button
                    type="button"
                    variant="outline"
                    className="workspace-gate-create-cancel"
                    onClick={() => {
                      setCreatePanelOpen(false);
                      setCreateProjectName("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="workspace-gate-create-submit"
                    onClick={() => void handleCreateProject()}
                    disabled={!canCreateProject}
                  >
                    Create
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="workspace-gate-recents">
            <div className="workspace-gate-recents-header">
              <History className="size-4" />
              <span>Recent Projects</span>
            </div>
            {recentProjects.length > 0 ? (
              <div className="workspace-gate-recent-list">
                {recentProjects.map((projectPath) => (
                  <Button
                    key={projectPath}
                    type="button"
                    variant="ghost"
                    className="workspace-gate-recent"
                    onClick={() => setWorkspacePath(projectPath)}
                  >
                    <span className="workspace-gate-recent-main">
                      <span className="workspace-gate-recent-name">{getProjectName(projectPath)}</span>
                      <span className="workspace-gate-recent-path">{getProjectParent(projectPath)}</span>
                    </span>
                  </Button>
                ))}
              </div>
            ) : (
              <p className="workspace-gate-recents-empty">
                Projects you open here will show up for quick access.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <MainLayout />;
}
