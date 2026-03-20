import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, GitBranch, RefreshCw, Tag } from "lucide-react";
import type { GitRefKind } from "./gitTypes";
import { useGitBranchRefs } from "./useGitBranchRefs";

type GitBranchRefsPanelTab = "local" | "remote" | "tag";

type GitBranchRefsPanelProps = {
  workspacePath: string;
  active: boolean;
  enabled: boolean;
  refreshToken: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onAfterCheckout?: () => Promise<unknown> | void;
};

type GitBranchRefsListItem = {
  kind: GitRefKind;
  name: string;
  meta: string | null;
  isCurrent: boolean;
};

export function GitBranchRefsPanel({
  workspacePath,
  active,
  enabled,
  refreshToken,
  expanded,
  onToggleExpanded,
  onAfterCheckout,
}: GitBranchRefsPanelProps) {
  const [activeTab, setActiveTab] = useState<GitBranchRefsPanelTab>("local");
  const gitBranchRefs = useGitBranchRefs({
    workspacePath,
    active,
    enabled,
    refreshToken,
    onAfterCheckout,
  });

  const currentRefName = gitBranchRefs.branchRefs?.current ?? "HEAD";
  const items = useMemo<GitBranchRefsListItem[]>(() => {
    if (!gitBranchRefs.branchRefs) return [];

    if (activeTab === "local") {
      return gitBranchRefs.branchRefs.local.map((name) => ({
        kind: "local" as const,
        name,
        meta: name === currentRefName ? "current branch" : null,
        isCurrent: name === currentRefName,
      }));
    }

    if (activeTab === "remote") {
      return gitBranchRefs.branchRefs.remote.map((name) => ({
        kind: "remote" as const,
        name,
        meta: null,
        isCurrent: false,
      }));
    }

    return gitBranchRefs.branchRefs.tags.map((name) => ({
      kind: "tag" as const,
      name,
      meta: null,
      isCurrent: false,
    }));
  }, [activeTab, currentRefName, gitBranchRefs.branchRefs]);

  const emptyLabel =
    activeTab === "local"
      ? "No local branches"
      : activeTab === "remote"
        ? "No remote branches"
        : "No tags";

  if (!expanded) {
    return (
      <section className="git-branch-refs-panel is-collapsed">
        <button
          type="button"
          className="git-branch-refs-collapsed-bar"
          aria-expanded={false}
          onClick={onToggleExpanded}
        >
          <ChevronRight className="size-3.5" />
          <span className="git-branch-refs-collapsed-label">Local branches</span>
          <span className="git-branch-refs-divider">·</span>
          <span className="git-branch-refs-collapsed-label">Remotes</span>
          <span className="git-branch-refs-divider">·</span>
          <span className="git-branch-refs-collapsed-label">Tags</span>
        </button>
      </section>
    );
  }

  return (
    <section className="git-branch-refs-panel">
      <div className="git-branch-refs-header">
        <div className="git-branch-refs-header-main">
          <button
            type="button"
            className="git-branch-refs-toggle"
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <div role="tablist" aria-label="Git refs" className="git-branch-refs-tabs">
            <button
              type="button"
              role="tab"
              className="git-branch-refs-tab"
              data-active={activeTab === "local" ? "true" : undefined}
              aria-selected={activeTab === "local"}
              onClick={() => setActiveTab("local")}
            >
              Local branches
            </button>
            <span className="git-branch-refs-divider">·</span>
            <button
              type="button"
              role="tab"
              className="git-branch-refs-tab"
              data-active={activeTab === "remote" ? "true" : undefined}
              aria-selected={activeTab === "remote"}
              onClick={() => setActiveTab("remote")}
            >
              Remotes
            </button>
            <span className="git-branch-refs-divider">·</span>
            <button
              type="button"
              role="tab"
              className="git-branch-refs-tab"
              data-active={activeTab === "tag" ? "true" : undefined}
              aria-selected={activeTab === "tag"}
              onClick={() => setActiveTab("tag")}
            >
              Tags
            </button>
          </div>
        </div>
        <div className="git-branch-refs-header-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="git-branch-refs-refresh"
            aria-label="Refresh refs"
            disabled={!enabled || gitBranchRefs.pendingAction !== null || gitBranchRefs.isLoading}
            onClick={() => {
              void gitBranchRefs.refresh();
            }}
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                (gitBranchRefs.pendingAction === "refresh" || gitBranchRefs.isLoading) && "animate-spin",
              )}
            />
          </Button>
        </div>
      </div>

      {expanded && gitBranchRefs.error ? (
        <div className="git-branch-refs-feedback is-error">{gitBranchRefs.error}</div>
      ) : null}

      {expanded ? (
        <ScrollArea className="git-branch-refs-scroll">
          {!enabled ? (
            <div className="git-branch-refs-feedback">Refs are unavailable for this workspace.</div>
          ) : gitBranchRefs.isLoading && !gitBranchRefs.branchRefs ? (
            <div className="git-branch-refs-feedback">Loading refs...</div>
          ) : items.length === 0 ? (
            <div className="git-branch-refs-feedback">{emptyLabel}</div>
          ) : (
            <div className="git-branch-refs-list">
              {items.map((item) => (
                <button
                  key={`${item.kind}:${item.name}`}
                  type="button"
                  className="git-branch-refs-row"
                  data-current={item.isCurrent ? "true" : undefined}
                  disabled={
                    !enabled
                    || gitBranchRefs.pendingAction === "checkout"
                    || (item.kind === "local" && item.isCurrent)
                  }
                  onClick={() => {
                    void gitBranchRefs.checkoutRef(item.name, item.kind);
                  }}
                >
                  <span className="git-branch-refs-row-main">
                    {item.kind === "tag" ? <Tag className="size-3.5" /> : <GitBranch className="size-3.5" />}
                    <span className="git-branch-refs-row-copy">
                      <span className="git-branch-refs-row-title">{item.name}</span>
                      {item.meta ? <span className="git-branch-refs-row-meta">{item.meta}</span> : null}
                    </span>
                  </span>
                  <span className="git-branch-refs-row-kind">
                    {item.kind === "local"
                      ? "branch"
                      : item.kind === "remote"
                        ? "remote"
                        : "tag"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      ) : null}
    </section>
  );
}
