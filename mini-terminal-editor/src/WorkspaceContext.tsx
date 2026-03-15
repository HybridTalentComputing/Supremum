/**
 * 工作区上下文：存储全局 workspacePath，供 Terminal、EditorPanel 等组件使用
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

const RECENT_PROJECTS_STORAGE_KEY = "subset.recent-projects";
const MAX_RECENT_PROJECTS = 8;

type WorkspaceContextValue = {
  workspacePath: string | null;
  setWorkspacePath: (path: string | null) => void;
  recentProjects: string[];
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspacePath, setWorkspacePathState] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setRecentProjects(parsed.filter((item): item is string => typeof item === "string"));
      }
    } catch (error) {
      console.error("Failed to restore recent projects:", error);
    }
  }, []);

  const setWorkspacePath = useCallback((path: string | null) => {
    setWorkspacePathState(path);
    if (!path) return;

    setRecentProjects((currentProjects) => {
      const nextProjects = [
        path,
        ...currentProjects.filter((projectPath) => projectPath !== path),
      ].slice(0, MAX_RECENT_PROJECTS);

      try {
        window.localStorage.setItem(
          RECENT_PROJECTS_STORAGE_KEY,
          JSON.stringify(nextProjects),
        );
      } catch (error) {
        console.error("Failed to persist recent projects:", error);
      }

      return nextProjects;
    });
  }, []);

  return (
    <WorkspaceContext.Provider value={{ workspacePath, setWorkspacePath, recentProjects }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
