import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { FileText, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils";
import { DiffEditor } from "./DiffEditor";
import { useFileIconUrl } from "./fileIcons";
import { getDiffFileDirectory, getDiffFileName, getGitStatusCode } from "./diffPresentation";
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

type DiffListEntry = {
  id: string;
  category: GitDiffCategory;
  file: GitChangedFile;
};

function DiffListIcon({ path }: { path: string }) {
  const iconUrl = useFileIconUrl(getDiffFileName(path), false, false);

  if (!iconUrl) {
    return <FileText className="all-diffs-entry-icon-svg" />;
  }

  return <img src={iconUrl} alt="" className="all-diffs-entry-icon-img" draggable={false} />;
}

function DiffListSection({
  title,
  files,
  category,
  selectedId,
  onSelect,
  onOpenFile,
}: {
  title: string;
  files: GitChangedFile[];
  category: GitDiffCategory;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenFile?: (path: string) => Promise<void> | void;
}) {
  if (files.length === 0) return null;

  return (
    <section className="all-diffs-section">
      <div className="all-diffs-section-header">
        <span>{title}</span>
        <span>{files.length}</span>
      </div>
      <div className="all-diffs-section-body">
        {files.map((file) => {
          const entryId = `${category}:${file.path}`;
          const fileName = getDiffFileName(file.path);
          const directory = getDiffFileDirectory(file.path);

          return (
            <button
              key={entryId}
              type="button"
              className="all-diffs-entry"
              data-active={selectedId === entryId ? "true" : undefined}
              onClick={() => onSelect(entryId)}
              onDoubleClick={() => {
                void onOpenFile?.(file.path);
              }}
            >
              <div className="all-diffs-entry-main">
                <DiffListIcon path={file.path} />
                <div className="all-diffs-entry-copy">
                  <span className="all-diffs-entry-name">{fileName}</span>
                  <span className="all-diffs-entry-dir">{directory || "."}</span>
                </div>
              </div>
              <div className="all-diffs-entry-meta">
                {file.additions > 0 ? (
                  <span className="all-diffs-entry-stat is-addition">+{file.additions}</span>
                ) : null}
                {file.deletions > 0 ? (
                  <span className="all-diffs-entry-stat is-deletion">-{file.deletions}</span>
                ) : null}
                <span className="all-diffs-entry-status">{getGitStatusCode(file.status)}</span>
              </div>
            </button>
          );
        })}
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
  const entries = useMemo<DiffListEntry[]>(
    () => [
      ...unstagedFiles.map((file) => ({ id: `unstaged:${file.path}`, category: "unstaged" as const, file })),
      ...stagedFiles.map((file) => ({ id: `staged:${file.path}`, category: "staged" as const, file })),
    ],
    [stagedFiles, unstagedFiles],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDirty, setSelectedDirty] = useState(false);
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );

  useEffect(() => {
    if (entries.length === 0) {
      setSelectedId(null);
      setSelectedDirty(false);
      return;
    }

    if (!selectedId || !entries.some((entry) => entry.id === selectedId)) {
      setSelectedId(entries[0].id);
      setSelectedDirty(false);
    }
  }, [entries, selectedId]);

  useEffect(() => {
    onSelectionChange?.(
      selectedEntry
        ? {
            file: selectedEntry.file,
            category: selectedEntry.category,
          }
        : null,
    );
  }, [onSelectionChange, selectedEntry]);

  useEffect(() => {
    onDirtyChange?.(selectedDirty);
  }, [onDirtyChange, selectedDirty]);

  useEffect(() => {
    return () => {
      onSelectionChange?.(null);
      onDirtyChange?.(false);
    };
  }, [onDirtyChange, onSelectionChange]);

  const handleSelect = useCallback(
    (nextId: string) => {
      if (nextId === selectedId) return;
      if (selectedDirty && !window.confirm("Current diff has unsaved changes. Switch anyway?")) {
        return;
      }
      setSelectedDirty(false);
      setSelectedId(nextId);
    },
    [selectedDirty, selectedId],
  );

  const handleSidebarKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (entries.length === 0) return;
      const currentIndex = Math.max(0, entries.findIndex((entry) => entry.id === selectedId));
      let nextIndex = currentIndex;

      if (event.key === "ArrowDown") {
        nextIndex = Math.min(entries.length - 1, currentIndex + 1);
      } else if (event.key === "ArrowUp") {
        nextIndex = Math.max(0, currentIndex - 1);
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = entries.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      handleSelect(entries[nextIndex].id);
    },
    [entries, handleSelect, selectedId],
  );

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
      <div
        className="all-diffs-sidebar"
        tabIndex={0}
        role="navigation"
        aria-label="Changed files"
        onKeyDown={handleSidebarKeyDown}
      >
        <div className="all-diffs-sidebar-header">
          <span>Repository Changes</span>
          <span>{entries.length}</span>
        </div>
        <div className="all-diffs-sidebar-body">
          <DiffListSection
            title="Changes"
            files={unstagedFiles}
            category="unstaged"
            selectedId={selectedId}
            onSelect={handleSelect}
            onOpenFile={onOpenFile}
          />
          <DiffListSection
            title="Staged Changes"
            files={stagedFiles}
            category="staged"
            selectedId={selectedId}
            onSelect={handleSelect}
            onOpenFile={onOpenFile}
          />
        </div>
      </div>
      <div className="all-diffs-detail">
        {selectedEntry ? (
          <DiffEditor
            key={selectedEntry.id}
            workspacePath={workspacePath}
            file={selectedEntry.file}
            category={selectedEntry.category}
            refreshToken={refreshToken}
            onOpenFile={onOpenFile}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
            onDiscardFile={onDiscardFile}
            onSaved={onSaved}
            onDirtyChange={setSelectedDirty}
          />
        ) : (
          <div className={cn("diff-editor-state", "all-diffs-placeholder")}>
            Select a changed file to inspect its diff.
          </div>
        )}
      </div>
    </div>
  );
}
