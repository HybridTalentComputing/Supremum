import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  getWorkspaceContext,
  workspaceTasks,
  type WorkspaceTask
} from "../../lib/mock-data/workbench";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { TopTabsBar } from "./TopTabsBar";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { ChangesPanel } from "../git/ChangesPanel";
import { CodeEditorPanel } from "../editors/CodeEditorPanel";

export function AppShell() {
  const [workspaces, setWorkspaces] = useState<WorkspaceTask[]>(workspaceTasks);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState("terminal");
  const [openFileTabs, setOpenFileTabs] = useState<string[]>([]);
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, boolean>>({});
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState(
    workspaceTasks.find((task) => task.selected)?.id ?? workspaceTasks[0]?.id ?? ""
  );

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedTaskId) ?? workspaces[0];
  const topTabs = useMemo(
    () => [
      {
        id: "terminal",
        label: "terminal",
        icon: "•",
        closable: false
      },
      ...openFileTabs.map((filePath) => ({
        id: filePath,
        label: filePath.split("/").pop() ?? filePath,
        icon: "◧",
        dirty: Boolean(dirtyFiles[filePath]),
        closable: true
      }))
    ],
    [dirtyFiles, openFileTabs]
  );

  async function loadWorkspaces() {
    try {
      const results = await invoke<WorkspaceTask[]>("list_workspaces");

      if (results.length > 0) {
        setWorkspaces(results);
        setSelectedTaskId((currentSelectedTaskId) => {
          const stillExists = results.some((workspace) => workspace.id === currentSelectedTaskId);
          return stillExists ? currentSelectedTaskId : results[0].id;
        });
        setWorkspaceError(null);
      } else {
        setWorkspaces(workspaceTasks);
        setWorkspaceError("No workspaces found nearby.");
      }
    } catch {
      setWorkspaces(workspaceTasks);
      setWorkspaceError("Using demo workspaces while native data is unavailable.");
    } finally {
      setIsLoadingWorkspaces(false);
    }
  }

  useEffect(() => {
    void loadWorkspaces();
  }, []);

  useEffect(() => {
    setSelectedFilePath(null);
    setOpenFileTabs([]);
    setDirtyFiles({});
    setActiveTabId("terminal");
  }, [selectedTaskId]);

  useEffect(() => {
    if (activeTabId === "terminal") {
      setSelectedFilePath(null);
      return;
    }

    setSelectedFilePath(activeTabId);
  }, [activeTabId]);

  const handleSelectFile = useEffectEvent((filePath: string) => {
    setOpenFileTabs((current) =>
      current.includes(filePath) ? current : [...current, filePath]
    );
    setActiveTabId(filePath);
    setSelectedFilePath(filePath);
  });

  const handleCloseTab = useEffectEvent((tabId: string) => {
    if (tabId === "terminal") {
      return;
    }

    setOpenFileTabs((current) => {
      const remaining = current.filter((filePath) => filePath !== tabId);
      if (activeTabId === tabId) {
        const nextActive = remaining.length > 0 ? remaining[remaining.length - 1] : "terminal";
        setActiveTabId(nextActive);
        setSelectedFilePath(nextActive === "terminal" ? null : nextActive);
      }
      return remaining;
    });

    setDirtyFiles((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
  });

  const handleDirtyChange = useEffectEvent((filePath: string, dirty: boolean) => {
    setDirtyFiles((current) => ({
      ...current,
      [filePath]: dirty
    }));
  });

  async function handleAddWorkspace() {
    const path = window.prompt("Enter an absolute workspace path");
    if (!path) {
      return;
    }

    try {
      const workspace = await invoke<WorkspaceTask>("add_workspace", {
        payload: { path }
      });
      setWorkspaceError(null);
      await loadWorkspaces();
      setSelectedTaskId(workspace.id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to add workspace.";
      setWorkspaceError(message);
    }
  }

  return (
    <main className="app-frame">
      <div className="app-shell">
        <WorkspaceSidebar
          workspaces={workspaces}
          isLoading={isLoadingWorkspaces}
          errorMessage={workspaceError}
          selectedTaskId={selectedTaskId}
          onAddWorkspace={handleAddWorkspace}
          onSelectTask={setSelectedTaskId}
        />
        <section className="app-main">
          <TopTabsBar
            tabs={topTabs}
            activeTabId={activeTabId}
            onSelectTab={setActiveTabId}
            onCloseTab={handleCloseTab}
          />
          {selectedWorkspace ? (
            selectedFilePath ? (
              <CodeEditorPanel
                workspace={getWorkspaceContext(selectedWorkspace)}
                filePath={selectedFilePath}
                onClose={() => handleCloseTab(selectedFilePath)}
                onDirtyChange={handleDirtyChange}
              />
            ) : (
              <TerminalPanel
                activeTabId={activeTabId}
                workspace={getWorkspaceContext(selectedWorkspace)}
              />
            )
          ) : null}
        </section>
        {selectedWorkspace ? (
          <ChangesPanel
            workspace={getWorkspaceContext(selectedWorkspace)}
            activeFilePath={selectedFilePath}
            onSelectFile={handleSelectFile}
          />
        ) : null}
      </div>
    </main>
  );
}
