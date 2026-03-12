import { invoke } from "@tauri-apps/api/core";
import { lazy, Suspense, useEffect, useState } from "react";
import type { SelectedLineRange } from "@pierre/diffs";
import { formatWorkspacePath, type WorkspaceContext } from "../../lib/mock-data/workbench";

const LazyPatchDiff = lazy(async () => {
  const module = await import("@pierre/diffs/react");
  return { default: module.PatchDiff };
});

type DiffPanelProps = {
  workspace: WorkspaceContext;
  filePath: string | null;
  onOpenEditor: (filePath: string, line?: number) => void;
  refreshNonce?: number;
};

type GitDiffResponse = {
  path: string;
  diff: string;
  isGitRepo: boolean;
};

function getFirstChangedLine(diffText: string) {
  const match = diffText.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m);
  if (!match) {
    return undefined;
  }

  const line = Number.parseInt(match[1], 10);
  return Number.isFinite(line) && line > 0 ? line : undefined;
}

export function DiffPanel({ workspace, filePath, onOpenEditor, refreshNonce }: DiffPanelProps) {
  const [diffText, setDiffText] = useState("");
  const [isGitRepo, setIsGitRepo] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">("split");
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);
  const [selectedJumpLine, setSelectedJumpLine] = useState<number | null>(null);

  useEffect(() => {
    if (!filePath) {
      setDiffText("");
      setErrorMessage(null);
      setIsLoading(false);
      setSelectedLines(null);
      setSelectedJumpLine(null);
      return;
    }

    let isMounted = true;

    async function loadDiff() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const result = await invoke<GitDiffResponse>("read_git_diff", {
          payload: {
            workspacePath: workspace.path,
            filePath
          }
        });

        if (!isMounted) {
          return;
        }

        setIsGitRepo(result.isGitRepo);
        setDiffText(result.diff);
        setSelectedLines(null);
        setSelectedJumpLine(null);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setDiffText("");
        setSelectedJumpLine(null);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load diff.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadDiff();

    return () => {
      isMounted = false;
    };
  }, [filePath, refreshNonce, workspace.path]);

  return (
    <section className="diff-panel">
      {filePath ? (
        <div className="editor-header">
          <div className="editor-title-row">
            <span className="editor-file-name">{filePath.split("/").pop()}</span>
            <span className="editor-file-path">
              {formatWorkspacePath(`${workspace.path}/${filePath}`)}
            </span>
          </div>
          <div className="sub-toolbar-actions">
            <div className="editor-message">
              {isLoading ? "loading diff" : isGitRepo ? "git diff" : "not a git repository"}
            </div>
            <button
              type="button"
              className="editor-save-button"
              onClick={() => onOpenEditor(filePath, selectedJumpLine ?? getFirstChangedLine(diffText))}
            >
              {selectedJumpLine ? `Open line ${selectedJumpLine}` : "Open in Editor"}
            </button>
          </div>
        </div>
      ) : null}

      {!filePath ? (
        <div className="editor-empty-state">
          <p className="editor-empty-title">No diff selected</p>
          <p className="editor-empty-copy">Choose a changed file from the Changes panel to inspect its patch.</p>
        </div>
      ) : errorMessage ? (
        <div className="editor-empty-state">
          <p className="editor-empty-title">Unable to load diff</p>
          <p className="editor-empty-copy">{errorMessage}</p>
        </div>
      ) : !diffText ? (
        <div className="editor-empty-state">
          <p className="editor-empty-title">No diff available</p>
          <p className="editor-empty-copy">This file currently has no visible patch in the working tree.</p>
        </div>
      ) : (
        <div className="diff-surface">
          <div className="diff-controls">
            <button
              type="button"
              className={`diff-mode-button${diffStyle === "split" ? " is-active" : ""}`}
              onClick={() => setDiffStyle("split")}
            >
              Split
            </button>
            <button
              type="button"
              className={`diff-mode-button${diffStyle === "unified" ? " is-active" : ""}`}
              onClick={() => setDiffStyle("unified")}
            >
              Unified
            </button>
          </div>
          <Suspense fallback={<div className="diff-loading-state">Loading diff viewer...</div>}>
            <LazyPatchDiff
              patch={diffText}
              className="pierre-diff-root"
              selectedLines={selectedLines}
              options={{
                diffStyle,
                themeType: "dark",
                overflow: "scroll",
                diffIndicators: "bars",
                lineDiffType: "word",
                disableFileHeader: true,
                onLineClick: (props) => {
                  const line = props.lineNumber;
                  setSelectedLines({
                    start: line,
                    end: line,
                    side: props.annotationSide,
                    endSide: props.annotationSide
                  });
                  setSelectedJumpLine(line);
                }
              }}
            />
          </Suspense>
        </div>
      )}
    </section>
  );
}
