import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { openExternalUrl } from "./gitApi";
import { useFileIconUrl } from "./fileIcons";
import type { GitChangedFile, GitDiffCategory } from "./gitTypes";
import type { UseGitChangesResult } from "./useGitChanges";
import {
  AlertCircle,
  Check,
  FilePlus2,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  Minus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Undo2,
} from "lucide-react";

type ChangesPanelProps = {
  workspacePath: string;
  git: UseGitChangesResult;
  onOpenDiff: (file: GitChangedFile, category: GitDiffCategory) => void;
  onOpenAllDiffs: () => void;
};

function ChangeFileIcon({ path }: { path: string }) {
  const iconUrl = useFileIconUrl(path.split("/").pop() || path, false, false);

  if (!iconUrl) {
    return <FilePlus2 className="changes-file-icon-svg" />;
  }

  return <img src={iconUrl} alt="" className="changes-file-icon-img" draggable={false} />;
}

function getWorkspaceName(workspacePath: string) {
  const parts = workspacePath.split(/[\\/]/);
  return parts[parts.length - 1] || workspacePath;
}

function getStatusLabel(file: GitChangedFile, category: GitDiffCategory) {
  if (category === "staged") {
    switch (file.status) {
      case "added":
      case "untracked":
        return "A";
      case "deleted":
        return "D";
      case "renamed":
        return "R";
      case "copied":
        return "C";
      default:
        return "M";
    }
  }

  switch (file.status) {
    case "untracked":
    case "added":
      return "U";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    default:
      return "M";
  }
}

function IconActionButton({
  label,
  icon,
  disabled,
  className,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={className}
            disabled={disabled}
            aria-label={label}
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            {icon}
          </Button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function FileActions({
  category,
  file,
  disabled,
  onOpenDiff,
  onStage,
  onUnstage,
  onDiscard,
}: {
  category: GitDiffCategory;
  file: GitChangedFile;
  disabled: boolean;
  onOpenDiff: (file: GitChangedFile, category: GitDiffCategory) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
}) {
  const stageAction =
    category === "staged"
      ? {
          label: "Unstage Changes",
          onClick: () => onUnstage(file.path),
          icon: <Minus className="size-3.5" />,
        }
      : {
          label: "Stage Changes",
          onClick: () => onStage(file.path),
          icon: <FilePlus2 className="size-3.5" />,
        };

  return (
    <div className="changes-file-actions">
      <IconActionButton
        label={stageAction.label}
        icon={stageAction.icon}
        className="changes-file-action"
        disabled={disabled}
        onClick={stageAction.onClick}
      />
      {category === "unstaged" ? (
        <IconActionButton
          label="Discard Changes"
          icon={<Trash2 className="size-3.5" />}
          className="changes-file-action"
          disabled={disabled}
          onClick={() => onDiscard(file.path)}
        />
      ) : null}
      <IconActionButton
        label="Open Diff"
        icon={<GitBranch className="size-3.5" />}
        className="changes-file-action"
        disabled={disabled}
        onClick={() => onOpenDiff(file, category)}
      />
    </div>
  );
}

function FileRow({
  file,
  category,
  disabled,
  workspaceName,
  onOpenDiff,
  onStage,
  onUnstage,
  onDiscard,
}: {
  file: GitChangedFile;
  category: GitDiffCategory;
  disabled: boolean;
  workspaceName: string;
  onOpenDiff: (file: GitChangedFile, category: GitDiffCategory) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
}) {
  const pathParts = file.path.split("/");
  const name = pathParts[pathParts.length - 1] || file.path;
  const parent = pathParts.slice(0, -1).join("/");
  const locationLabel = [workspaceName, parent].filter(Boolean).join("/");
  const parentLabel = [locationLabel, file.oldPath ? file.oldPath : ""].filter(Boolean).join(" • ");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          className="changes-file-row"
          aria-label={`Open diff for ${file.path}`}
          onClick={() => onOpenDiff(file, category)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onOpenDiff(file, category);
          }}
        >
          <span className={cn("changes-file-status", `is-${file.status}`)} />
          <span className="changes-file-icon">
            <ChangeFileIcon path={file.path} />
          </span>
          <span
            className="changes-file-copy"
            title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
          >
            <span className="changes-file-name">{name}</span>
            {parentLabel ? <span className="changes-file-parent">{parentLabel}</span> : null}
          </span>
          <FileActions
            category={category}
            file={file}
            disabled={disabled}
            onOpenDiff={onOpenDiff}
            onStage={onStage}
            onUnstage={onUnstage}
            onDiscard={onDiscard}
          />
          <span className="changes-file-stats">
            {file.additions > 0 ? <span className="is-add">+{file.additions}</span> : null}
            {file.deletions > 0 ? <span className="is-del">-{file.deletions}</span> : null}
          </span>
          <span className={cn("changes-file-code", `is-${file.status}`)}>
            {getStatusLabel(file, category)}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {category === "staged" ? (
          <ContextMenuItem disabled={disabled} onClick={() => onUnstage(file.path)}>
            Unstage Changes
          </ContextMenuItem>
        ) : (
          <ContextMenuItem disabled={disabled} onClick={() => onStage(file.path)}>
            Stage Changes
          </ContextMenuItem>
        )}
        {category === "unstaged" ? (
          <ContextMenuItem disabled={disabled} onClick={() => onDiscard(file.path)}>
            Discard Changes
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem disabled={disabled} onClick={() => onOpenDiff(file, category)}>
          Open Diff
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CapabilityState({
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondaryAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
}) {
  return (
    <div className="changes-state-shell">
      <div className="changes-state-icon">
        <FolderGit2 className="size-6" />
      </div>
      <div className="changes-state-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="changes-state-actions">
        <Button type="button" size="sm" variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
        {secondaryLabel && onSecondaryAction ? (
          <Button type="button" size="sm" variant="ghost" onClick={onSecondaryAction}>
            {secondaryLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ChangesPanel({
  workspacePath,
  git,
  onOpenDiff,
  onOpenAllDiffs,
}: ChangesPanelProps) {
  const [commitMessage, setCommitMessage] = useState("");
  const combinedChanges = useMemo(() => git.combinedChanges, [git.combinedChanges]);
  const isBusy = git.pendingAction !== null;
  const hasStagedChanges = (git.status?.staged.length ?? 0) > 0;
  const hasAnyChanges = Boolean(git.status?.hasChanges);
  const canCommit = Boolean(commitMessage.trim()) && hasAnyChanges && !isBusy;
  const workspaceName = useMemo(() => getWorkspaceName(workspacePath), [workspacePath]);

  const handleDiscardFile = async (path: string) => {
    const confirmed = window.confirm(`Discard changes for "${path}"?`);
    if (!confirmed) return;
    await git.discardFile(path);
  };

  const handleDiscardAll = async () => {
    const confirmed = window.confirm("Discard all unstaged changes and remove untracked files?");
    if (!confirmed) return;
    await git.discardAll();
  };

  const handleCommit = async () => {
    if (!canCommit) return;
    if (!hasStagedChanges) {
      const stageResult = await git.stageAll();
      if (!stageResult.ok) return;
    }
    const result = await git.commit(commitMessage.trim());
    if (result.ok) {
      setCommitMessage("");
    }
  };

  const stagedSectionActions = [
    {
      label: "Open Changes",
      icon: <GitCompareArrows className="size-3.5" />,
      onClick: onOpenAllDiffs,
    },
    {
      label: "Unstage All Changes",
      icon: <Undo2 className="size-3.5" />,
      onClick: () => {
        void git.unstageAll();
      },
    },
  ];

  const unstagedSectionActions = [
    {
      label: "Open Changes",
      icon: <GitCompareArrows className="size-3.5" />,
      onClick: onOpenAllDiffs,
    },
    {
      label: "Discard All Changes",
      icon: <Trash2 className="size-3.5" />,
      onClick: () => {
        void handleDiscardAll();
      },
    },
    {
      label: "Stage All Changes",
      icon: <FilePlus2 className="size-3.5" />,
      onClick: () => {
        void git.stageAll();
      },
    },
  ];

  if (git.isLoading && !git.capability) {
    return (
      <div className="changes-loading">
        <RefreshCw className="size-4 animate-spin" />
        <span>Loading Source Control...</span>
      </div>
    );
  }

  if (git.capability?.status === "missing_git") {
    return (
      <CapabilityState
        title="Git is not installed"
        description="Source Control needs a system Git installation before this workspace can show changes."
        actionLabel="Install Git"
        onAction={() => {
          void openExternalUrl("https://git-scm.com");
        }}
        secondaryLabel="Refresh"
        onSecondaryAction={() => {
          void git.refresh();
        }}
      />
    );
  }

  if (git.capability?.status === "not_repository") {
    return (
      <CapabilityState
        title="Initialize Repository"
        description="This folder is not a Git repository yet. Initialize it to start using Source Control."
        actionLabel="Initialize Repository"
        onAction={() => {
          void git.initRepository();
        }}
        secondaryLabel="Refresh"
        onSecondaryAction={() => {
          void git.refresh();
        }}
      />
    );
  }

  if (git.capability?.status === "unsafe_repository") {
    return (
      <CapabilityState
        title="Git blocked this repository"
        description="Git marked this workspace as unsafe. Add it to safe.directory in your Git config to enable Source Control."
        actionLabel="Open Help"
        onAction={() => {
          void openExternalUrl(
            "https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory",
          );
        }}
        secondaryLabel="Refresh"
        onSecondaryAction={() => {
          void git.refresh();
        }}
      />
    );
  }

  if (git.capability?.status === "git_error") {
    return (
      <CapabilityState
        title="Git is unavailable"
        description={git.capability.message ?? "Git returned an unexpected error for this workspace."}
        actionLabel="Refresh"
        onAction={() => {
          void git.refresh();
        }}
      />
    );
  }

  return (
    <div className="changes-panel">
      <div className="changes-repository-row">
        <div className="changes-repository-main">
          <FolderGit2 className="size-4" />
          <span className="changes-repository-name">{workspaceName}</span>
        </div>
        <div className="changes-repository-meta">
          <span className="changes-branch-badge">
            <GitBranch className="size-3.5" />
            {git.status?.branch ?? "HEAD"}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="changes-repository-action"
                  aria-label="Refresh Source Control"
                  onClick={() => {
                    void git.refresh();
                  }}
                >
                  <RefreshCw
                    className={cn("size-3.5", git.pendingAction === "refresh" && "animate-spin")}
                  />
                </Button>
              }
            />
            <TooltipContent side="bottom">Refresh</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="changes-commit-box">
        <textarea
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          className="changes-commit-input"
          placeholder={`Message (${navigator.platform.toLowerCase().includes("mac") ? "Cmd" : "Ctrl"}+Enter to commit on "${git.status?.branch ?? "HEAD"}")`}
          rows={2}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void handleCommit();
            }
          }}
        />
        <div className="changes-commit-actions">
          <Button
            type="button"
            size="sm"
            variant="default"
            className="changes-commit-button"
            disabled={!canCommit}
            onClick={handleCommit}
          >
            <Check className="size-3.5" />
            Commit
          </Button>
        </div>
      </div>

      {git.error ? (
        <div className="changes-banner is-error">
          <AlertCircle className="size-4" />
          <span>{git.error}</span>
        </div>
      ) : null}

      {!git.status?.hasChanges ? (
        <div className="changes-empty">
          <FolderGit2 className="size-6" />
          <p>No changes detected</p>
        </div>
      ) : (
        <ScrollArea className="changes-sections">
          {(git.status?.staged.length ?? 0) > 0 ? (
            <section className="changes-section">
              <div className="changes-section-header">
                <div className="changes-section-title">
                  <span>Staged Changes</span>
                  <span>{git.status?.staged.length ?? 0}</span>
                </div>
                <div className="changes-section-actions">
                  {stagedSectionActions.map((action) => (
                    <IconActionButton
                      key={action.label}
                      label={action.label}
                      icon={action.icon}
                      className="changes-section-action"
                      disabled={isBusy}
                      onClick={action.onClick}
                    />
                  ))}
                </div>
              </div>
              <div className="changes-file-list">
                {(git.status?.staged ?? []).map((file) => (
                  <FileRow
                    key={`staged:${file.path}`}
                    file={file}
                    category="staged"
                    disabled={isBusy}
                    workspaceName={workspaceName}
                    onOpenDiff={onOpenDiff}
                    onStage={(path) => {
                      void git.stageFile(path);
                    }}
                    onUnstage={(path) => {
                      void git.unstageFile(path);
                    }}
                    onDiscard={handleDiscardFile}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {(combinedChanges.length ?? 0) > 0 ? (
            <section className="changes-section">
              <div className="changes-section-header">
                <div className="changes-section-title">
                  <span>Changes</span>
                  <span>{combinedChanges.length}</span>
                </div>
                <div className="changes-section-actions">
                  {unstagedSectionActions.map((action) => (
                    <IconActionButton
                      key={action.label}
                      label={action.label}
                      icon={action.icon}
                      className="changes-section-action"
                      disabled={isBusy}
                      onClick={action.onClick}
                    />
                  ))}
                </div>
              </div>
              <div className="changes-file-list">
                {combinedChanges.map((file) => (
                  <FileRow
                    key={`unstaged:${file.path}`}
                    file={file}
                    category="unstaged"
                    disabled={isBusy}
                    workspaceName={workspaceName}
                    onOpenDiff={onOpenDiff}
                    onStage={(path) => {
                      void git.stageFile(path);
                    }}
                    onUnstage={(path) => {
                      void git.unstageFile(path);
                    }}
                    onDiscard={handleDiscardFile}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </ScrollArea>
      )}

      {git.capability?.message && git.capability.status !== "available" ? (
        <div className="changes-banner is-muted">
          <TriangleAlert className="size-4" />
          <span>{git.capability.message}</span>
        </div>
      ) : null}
    </div>
  );
}
