/**
 * CodeEditor: CodeMirror 6 封装，支持多语言、深色主题、保存逻辑
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { EditorSelection, type Extension } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import MarkdownPreview from "@uiw/react-markdown-preview";
import "@uiw/react-markdown-preview/markdown.css";
import {
  getFileExtensionForPreview,
  getPreviewKind,
  isPreviewablePath,
} from "./filePreview";

type SelectionContext = {
  text: string;
  fromLine: number;
  toLine: number;
};

type CodeEditorProps = {
  path: string;
  workspacePath: string | null;
  content: string;
  dirty?: boolean;
  mode?: "code" | "preview";
  canAddSelectionToClaude?: boolean;
  onAddSelectionToClaude?: (path: string, selection: SelectionContext) => void | Promise<void>;
  onSelectionChange?: (
    path: string,
    selection: SelectionContext | null
  ) => void;
  onChange: (path: string, content: string) => void;
  onSave: (path: string, content: string) => void | Promise<void>;
};

function getSelectionContext(viewUpdate: ViewUpdate): SelectionContext | null {
  const selection = viewUpdate.state.selection.main;
  if (selection.empty) return null;

  const text = viewUpdate.state.sliceDoc(selection.from, selection.to);
  return {
    text,
    fromLine: viewUpdate.state.doc.lineAt(selection.from).number,
    toLine: viewUpdate.state.doc.lineAt(selection.to).number,
  };
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

export function CodeEditor({
  path,
  workspacePath,
  content,
  dirty = false,
  mode = "code",
  canAddSelectionToClaude = false,
  onAddSelectionToClaude,
  onSelectionChange,
  onChange,
  onSave,
}: CodeEditorProps) {
  const editorViewRef = useRef<EditorView | null>(null);
  const [selectionContext, setSelectionContext] = useState<SelectionContext | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const handleChange = useCallback((newValue: string) => {
    onChange(path, newValue);
  }, [onChange, path]);

  const handleUpdate = useCallback((viewUpdate: ViewUpdate) => {
    const nextSelectionContext = getSelectionContext(viewUpdate);
    setSelectionContext(nextSelectionContext);
    onSelectionChange?.(path, nextSelectionContext);
  }, [onSelectionChange, path]);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty) {
          void onSave(path, content);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [content, dirty, onSave, path]);

  const langExt = getLanguageExtension(path);
  const extensions = [oneDark, ...(langExt ? [langExt] : [])];
  const previewKind = getPreviewKind(path);
  const previewExtension = getFileExtensionForPreview(path);
  const shouldRenderPreview = mode === "preview" && isPreviewablePath(path);
  const [binaryImagePreviewSrc, setBinaryImagePreviewSrc] = useState<string | null>(null);
  const imagePreviewSrc = useMemo(() => {
    if (previewKind !== "image") return null;

    if (previewExtension === "svg") {
      const svgSource = content.trim();
      if (!svgSource) return null;
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgSource)}`;
    }

    return binaryImagePreviewSrc;
  }, [binaryImagePreviewSrc, content, previewExtension, previewKind]);

  useEffect(() => {
    if (previewKind !== "image" || previewExtension === "svg") {
      setBinaryImagePreviewSrc(null);
      return;
    }

    if (!workspacePath || mode !== "preview") {
      setBinaryImagePreviewSrc(null);
      return;
    }

    let cancelled = false;
    void invoke<string>("read_image_data_url", {
      payload: { workspacePath, path },
    })
      .then((src) => {
        if (!cancelled) {
          setBinaryImagePreviewSrc(src);
        }
      })
      .catch((error) => {
        console.error(`Failed to load image preview for ${path}:`, error);
        if (!cancelled) {
          setBinaryImagePreviewSrc(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode, path, previewExtension, previewKind, workspacePath]);

  useEffect(() => {
    if (mode !== "code") {
      setSelectionContext(null);
      onSelectionChange?.(path, null);
    }
  }, [mode, onSelectionChange, path]);

  useEffect(() => {
    return () => {
      onSelectionChange?.(path, null);
    };
  }, [onSelectionChange, path]);

  const handleCopySelection = useCallback(async () => {
    if (!selectionContext?.text) return;
    try {
      await navigator.clipboard.writeText(selectionContext.text);
    } catch (error) {
      console.error(`Failed to copy selection for ${path}:`, error);
    }
  }, [path, selectionContext]);

  const handleCutSelection = useCallback(async () => {
    const view = editorViewRef.current;
    if (!view || !selectionContext?.text) return;

    try {
      await navigator.clipboard.writeText(selectionContext.text);
      const selection = view.state.selection.main;
      if (selection.empty) return;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: "" },
      });
      view.focus();
    } catch (error) {
      console.error(`Failed to cut selection for ${path}:`, error);
    }
  }, [path, selectionContext]);

  const handlePaste = useCallback(async () => {
    const view = editorViewRef.current;
    if (!view) return;

    try {
      const clipboardText = await invoke<string>("read_clipboard_text").catch(async (invokeError) => {
        console.warn(`Falling back to navigator clipboard for ${path}:`, invokeError);
        return navigator.clipboard.readText();
      });
      if (!clipboardText) return;
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: clipboardText },
      });
      view.focus();
    } catch (error) {
      console.error(`Failed to paste into ${path}:`, error);
    }
  }, [path]);

  const handleSelectAll = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({
      selection: EditorSelection.range(0, view.state.doc.length),
    });
    view.focus();
  }, []);

  const handleAddSelection = useCallback(() => {
    if (!selectionContext || !onAddSelectionToClaude) return;
    void onAddSelectionToClaude(path, selectionContext);
  }, [onAddSelectionToClaude, path, selectionContext]);

  useEffect(() => {
    if (!contextMenuPosition) return;

    const closeMenu = () => {
      setContextMenuPosition(null);
    };

    const handlePointerDown = () => {
      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    const handleWindowBlur = () => {
      closeMenu();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("resize", closeMenu);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("resize", closeMenu);
    };
  }, [contextMenuPosition]);

  if (shouldRenderPreview) {
    if (previewKind === "image") {
      return (
        <div className="code-editor-shell">
          <div className="image-preview-shell">
            {imagePreviewSrc ? (
              <div className="image-preview-stage">
                <img src={imagePreviewSrc} alt={path} className="image-preview-media" draggable={false} />
              </div>
            ) : (
              <div className="image-preview-empty">Image preview is unavailable.</div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="code-editor-shell">
        <div className="markdown-preview-shell">
          <MarkdownPreview
            source={content}
            className="markdown-preview"
            wrapperElement={{ "data-color-mode": "dark" }}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="code-editor-shell"
        onContextMenuCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextMenuPosition({ x: event.clientX, y: event.clientY });
        }}
      >
        <div className="code-editor-container">
          <CodeMirror
            key={path}
            className="code-editor-instance"
            value={content}
            height="100%"
            width="100%"
            theme="dark"
            extensions={extensions}
            onChange={handleChange}
            onUpdate={handleUpdate}
            onCreateEditor={(view) => {
              editorViewRef.current = view;
            }}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
            }}
          />
        </div>
      </div>
      {contextMenuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              className="code-editor-context-menu"
              style={{
                left: contextMenuPosition.x,
                top: contextMenuPosition.y,
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              <div className="code-editor-context-menu-label">Editor</div>
              <button
                type="button"
                className="code-editor-context-menu-item"
                disabled={!selectionContext || !canAddSelectionToClaude}
                onClick={() => {
                  handleAddSelection();
                  setContextMenuPosition(null);
                }}
              >
                Add Selection to Claude Code Context
              </button>
              <div className="code-editor-context-menu-separator" />
              <button
                type="button"
                className="code-editor-context-menu-item"
                disabled={!selectionContext}
                onClick={() => {
                  void handleCopySelection();
                  setContextMenuPosition(null);
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="code-editor-context-menu-item"
                disabled={!selectionContext}
                onClick={() => {
                  void handleCutSelection();
                  setContextMenuPosition(null);
                }}
              >
                Cut
              </button>
              <button
                type="button"
                className="code-editor-context-menu-item"
                onClick={() => {
                  void handlePaste();
                  setContextMenuPosition(null);
                }}
              >
                Paste
              </button>
              <div className="code-editor-context-menu-separator" />
              <button
                type="button"
                className="code-editor-context-menu-item"
                onClick={() => {
                  handleSelectAll();
                  setContextMenuPosition(null);
                }}
              >
                Select All
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
