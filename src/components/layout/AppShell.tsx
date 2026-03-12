import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  getWorkspaceContext,
  tabs,
  workspaceTasks,
  type WorkspaceTask
} from "../../lib/mock-data/workbench";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { TopTabsBar } from "./TopTabsBar";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { ChangesPanel } from "../git/ChangesPanel";

export function AppShell() {
  const [workspaces, setWorkspaces] = useState<WorkspaceTask[]>(workspaceTasks);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState(
    tabs.find((tab) => tab.active)?.id ?? tabs[0]?.id ?? ""
  );
  const [selectedTaskId, setSelectedTaskId] = useState(
    workspaceTasks.find((task) => task.selected)?.id ?? workspaceTasks[0]?.id ?? ""
  );

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedTaskId) ?? workspaces[0];

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
            activeTabId={activeTabId}
            onSelectTab={setActiveTabId}
          />
          {selectedWorkspace ? (
            <TerminalPanel
              activeTabId={activeTabId}
              workspace={getWorkspaceContext(selectedWorkspace)}
            />
          ) : null}
        </section>
        {selectedWorkspace ? (
          <ChangesPanel workspace={getWorkspaceContext(selectedWorkspace)} />
        ) : null}
      </div>
    </main>
  );
}
