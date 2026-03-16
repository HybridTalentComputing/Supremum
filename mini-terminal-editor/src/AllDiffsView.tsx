import { useEffect, useMemo, useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { DiffEditor } from "./DiffEditor";
import type { GitChangedFile, GitDiffCategory } from "./gitTypes";

type AllDiffsViewProps = {
  workspacePath: string;
  stagedFiles: GitChangedFile[];
  unstagedFiles: GitChangedFile[];
  refreshToken: number;
  onOpenFile?: (path: string) => Promise<void> | void;
  onStageFile?: (path: string) => Promise<unknown> | void;
  onUnstageFile?: (path: string) => Promise<unknown> | void;
  onDiscardFile?: (path: string) => Promise<unknown> | void;
  onSaved?: () => Promise<void> | void;
  onSelectionChange?: (selection: { file: GitChangedFile; category: GitDiffCategory } | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

type DiffEntry = {
  id: string;
  category: GitDiffCategory;
  file: GitChangedFile;
};

function DiffGroup({
  title,
  entries,
  workspacePath,
  refreshToken,
  onOpenFile,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onSaved,
  onEntryDirtyChange,
}: {
  title: string;
  entries: DiffEntry[];
  workspacePath: string;
  refreshToken: number;
  onOpenFile?: (path: string) => Promise<void> | void;
  onStageFile?: (path: string) => Promise<unknown> | void;
  onUnstageFile?: (path: string) => Promise<unknown> | void;
  onDiscardFile?: (path: string) => Promise<unknown> | void;
  onSaved?: () => Promise<void> | void;
  onEntryDirtyChange: (id: string, dirty: boolean) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="all-diffs-group">
      <div className="all-diffs-group-header">
        <span>{title}</span>
        <span>{entries.length}</span>
      </div>
      <div className="all-diffs-group-body">
        {entries.map((entry) => (
          <div key={entry.id} className="all-diffs-item">
            <DiffEditor
              workspacePath={workspacePath}
              file={entry.file}
              category={entry.category}
              refreshToken={refreshToken}
              embedded
              onOpenFile={onOpenFile}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
              onDiscardFile={onDiscardFile}
              onSaved={onSaved}
              onDirtyChange={(dirty) => onEntryDirtyChange(entry.id, dirty)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function AllDiffsView({
  workspacePath,
  stagedFiles,
  unstagedFiles,
  refreshToken,
  onOpenFile,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onSaved,
  onSelectionChange,
  onDirtyChange,
}: AllDiffsViewProps) {
  const entries = useMemo<DiffEntry[]>(
    () => [
      ...unstagedFiles.map((file) => ({ id: `unstaged:${file.path}`, category: "unstaged" as const, file })),
      ...stagedFiles.map((file) => ({ id: `staged:${file.path}`, category: "staged" as const, file })),
    ],
    [stagedFiles, unstagedFiles],
  );
  const unstagedEntries = useMemo(
    () => entries.filter((entry) => entry.category === "unstaged"),
    [entries],
  );
  const stagedEntries = useMemo(
    () => entries.filter((entry) => entry.category === "staged"),
    [entries],
  );
  const [dirtyState, setDirtyState] = useState<Record<string, boolean>>({});

  useEffect(() => {
    onSelectionChange?.(null);
    return () => {
      onSelectionChange?.(null);
      onDirtyChange?.(false);
    };
  }, [onDirtyChange, onSelectionChange]);

  useEffect(() => {
    setDirtyState((currentState) => {
      const nextState: Record<string, boolean> = {};
      let changed = false;

      for (const entry of entries) {
        if (currentState[entry.id]) {
          nextState[entry.id] = true;
        }
      }

      const currentKeys = Object.keys(currentState);
      const nextKeys = Object.keys(nextState);
      if (currentKeys.length !== nextKeys.length) {
        changed = true;
      } else {
        changed = currentKeys.some((key) => !nextState[key]);
      }

      return changed ? nextState : currentState;
    });
  }, [entries]);

  useEffect(() => {
    onDirtyChange?.(Object.values(dirtyState).some(Boolean));
  }, [dirtyState, onDirtyChange]);

  const handleEntryDirtyChange = (id: string, dirty: boolean) => {
    setDirtyState((currentState) => {
      if (dirty) {
        if (currentState[id]) return currentState;
        return { ...currentState, [id]: true };
      }

      if (!(id in currentState)) return currentState;
      const nextState = { ...currentState };
      delete nextState[id];
      return nextState;
    });
  };

  if (entries.length === 0) {
    return (
      <div className="all-diffs-empty">
        <GitCompareArrows className="size-6" />
        <p>No changes to compare.</p>
      </div>
    );
  }

  return (
    <div className="all-diffs-layout">
      <div className="all-diffs-scroll">
        <DiffGroup
          title="Changes"
          entries={unstagedEntries}
          workspacePath={workspacePath}
          refreshToken={refreshToken}
          onOpenFile={onOpenFile}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          onDiscardFile={onDiscardFile}
          onSaved={onSaved}
          onEntryDirtyChange={handleEntryDirtyChange}
        />
        <DiffGroup
          title="Staged Changes"
          entries={stagedEntries}
          workspacePath={workspacePath}
          refreshToken={refreshToken}
          onOpenFile={onOpenFile}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          onDiscardFile={onDiscardFile}
          onSaved={onSaved}
          onEntryDirtyChange={handleEntryDirtyChange}
        />
      </div>
    </div>
  );
}
