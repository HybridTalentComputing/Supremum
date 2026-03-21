import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GitBranch,
  LocateFixed,
  RefreshCw,
  Tag,
} from "lucide-react";
import { gitFetchAllRemotes, gitPull, gitPush } from "./gitApi";
import type { GitGraphCommit } from "./gitTypes";
import { useGitCommitGraph } from "./useGitCommitGraph";

const GIT_GRAPH_LANE_WIDTH = 12;
const GIT_GRAPH_ROW_HEIGHT = 26;
const GIT_GRAPH_NODE_RADIUS = 4;
const GIT_GRAPH_LANE_COLORS = [
  "#3794ff",
  "#53a6ff",
  "#77bbff",
  "#9d7dff",
  "#c586c0",
  "#d7ba7d",
];

type GitCommitGraphPanelProps = {
  workspacePath: string;
  active: boolean;
  enabled: boolean;
  refreshToken: number;
  expanded: boolean;
  onToggleExpanded: () => void;
};

type GitCommitGraphToolbarAction = "fetch" | "pull" | "push" | "refresh" | null;

type GitCommitGraphRefKind = "head" | "local" | "remote" | "tag" | "other";

type GitCommitGraphRef = {
  label: string;
  kind: GitCommitGraphRefKind;
};

type GitCommitGraphRow = {
  commit: GitGraphCommit;
  introducedLane: boolean;
  laneIndex: number;
  lanesBefore: string[];
  lanesAfter: string[];
  parentHashes: string[];
};

function getLaneColor(index: number) {
  return GIT_GRAPH_LANE_COLORS[index % GIT_GRAPH_LANE_COLORS.length];
}

function clampGraphIndex(index: number, maxLaneCount: number) {
  return Math.max(0, Math.min(index, maxLaneCount - 1));
}

function laneX(index: number) {
  return index * GIT_GRAPH_LANE_WIDTH + GIT_GRAPH_LANE_WIDTH / 2;
}

function insertCommitLane(lanes: string[], hash: string, preferredIndex: number) {
  const existingIndex = lanes.indexOf(hash);
  if (existingIndex !== -1) {
    if (existingIndex === preferredIndex) {
      return;
    }
    const existingHash = lanes.splice(existingIndex, 1)[0];
    if (!existingHash) return;
    lanes.splice(Math.min(preferredIndex, lanes.length), 0, existingHash);
    return;
  }

  lanes.splice(Math.min(preferredIndex, lanes.length), 0, hash);
}

function buildGitCommitGraphRows(commits: GitGraphCommit[]) {
  const visibleHashes = new Set(commits.map((commit) => commit.hash));
  const rows: GitCommitGraphRow[] = [];
  let activeLanes: string[] = [];

  for (const commit of commits) {
    let introducedLane = false;
    const lanesBefore = [...activeLanes];
    let laneIndex = lanesBefore.indexOf(commit.hash);

    if (laneIndex === -1) {
      introducedLane = true;
      laneIndex = lanesBefore.length;
      lanesBefore.push(commit.hash);
    }

    const parentHashes = commit.parents.filter((hash) => visibleHashes.has(hash));
    const lanesAfter = [...lanesBefore];
    lanesAfter.splice(laneIndex, 1);

    if (parentHashes.length > 0) {
      insertCommitLane(lanesAfter, parentHashes[0], laneIndex);
      for (let index = 1; index < parentHashes.length; index += 1) {
        insertCommitLane(lanesAfter, parentHashes[index], laneIndex + index);
      }
    }

    rows.push({
      commit,
      introducedLane,
      laneIndex,
      lanesBefore,
      lanesAfter,
      parentHashes,
    });

    activeLanes = lanesAfter.filter((hash, index) => lanesAfter.indexOf(hash) === index);
  }

  const maxLaneCount = Math.max(
    1,
    ...rows.map((row) => Math.max(row.lanesBefore.length, row.lanesAfter.length)),
  );

  return { rows, maxLaneCount };
}

function parseGitCommitRefs(refs: string[]) {
  return refs.reduce<GitCommitGraphRef[]>((items, rawRef) => {
    const label = rawRef.trim();
    if (!label) return items;

    if (label.startsWith("HEAD -> ")) {
      items.push({
        label: label.slice("HEAD -> ".length),
        kind: "head",
      });
      return items;
    }

    if (label === "HEAD") {
      items.push({
        label,
        kind: "head",
      });
      return items;
    }

    if (label.startsWith("tag: ")) {
      items.push({
        label: label.slice("tag: ".length),
        kind: "tag",
      });
      return items;
    }

    items.push({
      label,
      kind: label.includes("/") ? "remote" : "local",
    });
    return items;
  }, []);
}

function getGitCommitGraphRefClassName(kind: GitCommitGraphRefKind) {
  switch (kind) {
    case "head":
      return "git-commit-graph-ref is-head";
    case "tag":
      return "git-commit-graph-ref is-tag";
    case "remote":
      return "git-commit-graph-ref is-remote";
    case "local":
      return "git-commit-graph-ref is-local";
    default:
      return "git-commit-graph-ref";
  }
}

function GitCommitGraphRowView({
  row,
  maxLaneCount,
  rowRef,
}: {
  row: GitCommitGraphRow;
  maxLaneCount: number;
  rowRef?: (node: HTMLDivElement | null) => void;
}) {
  const centerY = GIT_GRAPH_ROW_HEIGHT / 2;
  const graphWidth = Math.max(1, maxLaneCount) * GIT_GRAPH_LANE_WIDTH;
  const topLaneIndexes = row.lanesBefore.map((_, index) => index);
  const refs = parseGitCommitRefs(row.commit.refs);
  const rowTitle = `${row.commit.subject}\n${row.commit.authorName} · ${row.commit.authorRelativeTime}\n${row.commit.hash}`;

  return (
    <div className="git-commit-graph-row" title={rowTitle} ref={rowRef}>
      <div className="git-commit-graph-visual" aria-hidden="true">
        <svg
          className="git-commit-graph-svg"
          width={graphWidth}
          height={GIT_GRAPH_ROW_HEIGHT}
          viewBox={`0 0 ${graphWidth} ${GIT_GRAPH_ROW_HEIGHT}`}
        >
          {topLaneIndexes.map((laneIndex) => {
            const hash = row.lanesBefore[laneIndex];
            if (hash === row.commit.hash || !row.lanesAfter.includes(hash)) return null;
            const fromX = laneX(laneIndex);
            const toX = laneX(row.lanesAfter.indexOf(hash));
            return (
              <line
                key={`carry:${hash}`}
                x1={fromX}
                y1={0}
                x2={toX}
                y2={GIT_GRAPH_ROW_HEIGHT}
                stroke={getLaneColor(laneIndex)}
                strokeWidth={1.75}
                strokeLinecap="round"
                opacity={0.92}
              />
            );
          })}

          {!row.introducedLane ? (
            <line
              x1={laneX(row.laneIndex)}
              y1={0}
              x2={laneX(row.laneIndex)}
              y2={centerY}
              stroke={getLaneColor(row.laneIndex)}
              strokeWidth={1.75}
              strokeLinecap="round"
              opacity={0.92}
            />
          ) : null}

          {row.parentHashes.map((parentHash) => {
            const topIndex = row.lanesBefore.indexOf(parentHash);
            const bottomIndex = row.lanesAfter.indexOf(parentHash);

            if (topIndex !== -1 && bottomIndex === -1) {
              return (
                <line
                  key={`merge:${parentHash}`}
                  x1={laneX(topIndex)}
                  y1={0}
                  x2={laneX(row.laneIndex)}
                  y2={centerY}
                  stroke={getLaneColor(topIndex)}
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  opacity={0.92}
                />
              );
            }

            if (bottomIndex !== -1) {
              const laneIndex = clampGraphIndex(bottomIndex, maxLaneCount);
              return (
                <line
                  key={`parent:${parentHash}`}
                  x1={laneX(row.laneIndex)}
                  y1={centerY}
                  x2={laneX(laneIndex)}
                  y2={GIT_GRAPH_ROW_HEIGHT}
                  stroke={getLaneColor(laneIndex)}
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  opacity={0.96}
                />
              );
            }

            return null;
          })}

          <circle
            cx={laneX(row.laneIndex)}
            cy={centerY}
            r={GIT_GRAPH_NODE_RADIUS}
            fill="#0b0f14"
            stroke={getLaneColor(row.laneIndex)}
            strokeWidth={2}
          />
          {row.commit.isHead ? (
            <circle
              cx={laneX(row.laneIndex)}
              cy={centerY}
              r={2.05}
              fill={getLaneColor(row.laneIndex)}
            />
          ) : null}
        </svg>
      </div>

      <div className="git-commit-graph-copy">
        <div className="git-commit-graph-subject-row">
          <span className="git-commit-graph-subject">{row.commit.subject}</span>
          {refs.slice(0, 3).map((ref) => (
            <span
              key={`${row.commit.hash}:${ref.label}`}
              className={getGitCommitGraphRefClassName(ref.kind)}
            >
              {ref.kind === "tag" ? <Tag className="size-3" /> : <GitBranch className="size-3" />}
              <span>{ref.label}</span>
            </span>
          ))}
          {refs.length > 3 ? (
            <span className="git-commit-graph-overflow">+{refs.length - 3}</span>
          ) : null}
        </div>
        <div className="git-commit-graph-meta">
          <span className="git-commit-graph-hash">{row.commit.shortHash}</span>
          <span>{row.commit.authorRelativeTime}</span>
        </div>
      </div>
    </div>
  );
}

export function GitCommitGraphPanel({
  workspacePath,
  active,
  enabled,
  refreshToken,
  expanded,
  onToggleExpanded,
}: GitCommitGraphPanelProps) {
  const currentHistoryItemRef = useRef<HTMLDivElement | null>(null);
  const [toolbarAction, setToolbarAction] = useState<GitCommitGraphToolbarAction>(null);
  const [toolbarError, setToolbarError] = useState<string | null>(null);
  const gitCommitGraph = useGitCommitGraph({
    workspacePath,
    active,
    enabled,
    refreshToken,
  });

  const commits = gitCommitGraph.graph?.commits ?? [];
  const { rows, maxLaneCount } = useMemo(() => buildGitCommitGraphRows(commits), [commits]);
  const currentCommitHash = commits.find((commit) => commit.isHead)?.hash ?? null;

  const runToolbarAction = async (
    action: Exclude<GitCommitGraphToolbarAction, "refresh" | null>,
    operation: () => Promise<void>,
  ) => {
    setToolbarAction(action);
    setToolbarError(null);

    try {
      await operation();
      await gitCommitGraph.refresh();
    } catch (error) {
      setToolbarError(error instanceof Error ? error.message : String(error));
    } finally {
      setToolbarAction(null);
    }
  };

  const handleGoToCurrentHistoryItem = () => {
    currentHistoryItemRef.current?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  };

  return (
    <section className={cn("git-commit-graph-section", !expanded && "is-collapsed")}>
      <div className="git-commit-graph-header">
        <button
          type="button"
          className="git-commit-graph-title git-commit-graph-toggle"
          aria-expanded={expanded}
          onClick={onToggleExpanded}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span>Graph</span>
        </button>
        <div className="git-commit-graph-header-meta">
          <span className="git-commit-graph-mode">Auto</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="git-commit-graph-refresh"
                  aria-label="Go to Current History Item"
                  disabled={!enabled || !currentCommitHash}
                  onClick={handleGoToCurrentHistoryItem}
                >
                  <LocateFixed className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent side="top">Go to Current History Item</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="git-commit-graph-refresh"
                  aria-label="Fetch from All Remotes"
                  disabled={!enabled || toolbarAction !== null}
                  onClick={() => {
                    void runToolbarAction("fetch", () => gitFetchAllRemotes(workspacePath));
                  }}
                >
                  <GitBranch className={cn("size-3.5", toolbarAction === "fetch" && "animate-spin")} />
                </Button>
              }
            />
            <TooltipContent side="top">Fetch from All Remotes</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="git-commit-graph-refresh"
                  aria-label="Pull"
                  disabled={!enabled || toolbarAction !== null}
                  onClick={() => {
                    void runToolbarAction("pull", () => gitPull(workspacePath));
                  }}
                >
                  <ArrowDown className={cn("size-3.5", toolbarAction === "pull" && "animate-spin")} />
                </Button>
              }
            />
            <TooltipContent side="top">Pull</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="git-commit-graph-refresh"
                  aria-label="Push"
                  disabled={!enabled || toolbarAction !== null}
                  onClick={() => {
                    void runToolbarAction("push", () => gitPush(workspacePath));
                  }}
                >
                  <ArrowUp className={cn("size-3.5", toolbarAction === "push" && "animate-spin")} />
                </Button>
              }
            />
            <TooltipContent side="top">Push</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="git-commit-graph-refresh"
                  aria-label="Refresh"
                  disabled={!enabled || toolbarAction !== null || gitCommitGraph.isLoading}
                  onClick={() => {
                    setToolbarAction("refresh");
                    setToolbarError(null);
                    void gitCommitGraph.refresh().finally(() => {
                      setToolbarAction(null);
                    });
                  }}
                >
                  <RefreshCw
                    className={cn(
                      "size-3.5",
                      (toolbarAction === "refresh" || gitCommitGraph.isLoading) && "animate-spin",
                    )}
                  />
                </Button>
              }
            />
            <TooltipContent side="top">Refresh</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {!enabled && expanded ? (
        <div className="git-commit-graph-feedback">Commit history is unavailable for this workspace.</div>
      ) : null}
      {enabled && gitCommitGraph.error && expanded ? (
        <div className="git-commit-graph-feedback is-error">{gitCommitGraph.error}</div>
      ) : null}
      {enabled && toolbarError && expanded ? (
        <div className="git-commit-graph-feedback is-error">{toolbarError}</div>
      ) : null}

      {expanded && enabled ? (
        <ScrollArea className="git-commit-graph-scroll">
          {commits.length === 0 ? (
            <div className="git-commit-graph-feedback">
              {!gitCommitGraph.hasLoaded ? "Loading commit history..." : "No commits yet"}
            </div>
          ) : (
            <div className="git-commit-graph-list">
              {rows.map((row) => (
                <GitCommitGraphRowView
                  key={row.commit.hash}
                  row={row}
                  maxLaneCount={maxLaneCount}
                  rowRef={
                    row.commit.hash === currentCommitHash
                      ? (node) => {
                          currentHistoryItemRef.current = node;
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </ScrollArea>
      ) : null}
    </section>
  );
}
