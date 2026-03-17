import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  FileText,
  FoldVertical,
  GitCompareArrows,
  List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DiffEditor } from "./DiffEditor";
import { useFileIconUrl } from "./fileIcons";
import { getDiffFileDirectory, getDiffFileName, getGitStatusCode } from "./diffPresentation";
import type { GitChangedFile, GitDiffCategory } from "./gitTypes";

type AllDiffsViewProps = {
  workspacePath: string;
  stagedFiles: GitChangedFile[];
  unstagedFiles: GitChangedFile[];
  collapseAllRequest?: number;
  expandAllRequest?: number;
  onOpenFile?: (path: string) => Promise<void> | void;
  onStageFile?: (path: string) => Promise<unknown> | void;
  onUnstageFile?: (path: string) => Promise<unknown> | void;
  onDiscardFile?: (path: string) => Promise<unknown> | void;
  onSaved?: () => Promise<void> | void;
  onSelectionChange?: (selection: { file: GitChangedFile; category: GitDiffCategory } | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onAllCollapsedChange?: (collapsed: boolean) => void;
};

type DiffEntry = {
  id: string;
  category: GitDiffCategory;
  file: GitChangedFile;
};

type DiffChromeState = {
  categoryLabel: string;
  statusCode: string;
  editableLabel: string | null;
  chunkCount: number;
  currentChunkNumber: number;
  mode: "side-by-side" | "inline";
  hideUnchanged: boolean;
  navigatePrevious: () => void;
  navigateNext: () => void;
  toggleMode: () => void;
  toggleUnchanged: () => void;
};

function DiffFileIcon({ path }: { path: string }) {
  const iconUrl = useFileIconUrl(getDiffFileName(path), false, false);

  if (!iconUrl) {
    return <FileText className="all-diffs-item-icon-svg" />;
  }

  return <img src={iconUrl} alt="" className="all-diffs-item-icon-img" draggable={false} />;
}

function getWorkspaceName(workspacePath: string) {
  const parts = workspacePath.split(/[\\/]/);
  return parts[parts.length - 1] || workspacePath;
}

function HeaderTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function estimateExpandedBodyHeight(file: GitChangedFile, category: GitDiffCategory) {
  const changedLines = Math.max(file.additions + file.deletions, 1);
  const baseLines =
    category === "unstaged"
      ? changedLines + 8
      : changedLines + 6;
  const estimated = baseLines * 22 + 12;
  return Math.max(180, Math.min(estimated, 1400));
}

const ALL_DIFFS_HEADER_HEIGHT = 44;
const ALL_DIFFS_MOUNT_BUFFER = 320;

function DiffEntrySection({
  entry,
  workspacePath,
  shouldMountDiff,
  placeholderHeight,
  onOpenFile,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onSaved,
  onEntryDirtyChange,
  onMeasuredHeightChange,
  chromeState,
  onChromeChange,
  isCollapsed,
  onToggleEntry,
}: {
  entry: DiffEntry;
  workspacePath: string;
  shouldMountDiff: boolean;
  placeholderHeight: number;
  onOpenFile?: (path: string) => Promise<void> | void;
  onStageFile?: (path: string) => Promise<unknown> | void;
  onUnstageFile?: (path: string) => Promise<unknown> | void;
  onDiscardFile?: (path: string) => Promise<unknown> | void;
  onSaved?: () => Promise<void> | void;
  onEntryDirtyChange: (id: string, dirty: boolean) => void;
  onMeasuredHeightChange: (id: string, height: number) => void;
  chromeState: DiffChromeState | null;
  onChromeChange: (id: string, chrome: DiffChromeState | null) => void;
  isCollapsed: boolean;
  onToggleEntry: (id: string) => void;
}) {
  const workspaceName = getWorkspaceName(workspacePath);
  const fileName = getDiffFileName(entry.file.path);
  const directory = getDiffFileDirectory(entry.file.path);
  const pathLabel = [workspaceName, directory].filter(Boolean).join("/");
  const chrome = chromeState;
  const ModeIcon = chrome?.mode === "inline" ? List : Columns2;
  const modeLabel =
    chrome?.mode === "inline" ? "Switch to side by side diff" : "Switch to inline diff";
  const contentVersion = [
    entry.category,
    entry.file.status,
    entry.file.path,
    entry.file.oldPath ?? "",
    entry.file.additions,
    entry.file.deletions,
  ].join(":");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!bodyRef.current || isCollapsed || !shouldMountDiff) return;

    const updateHeight = () => {
      const nextHeight = Math.max(bodyRef.current?.offsetHeight ?? 0, 1);
      onMeasuredHeightChange(entry.id, nextHeight);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, [entry.id, isCollapsed, onMeasuredHeightChange, shouldMountDiff]);

  const shouldRenderMountedDiff = !isCollapsed && (shouldMountDiff || isDirty);

  return (
    <section className="all-diffs-item" data-collapsed={isCollapsed ? "true" : undefined}>
      <button
        type="button"
        className="all-diffs-item-header"
        onClick={() => onToggleEntry(entry.id)}
        title={entry.file.oldPath ? `${entry.file.oldPath} -> ${entry.file.path}` : entry.file.path}
      >
        <span className="all-diffs-item-header-main">
          <span className="all-diffs-item-chevron">
            {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </span>
          <span className="all-diffs-item-icon">
            <DiffFileIcon path={entry.file.path} />
          </span>
          <span className="all-diffs-item-copy">
            <span className="all-diffs-item-name">{fileName}</span>
            {pathLabel ? <span className="all-diffs-item-path">{pathLabel}</span> : null}
          </span>
        </span>
        <span className="all-diffs-item-meta">
          {chrome ? (
            <>
              <span className={cn("diff-editor-category", `is-${entry.category}`)}>
                {chrome.categoryLabel}
              </span>
              <span className="all-diffs-item-separator">•</span>
              <span className={cn("diff-editor-status-code", `is-${entry.file.status}`)}>
                {chrome.statusCode}
              </span>
              {chrome.editableLabel ? (
                <>
                  <span className="all-diffs-item-separator">•</span>
                  <span className="diff-editor-edit-state">{chrome.editableLabel}</span>
                </>
              ) : null}
              <span className="all-diffs-item-controls">
                <span className="diff-editor-chunk-count">
                  {chrome.currentChunkNumber}/{chrome.chunkCount || 0}
                </span>
                <HeaderTooltip label="Previous change">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="diff-editor-action"
                    disabled={chrome.chunkCount === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      chrome.navigatePrevious();
                    }}
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                </HeaderTooltip>
                <HeaderTooltip label="Next change">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="diff-editor-action"
                    disabled={chrome.chunkCount === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      chrome.navigateNext();
                    }}
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </HeaderTooltip>
                <HeaderTooltip label={modeLabel}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="diff-editor-action"
                    data-active="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      chrome.toggleMode();
                    }}
                  >
                    <ModeIcon className="size-3.5" />
                  </Button>
                </HeaderTooltip>
                <HeaderTooltip label={chrome.hideUnchanged ? "Show unchanged lines" : "Hide unchanged lines"}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="diff-editor-action"
                    data-active={chrome.hideUnchanged ? "true" : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      chrome.toggleUnchanged();
                    }}
                  >
                    <FoldVertical className="size-3.5" />
                  </Button>
                </HeaderTooltip>
              </span>
            </>
          ) : null}
          {entry.file.additions > 0 ? (
            <span className="all-diffs-item-stat is-addition">+{entry.file.additions}</span>
          ) : null}
          {entry.file.deletions > 0 ? (
            <span className="all-diffs-item-stat is-deletion">-{entry.file.deletions}</span>
          ) : null}
          <span className={cn("all-diffs-item-status", `is-${entry.file.status}`)}>
            {getGitStatusCode(entry.file.status)}
          </span>
        </span>
      </button>
      {isCollapsed ? null : shouldRenderMountedDiff ? (
        <div ref={bodyRef} className="all-diffs-item-body">
          <DiffEditor
            workspacePath={workspacePath}
            file={entry.file}
            category={entry.category}
            contentVersion={contentVersion}
            embedded
            onOpenFile={onOpenFile}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
            onDiscardFile={onDiscardFile}
            onSaved={onSaved}
            onChromeChange={(chrome) => onChromeChange(entry.id, chrome)}
            onDirtyChange={(dirty) => {
              setIsDirty(dirty);
              onEntryDirtyChange(entry.id, dirty);
            }}
          />
        </div>
      ) : (
        <div
          className="all-diffs-item-body all-diffs-item-body-placeholder"
          style={{ minHeight: `${placeholderHeight}px` }}
        />
      )}
    </section>
  );
}

function DiffGroup({
  entries,
  workspacePath,
  mountedEntryIds,
  placeholderHeights,
  onOpenFile,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onSaved,
  onEntryDirtyChange,
  onMeasuredHeightChange,
  chromeState,
  onChromeChange,
  collapsedState,
  onToggleEntry,
}: {
  entries: DiffEntry[];
  workspacePath: string;
  mountedEntryIds: Set<string>;
  placeholderHeights: Record<string, number>;
  onOpenFile?: (path: string) => Promise<void> | void;
  onStageFile?: (path: string) => Promise<unknown> | void;
  onUnstageFile?: (path: string) => Promise<unknown> | void;
  onDiscardFile?: (path: string) => Promise<unknown> | void;
  onSaved?: () => Promise<void> | void;
  onEntryDirtyChange: (id: string, dirty: boolean) => void;
  onMeasuredHeightChange: (id: string, height: number) => void;
  chromeState: Record<string, DiffChromeState | null>;
  onChromeChange: (id: string, chrome: DiffChromeState | null) => void;
  collapsedState: Record<string, boolean>;
  onToggleEntry: (id: string) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="all-diffs-group">
      <div className="all-diffs-group-body">
        {entries.map((entry) => {
          return (
            <DiffEntrySection
              key={entry.id}
              entry={entry}
              workspacePath={workspacePath}
              shouldMountDiff={mountedEntryIds.has(entry.id)}
              placeholderHeight={placeholderHeights[entry.id] ?? estimateExpandedBodyHeight(entry.file, entry.category)}
              onOpenFile={onOpenFile}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
              onDiscardFile={onDiscardFile}
              onSaved={onSaved}
              onEntryDirtyChange={onEntryDirtyChange}
              onMeasuredHeightChange={onMeasuredHeightChange}
              chromeState={chromeState[entry.id] ?? null}
              onChromeChange={onChromeChange}
              isCollapsed={collapsedState[entry.id] ?? true}
              onToggleEntry={onToggleEntry}
            />
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
  collapseAllRequest = 0,
  expandAllRequest = 0,
  onOpenFile,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onSaved,
  onSelectionChange,
  onDirtyChange,
  onAllCollapsedChange,
}: AllDiffsViewProps) {
  const lastHandledCollapseRequestRef = useRef(0);
  const lastHandledExpandRequestRef = useRef(0);
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
  const [chromeState, setChromeState] = useState<Record<string, DiffChromeState | null>>({});
  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>({});
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({});
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState({ scrollTop: 0, clientHeight: 1 });

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
    setChromeState((currentState) => {
      const nextState: Record<string, DiffChromeState | null> = {};
      let changed = false;

      for (const entry of entries) {
        if (entry.id in currentState) {
          nextState[entry.id] = currentState[entry.id];
        } else {
          nextState[entry.id] = null;
          changed = true;
        }
      }

      const currentKeys = Object.keys(currentState);
      const nextKeys = Object.keys(nextState);
      if (currentKeys.length !== nextKeys.length) {
        changed = true;
      } else {
        changed = currentKeys.some((key) => currentState[key] !== nextState[key]);
      }

      return changed ? nextState : currentState;
    });
  }, [entries]);

  useEffect(() => {
    setMeasuredHeights((currentState) => {
      const nextState: Record<string, number> = {};
      let changed = false;

      for (const entry of entries) {
        if (entry.id in currentState) {
          nextState[entry.id] = currentState[entry.id];
        }
      }

      const currentKeys = Object.keys(currentState);
      const nextKeys = Object.keys(nextState);
      if (currentKeys.length !== nextKeys.length) {
        changed = true;
      } else {
        changed = currentKeys.some((key) => currentState[key] !== nextState[key]);
      }

      return changed ? nextState : currentState;
    });
  }, [entries]);

  useEffect(() => {
    if (collapseAllRequest <= 0 || collapseAllRequest === lastHandledCollapseRequestRef.current) return;
    lastHandledCollapseRequestRef.current = collapseAllRequest;
    setCollapsedState((currentState) => {
      const nextState: Record<string, boolean> = {};
      let changed = false;

      for (const entry of entries) {
        nextState[entry.id] = true;
        if (currentState[entry.id] !== true) {
          changed = true;
        }
      }

      return changed ? nextState : currentState;
    });
  }, [collapseAllRequest, entries]);

  useEffect(() => {
    if (expandAllRequest <= 0 || expandAllRequest === lastHandledExpandRequestRef.current) return;
    lastHandledExpandRequestRef.current = expandAllRequest;
    setCollapsedState((currentState) => {
      const nextState: Record<string, boolean> = {};
      let changed = false;

      for (const entry of entries) {
        nextState[entry.id] = false;
        if (currentState[entry.id] !== false) {
          changed = true;
        }
      }

      return changed ? nextState : currentState;
    });
  }, [entries, expandAllRequest]);

  useEffect(() => {
    setCollapsedState((currentState) => {
      const nextState: Record<string, boolean> = {};
      let changed = false;

      for (const entry of entries) {
        if (entry.id in currentState) {
          nextState[entry.id] = currentState[entry.id];
        } else {
          nextState[entry.id] = true;
          changed = true;
        }
      }

      const currentKeys = Object.keys(currentState);
      const nextKeys = Object.keys(nextState);
      if (currentKeys.length !== nextKeys.length) {
        changed = true;
      } else {
        changed = currentKeys.some((key) => currentState[key] !== nextState[key]);
      }

      return changed ? nextState : currentState;
    });
  }, [entries]);

  useEffect(() => {
    onDirtyChange?.(Object.values(dirtyState).some(Boolean));
  }, [dirtyState, onDirtyChange]);

  useEffect(() => {
    const isAllCollapsed =
      entries.length === 0 || entries.every((entry) => (collapsedState[entry.id] ?? true) === true);
    onAllCollapsedChange?.(isAllCollapsed);
  }, [collapsedState, entries, onAllCollapsedChange]);

  const handleEntryDirtyChange = useCallback((id: string, dirty: boolean) => {
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
  }, []);

  const handleToggleEntry = useCallback((id: string) => {
    setCollapsedState((currentState) => ({
      ...currentState,
      [id]: !(currentState[id] ?? true),
    }));
  }, []);

  const handleChromeChange = useCallback((id: string, chrome: DiffChromeState | null) => {
    setChromeState((currentState) => {
      if (currentState[id] === chrome) return currentState;
      return {
        ...currentState,
        [id]: chrome,
      };
    });
  }, []);

  const handleMeasuredHeightChange = useCallback((id: string, height: number) => {
    setMeasuredHeights((currentState) => {
      if (Math.abs((currentState[id] ?? 0) - height) <= 1) return currentState;
      return {
        ...currentState,
        [id]: height,
      };
    });
  }, []);

  useEffect(() => {
    const scrollRoot = scrollRootRef.current;
    if (!scrollRoot) return;

    const sync = () => {
      setScrollState((current) => {
        const next = {
          scrollTop: scrollRoot.scrollTop,
          clientHeight: Math.max(scrollRoot.clientHeight, 1),
        };
        return current.scrollTop === next.scrollTop && current.clientHeight === next.clientHeight
          ? current
          : next;
      });
    };

    sync();
    scrollRoot.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(scrollRoot);
    return () => {
      scrollRoot.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, []);

  const mountedEntryIds = useMemo(() => {
    const next = new Set<string>();
    const viewportTop = scrollState.scrollTop - ALL_DIFFS_MOUNT_BUFFER;
    const viewportBottom = scrollState.scrollTop + scrollState.clientHeight + ALL_DIFFS_MOUNT_BUFFER;
    let offset = 0;

    for (const entry of entries) {
      const isCollapsed = collapsedState[entry.id] ?? true;
      const bodyHeight = isCollapsed
        ? 0
        : measuredHeights[entry.id] ?? estimateExpandedBodyHeight(entry.file, entry.category);
      const totalHeight = ALL_DIFFS_HEADER_HEIGHT + bodyHeight;
      const top = offset;
      const bottom = offset + totalHeight;

      if (!isCollapsed && bottom >= viewportTop && top <= viewportBottom) {
        next.add(entry.id);
      }

      offset = bottom;
    }

    return next;
  }, [collapsedState, entries, measuredHeights, scrollState.clientHeight, scrollState.scrollTop]);

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
      <div className="all-diffs-scroll" ref={scrollRootRef}>
        <DiffGroup
          entries={unstagedEntries}
          workspacePath={workspacePath}
          mountedEntryIds={mountedEntryIds}
          placeholderHeights={measuredHeights}
          onOpenFile={onOpenFile}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          onDiscardFile={onDiscardFile}
          onSaved={onSaved}
          onEntryDirtyChange={handleEntryDirtyChange}
          onMeasuredHeightChange={handleMeasuredHeightChange}
          chromeState={chromeState}
          onChromeChange={handleChromeChange}
          collapsedState={collapsedState}
          onToggleEntry={handleToggleEntry}
        />
        <DiffGroup
          entries={stagedEntries}
          workspacePath={workspacePath}
          mountedEntryIds={mountedEntryIds}
          placeholderHeights={measuredHeights}
          onOpenFile={onOpenFile}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          onDiscardFile={onDiscardFile}
          onSaved={onSaved}
          onEntryDirtyChange={handleEntryDirtyChange}
          onMeasuredHeightChange={handleMeasuredHeightChange}
          chromeState={chromeState}
          onChromeChange={handleChromeChange}
          collapsedState={collapsedState}
          onToggleEntry={handleToggleEntry}
        />
      </div>
    </div>
  );
}
