import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gitGetDiffContents } from "./gitApi";
import type { GitChangedFile, GitDiffCategory, GitDiffContents } from "./gitTypes";
import {
  getDiffSideLabels,
  getGitStatusCode,
  isDiffEditable,
} from "./diffPresentation";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import {
  getChunks,
  goToNextChunk,
  goToPreviousChunk,
  MergeView,
  type Chunk,
  unifiedMergeView,
} from "@codemirror/merge";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  FoldVertical,
  List,
} from "lucide-react";

type DiffViewMode = "side-by-side" | "inline";

type DiffEditorProps = {
  workspacePath: string;
  file: GitChangedFile;
  category: GitDiffCategory;
  refreshToken: number;
  embedded?: boolean;
  onOpenFile?: (path: string) => Promise<void> | void;
  onStageFile?: (path: string) => Promise<unknown> | void;
  onUnstageFile?: (path: string) => Promise<unknown> | void;
  onDiscardFile?: (path: string) => Promise<unknown> | void;
  onSaved?: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
};

type MergeSurfaceState = {
  view: EditorView | null;
  chunks: readonly Chunk[];
  activeChunkIndex: number;
  docLength: number;
};

type ScrollPreviewState = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

function ToolbarTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

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

function resolveActiveChunkIndex(head: number, chunks: readonly Chunk[]) {
  if (chunks.length === 0) return -1;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const from = chunk.fromB;
    const to = Math.max(chunk.fromB + 1, chunk.toB);

    if (head <= to) {
      return index;
    }

    if (index < chunks.length - 1 && head < chunks[index + 1].fromB) {
      return index;
    }
  }

  return chunks.length - 1;
}

function readMergeSurfaceState(view: EditorView | null): MergeSurfaceState {
  if (!view) {
    return {
      view: null,
      chunks: [],
      activeChunkIndex: -1,
      docLength: 1,
    };
  }

  const info = getChunks(view.state);
  const chunks = info?.chunks ?? [];

  return {
    view,
    chunks,
    activeChunkIndex: resolveActiveChunkIndex(view.state.selection.main.head, chunks),
    docLength: Math.max(1, view.state.doc.length),
  };
}

function MergeSurface({
  contents,
  modifiedContent,
  path,
  viewMode,
  hideUnchanged,
  editable,
  onEdit,
  onSave,
  onViewStateChange,
}: {
  contents: GitDiffContents;
  modifiedContent: string;
  path: string;
  viewMode: DiffViewMode;
  hideUnchanged: boolean;
  editable: boolean;
  onEdit: (value: string) => void;
  onSave: () => void;
  onViewStateChange: (state: MergeSurfaceState) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const onEditRef = useRef(onEdit);
  const onSaveRef = useRef(onSave);
  const onViewStateChangeRef = useRef(onViewStateChange);

  useEffect(() => {
    onEditRef.current = onEdit;
  }, [onEdit]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onViewStateChangeRef.current = onViewStateChange;
  }, [onViewStateChange]);

  const extensions = useMemo(() => {
    const language = getLanguageExtension(path);
    return [
      oneDark,
      lineNumbers(),
      ...(language ? [language] : []),
    ];
  }, [path]);

  useEffect(() => {
    const parent = surfaceRef.current;
    if (!parent) return;
    parent.innerHTML = "";

    if (viewMode === "side-by-side") {
      const emitViewState = (view: EditorView) => {
        onViewStateChangeRef.current(readMergeSurfaceState(view));
      };

      const mergeView = new MergeView({
        a: {
          doc: contents.original,
          extensions: [
            ...extensions,
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
          ],
        },
        b: {
          doc: modifiedContent,
          extensions: [
            ...extensions,
            history(),
            EditorView.editable.of(editable),
            EditorState.readOnly.of(!editable),
            EditorView.updateListener.of((update) => {
              if (editable && update.docChanged) {
                onEditRef.current(update.state.doc.toString());
              }
              if (update.docChanged || update.selectionSet || update.focusChanged) {
                emitViewState(update.view);
              }
            }),
            keymap.of([
              ...defaultKeymap,
              ...historyKeymap,
              indentWithTab,
              {
                key: "Mod-s",
                preventDefault: true,
                run: () => {
                  onSaveRef.current();
                  return true;
                },
              },
            ]),
          ],
        },
        parent,
        orientation: "a-b",
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: hideUnchanged ? { margin: 3, minSize: 4 } : undefined,
      });

      emitViewState(mergeView.b);

      return () => {
        onViewStateChangeRef.current(readMergeSurfaceState(null));
        mergeView.destroy();
      };
    }

    const unifiedState = EditorState.create({
      doc: modifiedContent,
      extensions: [
        ...extensions,
        history(),
        EditorView.editable.of(editable),
        EditorState.readOnly.of(!editable),
        EditorView.updateListener.of((update) => {
          if (editable && update.docChanged) {
            onEditRef.current(update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet || update.focusChanged) {
            onViewStateChangeRef.current(readMergeSurfaceState(update.view));
          }
        }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
        ]),
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

    onViewStateChangeRef.current(readMergeSurfaceState(view));

    return () => {
      onViewStateChangeRef.current(readMergeSurfaceState(null));
      view.destroy();
    };
  }, [contents.original, editable, extensions, hideUnchanged, modifiedContent, viewMode]);

  return <div ref={surfaceRef} className="diff-editor-surface" />;
}

export function DiffEditor({
  workspacePath,
  file,
  category,
  refreshToken,
  embedded = false,
  onSaved,
  onDirtyChange,
}: DiffEditorProps) {
  const [contents, setContents] = useState<GitDiffContents | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferredMode, setPreferredMode] = useState<DiffViewMode>("side-by-side");
  const [hideUnchanged, setHideUnchanged] = useState(true);
  const [modifiedContent, setModifiedContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [mergeState, setMergeState] = useState<MergeSurfaceState>(readMergeSurfaceState(null));
  const [scrollPreview, setScrollPreview] = useState<ScrollPreviewState>({
    scrollTop: 0,
    scrollHeight: 1,
    clientHeight: 1,
  });
  const activeDiffTargetRef = useRef("");
  const contentsRef = useRef<GitDiffContents | null>(null);
  const dirtyRef = useRef(false);
  const editableModifiedRef = useRef("");
  const effectiveMode = preferredMode;

  const sideLabels = useMemo(() => getDiffSideLabels(file, category), [category, file]);
  const statusCode = getGitStatusCode(file.status);
  const editable = isDiffEditable(file, category) && !isLoading && !isSaving;
  const chunkCount = mergeState.chunks.length;
  const currentChunkNumber = mergeState.activeChunkIndex >= 0 ? mergeState.activeChunkIndex + 1 : 0;

  useEffect(() => {
    contentsRef.current = contents;
  }, [contents]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  useEffect(() => {
    const scrollDOM = mergeState.view?.scrollDOM;
    if (!scrollDOM) {
      setScrollPreview({
        scrollTop: 0,
        scrollHeight: 1,
        clientHeight: 1,
      });
      return;
    }

    const sync = () => {
      setScrollPreview({
        scrollTop: scrollDOM.scrollTop,
        scrollHeight: Math.max(scrollDOM.scrollHeight, 1),
        clientHeight: Math.max(scrollDOM.clientHeight, 1),
      });
    };

    sync();
    scrollDOM.addEventListener("scroll", sync);
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(scrollDOM);

    return () => {
      scrollDOM.removeEventListener("scroll", sync);
      resizeObserver.disconnect();
    };
  }, [mergeState.view]);

  useEffect(() => {
    let cancelled = false;
    const diffTarget = `${workspacePath}:${category}:${file.oldPath ?? ""}:${file.path}`;
    const isTargetSwitch = activeDiffTargetRef.current !== diffTarget;
    activeDiffTargetRef.current = diffTarget;
    const shouldShowLoading = isTargetSwitch || contentsRef.current === null;

    if (isTargetSwitch) {
      setDirty(false);
      dirtyRef.current = false;
    }

    if (shouldShowLoading) {
      setIsLoading(true);
      setError(null);
    }

    gitGetDiffContents(workspacePath, file.path, category, file.oldPath)
      .then((nextContents) => {
        if (cancelled) return;
        setContents(nextContents);
        if (!dirtyRef.current) {
          editableModifiedRef.current = nextContents.modified;
          setModifiedContent(nextContents.modified);
        }
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

  const handleSave = useCallback(async () => {
    if (!editable || !dirtyRef.current) return;
    setIsSaving(true);
    setError(null);
    try {
      await invoke("write_file", {
        payload: { workspacePath, path: file.path, content: editableModifiedRef.current },
      });
      setModifiedContent(editableModifiedRef.current);
      setDirty(false);
      await onSaved?.();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsSaving(false);
    }
  }, [editable, file.path, onSaved, workspacePath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  const handleEdit = useCallback((value: string) => {
    editableModifiedRef.current = value;
    if (!dirtyRef.current) {
      setDirty(true);
    }
  }, []);

  const navigateChunk = useCallback((direction: "next" | "previous") => {
    if (!mergeState.view) return;
    const command = direction === "next" ? goToNextChunk : goToPreviousChunk;
    command({
      state: mergeState.view.state,
      dispatch: mergeState.view.dispatch,
    });
  }, [mergeState.view]);

  const jumpToChunk = useCallback((index: number) => {
    const chunk = mergeState.chunks[index];
    if (!chunk || !mergeState.view) return;

    const anchor = Math.min(mergeState.view.state.doc.length, Math.max(0, chunk.fromB));
    mergeState.view.dispatch({
      selection: { anchor },
      scrollIntoView: true,
    });
    mergeState.view.focus();
  }, [mergeState.chunks, mergeState.view]);

  const overviewItems = useMemo(
    () =>
      mergeState.chunks.map((chunk, index) => {
        const top = `${(chunk.fromB / mergeState.docLength) * 100}%`;
        const height = `${Math.max(0.8, ((Math.max(chunk.toB, chunk.fromB + 1) - chunk.fromB) / mergeState.docLength) * 100)}%`;
        const kind =
          chunk.fromB === chunk.toB ? "deletion" : chunk.fromA === chunk.toA ? "addition" : "modification";

        return {
          id: `${chunk.fromA}:${chunk.toA}:${chunk.fromB}:${chunk.toB}`,
          top,
          height,
          kind,
          index,
          active: index === mergeState.activeChunkIndex,
        };
      }),
    [mergeState.activeChunkIndex, mergeState.chunks, mergeState.docLength],
  );
  const viewportTop = useMemo(() => {
    const maxScrollable = Math.max(scrollPreview.scrollHeight - scrollPreview.clientHeight, 1);
    return `${(scrollPreview.scrollTop / maxScrollable) * Math.max(0, 100 - (scrollPreview.clientHeight / scrollPreview.scrollHeight) * 100)}%`;
  }, [scrollPreview.clientHeight, scrollPreview.scrollHeight, scrollPreview.scrollTop]);
  const viewportHeight = useMemo(
    () => `${Math.max(8, (scrollPreview.clientHeight / scrollPreview.scrollHeight) * 100)}%`,
    [scrollPreview.clientHeight, scrollPreview.scrollHeight],
  );
  const toggleModeLabel =
    preferredMode === "side-by-side" ? "Switch to inline diff" : "Switch to side by side diff";
  const ToggleModeIcon = preferredMode === "side-by-side" ? Columns2 : List;

  return (
    <div className={cn("diff-editor-shell", embedded && "diff-editor-shell-embedded")}>
      <div className="diff-editor-toolbar">
        <div className="diff-editor-toolbar-state">
          <span className={cn("diff-editor-category", `is-${category}`)}>{sideLabels.categoryLabel}</span>
          <span className="diff-editor-toolbar-separator">•</span>
          <span className="diff-editor-status-code">{statusCode}</span>
          {editable ? (
            <>
              <span className="diff-editor-toolbar-separator">•</span>
              <span className="diff-editor-edit-state" data-dirty={dirty ? "true" : undefined}>
                {isSaving ? "Saving..." : dirty ? "Unsaved" : "Editable"}
              </span>
            </>
          ) : null}
        </div>
        <div className="diff-editor-actions">
          <ToolbarTooltip
            label={chunkCount > 0 ? `Change ${currentChunkNumber} of ${chunkCount}` : "No changes"}
          >
            <span className="diff-editor-chunk-count">
              {currentChunkNumber}/{chunkCount || 0}
            </span>
          </ToolbarTooltip>
          <ToolbarTooltip label="Previous change">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="diff-editor-action"
              aria-label="Previous change"
              disabled={chunkCount === 0}
              onClick={() => navigateChunk("previous")}
            >
              <ChevronUp className="size-3.5" />
            </Button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Next change">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="diff-editor-action"
              aria-label="Next change"
              disabled={chunkCount === 0}
              onClick={() => navigateChunk("next")}
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </ToolbarTooltip>
          <ToolbarTooltip label={toggleModeLabel}>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="diff-editor-action"
              aria-label={toggleModeLabel}
              data-active="true"
              onClick={() =>
                setPreferredMode((currentMode) =>
                  currentMode === "side-by-side" ? "inline" : "side-by-side",
                )
              }
            >
              <ToggleModeIcon className="size-3.5" />
            </Button>
          </ToolbarTooltip>
          <ToolbarTooltip label={hideUnchanged ? "Show unchanged lines" : "Hide unchanged lines"}>
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
          </ToolbarTooltip>
        </div>
      </div>

      {!isLoading &&
      !error &&
      contents &&
      !contents.isBinary &&
      !contents.isTooLarge &&
      effectiveMode === "side-by-side" ? (
        <div className="diff-editor-columns">
          <span>{sideLabels.left}</span>
          <span>{sideLabels.right}</span>
        </div>
      ) : null}

      <div className="diff-editor-body">
        <div className="diff-editor-main">
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
              modifiedContent={modifiedContent}
              path={file.path}
              viewMode={effectiveMode}
              hideUnchanged={hideUnchanged}
              editable={editable}
              onEdit={handleEdit}
              onSave={() => {
                void handleSave();
              }}
              onViewStateChange={setMergeState}
            />
          )}
        </div>
        {!isLoading && !error && chunkCount > 0 ? (
          <div className="diff-editor-overview" aria-label="Change overview">
            <div
              className="diff-editor-overview-viewport"
              style={{ top: viewportTop, height: viewportHeight }}
              aria-hidden
            />
            {overviewItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="diff-editor-overview-marker"
                data-kind={item.kind}
                data-active={item.active ? "true" : undefined}
                style={{ top: item.top, height: item.height }}
                onClick={() => jumpToChunk(item.index)}
                aria-label={`Jump to change ${item.index + 1}`}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
