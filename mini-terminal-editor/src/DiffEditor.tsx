import { useEffect, useMemo, useRef, useState } from "react";
import { gitGetDiffContents } from "./gitApi";
import type { GitChangedFile, GitDiffCategory, GitDiffContents } from "./gitTypes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { Columns2, FoldVertical, List, RefreshCw } from "lucide-react";

type DiffViewMode = "side-by-side" | "inline";

type DiffEditorProps = {
  workspacePath: string;
  file: GitChangedFile;
  category: GitDiffCategory;
  refreshToken: number;
  embedded?: boolean;
};

function getLanguageExtension(path: string): Extension | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, () => Extension> = {
    js: () => javascript({ jsx: true }),
    jsx: () => javascript({ jsx: true }),
    ts: () => javascript({ typescript: true }),
    tsx: () => javascript({ jsx: true, typescript: true }),
    json: () => json(),
    html: () => html(),
    htm: () => html(),
    css: () => css(),
    scss: () => css(),
    md: () => markdown(),
    py: () => python(),
    xml: () => xml(),
  };
  const fn = map[ext];
  return fn ? fn() : null;
}

function useContainerWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setWidth(entry.contentRect.width);
    });

    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function MergeSurface({
  contents,
  path,
  viewMode,
  hideUnchanged,
}: {
  contents: GitDiffContents;
  path: string;
  viewMode: DiffViewMode;
  hideUnchanged: boolean;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const extensions = useMemo(() => {
    const language = getLanguageExtension(path);
    return [
      oneDark,
      lineNumbers(),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      ...(language ? [language] : []),
    ];
  }, [path]);

  useEffect(() => {
    const parent = surfaceRef.current;
    if (!parent) return;
    parent.innerHTML = "";

    if (viewMode === "side-by-side") {
      const mergeView = new MergeView({
        a: {
          doc: contents.original,
          extensions,
        },
        b: {
          doc: contents.modified,
          extensions,
        },
        parent,
        orientation: "a-b",
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: hideUnchanged ? { margin: 3, minSize: 4 } : undefined,
      });

      return () => mergeView.destroy();
    }

    const unifiedState = EditorState.create({
      doc: contents.modified,
      extensions: [
        ...extensions,
        unifiedMergeView({
          original: contents.original,
          gutter: true,
          mergeControls: false,
          collapseUnchanged: hideUnchanged ? { margin: 3, minSize: 4 } : undefined,
        }),
      ],
    });

    const view = new EditorView({
      state: unifiedState,
      parent,
    });

    return () => view.destroy();
  }, [contents.modified, contents.original, extensions, hideUnchanged, viewMode]);

  return <div ref={surfaceRef} className="diff-editor-surface" />;
}

export function DiffEditor({
  workspacePath,
  file,
  category,
  refreshToken,
  embedded = false,
}: DiffEditorProps) {
  const [contents, setContents] = useState<GitDiffContents | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferredMode, setPreferredMode] = useState<DiffViewMode>("side-by-side");
  const [hideUnchanged, setHideUnchanged] = useState(true);
  const { ref: containerRef, width } = useContainerWidth();
  const activeDiffTargetRef = useRef<string>("");
  const contentsRef = useRef<GitDiffContents | null>(null);

  const effectiveMode = width > 0 && width < 980 ? "inline" : preferredMode;

  useEffect(() => {
    contentsRef.current = contents;
  }, [contents]);

  useEffect(() => {
    let cancelled = false;
    const diffTarget = `${workspacePath}:${category}:${file.oldPath ?? ""}:${file.path}`;
    const isTargetSwitch = activeDiffTargetRef.current !== diffTarget;
    activeDiffTargetRef.current = diffTarget;
    const shouldShowLoading = isTargetSwitch || contentsRef.current === null;

    if (shouldShowLoading) {
      setIsLoading(true);
      setError(null);
    }

    gitGetDiffContents(workspacePath, file.path, category, file.oldPath)
      .then((nextContents) => {
        if (cancelled) return;
        setContents(nextContents);
        setError(null);
      })
      .catch((nextError) => {
        if (cancelled) return;
        if (shouldShowLoading || contentsRef.current === null) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!cancelled && shouldShowLoading) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [category, file.oldPath, file.path, refreshToken, workspacePath]);

  const banner = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;

  return (
    <div
      className={cn("diff-editor-shell", embedded && "diff-editor-shell-embedded")}
      ref={containerRef}
    >
      <div className="diff-editor-toolbar">
        <div className="diff-editor-meta">
          <span className={cn("diff-editor-category", `is-${category}`)}>{category}</span>
          <span className="diff-editor-path">{banner}</span>
        </div>
        <div className="diff-editor-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="diff-editor-action"
            aria-label="Inline diff"
            data-active={preferredMode === "inline" ? "true" : undefined}
            onClick={() => setPreferredMode("inline")}
          >
            <List className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="diff-editor-action"
            aria-label="Side by side diff"
            data-active={preferredMode === "side-by-side" ? "true" : undefined}
            onClick={() => setPreferredMode("side-by-side")}
          >
            <Columns2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="diff-editor-action"
            aria-label={hideUnchanged ? "Show all lines" : "Hide unchanged lines"}
            data-active={hideUnchanged ? "true" : undefined}
            onClick={() => setHideUnchanged((value) => !value)}
          >
            <FoldVertical className="size-3.5" />
          </Button>
        </div>
      </div>

      {width > 0 && width < 980 ? (
        <div className="diff-editor-notice">
          <RefreshCw className="size-3.5" />
          <span>Inline diff is active automatically in narrow editors.</span>
        </div>
      ) : null}

      <div className="diff-editor-body">
        {isLoading ? (
          <div className="diff-editor-state">Loading diff…</div>
        ) : error ? (
          <div className="diff-editor-state is-error">{error}</div>
        ) : !contents ? (
          <div className="diff-editor-state">Unable to load diff.</div>
        ) : contents.isBinary ? (
          <div className="diff-editor-state">
            This file is binary, so a text diff is not available.
          </div>
        ) : contents.isTooLarge ? (
          <div className="diff-editor-state">
            This diff is too large to render in the editor.
          </div>
        ) : (
          <MergeSurface
            contents={contents}
            path={file.path}
            viewMode={effectiveMode}
            hideUnchanged={hideUnchanged}
          />
        )}
      </div>
    </div>
  );
}
