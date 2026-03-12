import { invoke } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import {
  getWorkspaceContext,
  workspaceTasks,
  type WorkspaceTask
} from "../../lib/mock-data/workbench";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { TopTabsBar } from "./TopTabsBar";
import { PaneTabsBar } from "./PaneTabsBar";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { ChangesPanel } from "../git/ChangesPanel";
import { CodeEditorPanel } from "../editors/CodeEditorPanel";
import { DiffPanel } from "../git/DiffPanel";

type WorkspacePane = "terminal" | "editor" | "diff";

export function AppShell() {
  const [workspaces, setWorkspaces] = useState<WorkspaceTask[]>(workspaceTasks);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [activePane, setActivePane] = useState<WorkspacePane>("terminal");
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, boolean>>({});
  const [editorTabs, setEditorTabs] = useState<string[]>([]);
  const [diffTabs, setDiffTabs] = useState<string[]>([]);
  const [selectedEditorFilePath, setSelectedEditorFilePath] = useState<string | null>(null);
  const [selectedDiffFilePath, setSelectedDiffFilePath] = useState<string | null>(null);
  const [editorRevealTarget, setEditorRevealTarget] = useState<{
    filePath: string;
    line: number;
    nonce: number;
  } | null>(null);
  const [gitRefreshNonce, setGitRefreshNonce] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState(
    workspaceTasks.find((task) => task.selected)?.id ?? workspaceTasks[0]?.id ?? ""
  );

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedTaskId) ?? workspaces[0];
  const editorLabel = useMemo(
    () => selectedEditorFilePath?.split("/").pop() ?? "no file",
    [selectedEditorFilePath]
  );
  const diffLabel = useMemo(
    () => selectedDiffFilePath?.split("/").pop() ?? "no diff",
    [selectedDiffFilePath]
  );
  const editorDirty = selectedEditorFilePath ? Boolean(dirtyFiles[selectedEditorFilePath]) : false;

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
    setSelectedEditorFilePath(null);
    setSelectedDiffFilePath(null);
    setEditorRevealTarget(null);
    setGitRefreshNonce(0);
    setEditorTabs([]);
    setDiffTabs([]);
    setDirtyFiles({});
    setActivePane("terminal");
  }, [selectedTaskId]);

  const handleSelectEditorFile = useEffectEvent((filePath: string, line?: number) => {
    setEditorTabs((current) => (current.includes(filePath) ? current : [...current, filePath]));
    setSelectedEditorFilePath(filePath);
    if (line && line > 0) {
      setEditorRevealTarget({
        filePath,
        line,
        nonce: Date.now()
      });
    }
    setActivePane("editor");
  });

  const handleSelectDiffFile = useEffectEvent((filePath: string) => {
    setDiffTabs((current) => (current.includes(filePath) ? current : [...current, filePath]));
    setSelectedDiffFilePath(filePath);
    setActivePane("diff");
  });

  const handleCloseEditorTab = useEffectEvent((filePath: string) => {
    setEditorTabs((current) => {
      const remaining = current.filter((item) => item !== filePath);
      if (selectedEditorFilePath === filePath) {
        setSelectedEditorFilePath(remaining.length > 0 ? remaining[remaining.length - 1] : null);
      }
      if (remaining.length === 0 && activePane === "editor") {
        setActivePane("terminal");
      }
      return remaining;
    });
    setDirtyFiles((current) => {
      const next = { ...current };
      delete next[filePath];
      return next;
    });
  });

  const handleCloseDiffTab = useEffectEvent((filePath: string) => {
    setDiffTabs((current) => {
      const remaining = current.filter((item) => item !== filePath);
      if (selectedDiffFilePath === filePath) {
        setSelectedDiffFilePath(remaining.length > 0 ? remaining[remaining.length - 1] : null);
      }
      if (remaining.length === 0 && activePane === "diff") {
        setActivePane("terminal");
      }
      return remaining;
    });
  });

  const handleDirtyChange = useEffectEvent((filePath: string, dirty: boolean) => {
    setDirtyFiles((current) => ({
      ...current,
      [filePath]: dirty
    }));
  });

  const handleEditorSaved = useEffectEvent(() => {
    setGitRefreshNonce((current) => current + 1);
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
            activePane={activePane}
            editorLabel={editorLabel}
            diffLabel={diffLabel}
            editorDirty={editorDirty}
            onSelectPane={setActivePane}
          />
          <PaneTabsBar
            title={
              activePane === "terminal"
                ? "Terminal"
                : activePane === "editor"
                  ? "Editor"
                  : "Diff"
            }
            tabs={
              activePane === "terminal"
                ? [
                    {
                      id: selectedWorkspace?.id ?? "terminal",
                      label: selectedWorkspace?.name ?? "terminal",
                      icon: "•"
                    }
                  ]
                : activePane === "editor"
                  ? editorTabs.length > 0
                    ? editorTabs.map((filePath) => ({
                        id: filePath,
                        label: filePath.split("/").pop() ?? filePath,
                        icon: "◧",
                        dirty: Boolean(dirtyFiles[filePath]),
                        closable: true
                      }))
                    : [
                        {
                          id: "editor-empty",
                          label: "No file open",
                          icon: "◧",
                          placeholder: true
                        }
                      ]
                  : diffTabs.length > 0
                    ? diffTabs.map((filePath) => ({
                        id: filePath,
                        label: filePath.split("/").pop() ?? filePath,
                        icon: "≋",
                        closable: true
                      }))
                    : [
                        {
                          id: "diff-empty",
                          label: "No diff open",
                          icon: "≋",
                          placeholder: true
                        }
                      ]
            }
            activeTabId={
              activePane === "terminal"
                ? selectedWorkspace?.id ?? null
                : activePane === "editor"
                  ? selectedEditorFilePath
                  : selectedDiffFilePath
            }
            onSelectTab={
              activePane === "terminal"
                ? undefined
                : activePane === "editor"
                  ? handleSelectEditorFile
                  : handleSelectDiffFile
            }
            onCloseTab={
              activePane === "terminal"
                ? undefined
                : activePane === "editor"
                  ? handleCloseEditorTab
                  : handleCloseDiffTab
            }
          />
          {selectedWorkspace ? (
            activePane === "editor" ? (
              <CodeEditorPanel
                workspace={getWorkspaceContext(selectedWorkspace)}
                filePath={selectedEditorFilePath}
                revealLine={
                  editorRevealTarget?.filePath === selectedEditorFilePath
                    ? editorRevealTarget.line
                    : undefined
                }
                revealNonce={
                  editorRevealTarget?.filePath === selectedEditorFilePath
                    ? editorRevealTarget.nonce
                    : undefined
                }
                onClose={() => {
                  if (selectedEditorFilePath) {
                    handleCloseEditorTab(selectedEditorFilePath);
                  }
                }}
                onDirtyChange={handleDirtyChange}
                onSaved={handleEditorSaved}
              />
            ) : activePane === "diff" ? (
              <DiffPanel
                workspace={getWorkspaceContext(selectedWorkspace)}
                filePath={selectedDiffFilePath}
                onOpenEditor={handleSelectEditorFile}
                refreshNonce={gitRefreshNonce}
              />
            ) : (
              <TerminalPanel
                activeTabId={activePane}
                workspace={getWorkspaceContext(selectedWorkspace)}
              />
            )
          ) : null}
        </section>
        {selectedWorkspace ? (
          <ChangesPanel
            workspace={getWorkspaceContext(selectedWorkspace)}
            activeEditorFilePath={selectedEditorFilePath}
            activeDiffFilePath={selectedDiffFilePath}
            onSelectEditorFile={handleSelectEditorFile}
            onSelectDiffFile={handleSelectDiffFile}
            refreshNonce={gitRefreshNonce}
          />
        ) : null}
      </div>
    </main>
  );
}
