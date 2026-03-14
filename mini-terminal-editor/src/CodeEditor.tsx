/**
 * CodeEditor: CodeMirror 6 封装，支持多语言、深色主题、保存逻辑
 */
import { useCallback, useEffect, useState } from "react";
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
  path: string | null;
  content: string;
  workspacePath: string;
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
  workspacePath,
  onSave,
}: CodeEditorProps) {
  const [value, setValue] = useState(content);
  const [dirty, setDirty] = useState(false);

  // Sync content when switching files
  useEffect(() => {
    setValue(content);
    setDirty(false);
  }, [path, content]);

  const handleChange = useCallback((newValue: string) => {
    setValue(newValue);
    setDirty(true);
  }, []);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (path && dirty) {
          onSave(path, value);
          setDirty(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [path, dirty, value, onSave]);

  if (!path) {
    return <div className="flex flex-col h-full min-h-0" />;
  }

  const langExt = getLanguageExtension(path);
  const extensions = [oneDark, ...(langExt ? [langExt] : [])];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border/50 text-sm">
        <span className="truncate text-foreground/90">{path}</span>
        {dirty && (
          <span className="text-amber-500 text-xs">(modified)</span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={value}
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
