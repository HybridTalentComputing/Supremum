/**
 * CodeEditor: CodeMirror 6 封装，支持多语言、深色主题、保存逻辑
 */
import { useCallback, useEffect } from "react";
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

type CodeEditorProps = {
  path: string;
  content: string;
  dirty?: boolean;
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
  content,
  dirty = false,
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

  return (
    <div className="flex h-full flex-col bg-[#252526]">
      <div className="flex-1 min-h-0 overflow-hidden bg-[#252526]">
        <CodeMirror
          key={path}
          value={content}
          height="100%"
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
