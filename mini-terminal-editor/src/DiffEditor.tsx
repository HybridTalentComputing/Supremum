import {
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  leftView: EditorView | null;
  rightView: EditorView | null;
  chunks: readonly Chunk[];
  activeChunkIndex: number;
  docLength: number;
};

type ScrollPreviewState = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  contentHeight: number;
};

type OverviewSegment = {
  id: string;
  top: string;
  height: string;
  lane: "left" | "right";
  kind: "addition" | "deletion";
  active: boolean;
};

function getOverviewSegmentGeometry(
  view: EditorView,
  from: number,
  to: number,
  totalHeight: number,
) {
  const safeFrom = Math.max(0, Math.min(from, view.state.doc.length));
  const safeTo = Math.max(safeFrom, Math.min(Math.max(to - 1, safeFrom), view.state.doc.length));
  const startBlock = view.lineBlockAt(safeFrom);
  const endBlock = view.lineBlockAt(safeTo);
  const top = (startBlock.top / Math.max(totalHeight, 1)) * 100;
  const height = Math.max(0.14, ((endBlock.bottom - startBlock.top) / Math.max(totalHeight, 1)) * 100);

  return {
    top: `${top}%`,
    height: `${height}%`,
  };
}

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
      leftView: null,
      rightView: null,
      chunks: [],
      activeChunkIndex: -1,
      docLength: 1,
    };
  }

  const info = getChunks(view.state);
  const chunks = info?.chunks ?? [];

  return {
    view,
    leftView: view,
    rightView: view,
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
      const emitViewState = (activeView: EditorView, leftView: EditorView, rightView: EditorView) => {
        const base = readMergeSurfaceState(activeView);
        onViewStateChangeRef.current({
          ...base,
          leftView,
          rightView,
        });
      };

      const mergeView = new MergeView({
        a: {
          doc: contents.original,
          extensions: [
            ...extensions,
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
            EditorView.updateListener.of((update) => {
              if (update.docChanged || update.selectionSet || update.focusChanged) {
                emitViewState(update.view, update.view, mergeView.b);
              }
            }),
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
                emitViewState(update.view, mergeView.a, update.view);
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

      emitViewState(mergeView.b, mergeView.a, mergeView.b);

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
    contentHeight: 1,
  });
  const [overviewHeight, setOverviewHeight] = useState(1);
  const activeDiffTargetRef = useRef("");
  const contentsRef = useRef<GitDiffContents | null>(null);
  const dirtyRef = useRef(false);
  const editableModifiedRef = useRef("");
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const overviewRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRatioRef = useRef(0);
  const isDraggingOverviewRef = useRef(false);
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
    const scrollContainer = mainScrollRef.current;
    if (!scrollContainer) {
      setScrollPreview({
        scrollTop: 0,
        scrollHeight: 1,
        clientHeight: 1,
        contentHeight: 1,
      });
      return;
    }

    const sync = () => {
      const contentHeight = Math.max(
        mergeState.leftView?.contentHeight ?? 0,
        mergeState.rightView?.contentHeight ?? 0,
        1,
      );
      setScrollPreview({
        scrollTop: scrollContainer.scrollTop,
        scrollHeight: Math.max(scrollContainer.scrollHeight, 1),
        clientHeight: Math.max(scrollContainer.clientHeight, 1),
        contentHeight,
      });
    };

    sync();
    scrollContainer.addEventListener("scroll", sync);
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(scrollContainer);

    return () => {
      scrollContainer.removeEventListener("scroll", sync);
      resizeObserver.disconnect();
    };
  }, [contents, hideUnchanged, mergeState.view, preferredMode]);

  useEffect(() => {
    const overview = overviewRef.current;
    if (!overview) {
      setOverviewHeight(1);
      return;
    }

    const sync = () => {
      setOverviewHeight(Math.max(overview.clientHeight, 1));
    };

    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(overview);

    return () => {
      resizeObserver.disconnect();
    };
  }, [contents, hideUnchanged, preferredMode]);

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

  const overviewSegments = useMemo<OverviewSegment[]>(() => {
    if (!contents || !mergeState.leftView || !mergeState.rightView) return [];

    const totalHeight = Math.max(scrollPreview.contentHeight, 1);
    const segments: OverviewSegment[] = [];

    for (let index = 0; index < mergeState.chunks.length; index += 1) {
      const chunk = mergeState.chunks[index];
      const baseId = `${chunk.fromA}:${chunk.toA}:${chunk.fromB}:${chunk.toB}`;
      const kind =
        chunk.fromB === chunk.toB ? "deletion" : chunk.fromA === chunk.toA ? "addition" : "modification";
      const active = index === mergeState.activeChunkIndex;

      if (chunk.fromA !== chunk.toA || kind === "modification") {
        const geometry = getOverviewSegmentGeometry(
          mergeState.leftView,
          chunk.fromA,
          Math.max(chunk.toA, chunk.fromA + 1),
          totalHeight,
        );
        segments.push({
          id: `${baseId}:left`,
          top: geometry.top,
          height: geometry.height,
          lane: "left",
          kind: "deletion",
          active,
        });
      }

      if (chunk.fromB !== chunk.toB || kind === "modification") {
        const geometry = getOverviewSegmentGeometry(
          mergeState.rightView,
          chunk.fromB,
          Math.max(chunk.toB, chunk.fromB + 1),
          totalHeight,
        );
        segments.push({
          id: `${baseId}:right`,
          top: geometry.top,
          height: geometry.height,
          lane: "right",
          kind: "addition",
          active,
        });
      }
    }

    return segments;
  }, [
    contents,
    mergeState.activeChunkIndex,
    mergeState.chunks,
    mergeState.leftView,
    mergeState.rightView,
    scrollPreview.clientHeight,
    scrollPreview.contentHeight,
    scrollPreview.scrollHeight,
  ]);
  const fixedViewportHeightPx = 18;
  const maxScrollableContent = Math.max(scrollPreview.contentHeight - scrollPreview.clientHeight, 0);
  const viewportTopRatio = useMemo(() => {
    if (maxScrollableContent <= 0) {
      return 1;
    }
    return Math.max(0, Math.min(1, scrollPreview.scrollTop / maxScrollableContent));
  }, [maxScrollableContent, scrollPreview.scrollTop]);
  const viewportTop = useMemo(() => {
    const available = Math.max(overviewHeight - fixedViewportHeightPx, 0);
    return `${viewportTopRatio * available}px`;
  }, [overviewHeight, viewportTopRatio]);
  const viewportHeight = `${fixedViewportHeightPx}px`;
  const toggleModeLabel =
    preferredMode === "side-by-side" ? "Switch to inline diff" : "Switch to side by side diff";
  const ToggleModeIcon = preferredMode === "side-by-side" ? Columns2 : List;
  const viewportHeightRatio = Math.min(1, fixedViewportHeightPx / Math.max(overviewHeight, 1));

  const setOverviewScrollPosition = useCallback(
    (ratio: number) => {
      const scrollContainer = mainScrollRef.current;
      if (!scrollContainer) return;

      const maxScrollable = Math.max(scrollPreview.contentHeight - scrollContainer.clientHeight, 0);
      scrollContainer.scrollTop = Math.max(0, Math.min(maxScrollable, ratio * maxScrollable));
    },
    [scrollPreview.contentHeight],
  );

  const handleOverviewPointerPosition = useCallback(
    (clientY: number, preserveDragOffset: boolean) => {
      const overview = overviewRef.current;
      if (!overview) return;

      const rect = overview.getBoundingClientRect();
      if (rect.height <= 0) return;

      const pointerRatio = (clientY - rect.top) / rect.height;
      const nextRatio = preserveDragOffset
        ? pointerRatio - dragOffsetRatioRef.current
        : pointerRatio - viewportHeightRatio / 2;

      setOverviewScrollPosition(Math.max(0, Math.min(1, nextRatio / Math.max(1 - viewportHeightRatio, 0.0001))));
    },
    [setOverviewScrollPosition, viewportHeightRatio],
  );

  const handleOverviewPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const overview = overviewRef.current;
      if (!overview) return;

      const target = event.target as HTMLElement | null;
      const rect = overview.getBoundingClientRect();
      const offsetY = event.clientY - rect.top;
      const viewportPxHeight = rect.height * viewportHeightRatio;

      if (target?.dataset.overviewViewport === "true") {
        dragOffsetRatioRef.current = offsetY / rect.height - viewportTopRatio;
      } else {
        dragOffsetRatioRef.current = viewportPxHeight / 2 / rect.height;
      }

      isDraggingOverviewRef.current = true;
      overview.setPointerCapture(event.pointerId);
      handleOverviewPointerPosition(event.clientY, true);
      event.preventDefault();
    },
    [handleOverviewPointerPosition, viewportHeightRatio, viewportTopRatio],
  );

  const handleOverviewPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isDraggingOverviewRef.current) return;
      handleOverviewPointerPosition(event.clientY, true);
      event.preventDefault();
    },
    [handleOverviewPointerPosition],
  );

  const handleOverviewPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingOverviewRef.current) return;
    isDraggingOverviewRef.current = false;
    if (overviewRef.current?.hasPointerCapture(event.pointerId)) {
      overviewRef.current.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
  }, []);

  const handleOverviewWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const scrollContainer = mainScrollRef.current;
      if (!scrollContainer) return;
      scrollContainer.scrollTop += event.deltaY;
      event.preventDefault();
    },
    [],
  );

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
        <div ref={mainScrollRef} className="diff-editor-main">
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
          <div
            ref={overviewRef}
            className="diff-editor-overview"
            aria-label="Change overview"
            onPointerDown={handleOverviewPointerDown}
            onPointerMove={handleOverviewPointerMove}
            onPointerUp={handleOverviewPointerEnd}
            onPointerCancel={handleOverviewPointerEnd}
            onWheel={handleOverviewWheel}
          >
            <div className="diff-editor-overview-preview">
              <div className="diff-editor-overview-lane is-left" aria-hidden>
                {overviewSegments
                  .filter((segment) => segment.lane === "left")
                  .map((segment) => (
                    <div
                      key={segment.id}
                      className="diff-editor-overview-marker"
                      data-kind={segment.kind}
                      data-active={segment.active ? "true" : undefined}
                      style={{ top: segment.top, height: segment.height }}
                    />
                  ))}
              </div>
              <div className="diff-editor-overview-lane is-right" aria-hidden>
                {overviewSegments
                  .filter((segment) => segment.lane === "right")
                  .map((segment) => (
                    <div
                      key={segment.id}
                      className="diff-editor-overview-marker"
                      data-kind={segment.kind}
                      data-active={segment.active ? "true" : undefined}
                      style={{ top: segment.top, height: segment.height }}
                    />
                  ))}
              </div>
              <div
                className="diff-editor-overview-viewport"
                data-overview-viewport="true"
                style={{ top: viewportTop, height: viewportHeight }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
