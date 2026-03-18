/**
 * CodeEditor: CodeMirror 6 封装，支持多语言、深色主题、保存逻辑
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import type { Extension } from "@codemirror/state";
import MarkdownPreview from "@uiw/react-markdown-preview";
import "@uiw/react-markdown-preview/markdown.css";
import {
  getFileExtensionForPreview,
  getPreviewKind,
  isPreviewablePath,
} from "./filePreview";

type CodeEditorProps = {
  path: string;
  workspacePath: string | null;
  content: string;
  dirty?: boolean;
  mode?: "code" | "preview";
  onChange: (path: string, content: string) => void;
  onSave: (path: string, content: string) => void | Promise<void>;
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

export function CodeEditor({
  path,
  workspacePath,
  content,
  dirty = false,
  mode = "code",
  onChange,
  onSave,
}: CodeEditorProps) {
  const handleChange = useCallback((newValue: string) => {
    onChange(path, newValue);
  }, [onChange, path]);

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
    <div className="code-editor-shell">
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
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLineGutter: true,
            highlightActiveLine: true,
          }}
        />
      </div>
    </div>
  );
}
