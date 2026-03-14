/**
 * 工作区上下文：存储全局 workspacePath，供 Terminal、EditorPanel 等组件使用
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

type WorkspaceContextValue = {
  workspacePath: string | null;
  setWorkspacePath: (path: string | null) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspacePath, setWorkspacePathState] = useState<string | null>(null);
  const setWorkspacePath = useCallback((path: string | null) => {
    setWorkspacePathState(path);
  }, []);

  return (
    <WorkspaceContext.Provider value={{ workspacePath, setWorkspacePath }}>
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
