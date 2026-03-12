import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { indentWithTab } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { formatWorkspacePath, type WorkspaceContext } from "../../lib/mock-data/workbench";

type CodeEditorPanelProps = {
  workspace: WorkspaceContext;
  filePath: string | null;
  onClose: () => void;
  onDirtyChange: (filePath: string, dirty: boolean) => void;
};

type WorkspaceFileContent = {
  path: string;
  content: string;
};

function extensionForFile(filePath: string) {
  if (filePath.endsWith(".ts")) {
    return javascript({ typescript: true });
  }
  if (filePath.endsWith(".tsx")) {
    return javascript({ jsx: true, typescript: true });
  }
  if (filePath.endsWith(".js") || filePath.endsWith(".jsx")) {
    return javascript({ jsx: filePath.endsWith(".jsx") });
  }
  if (filePath.endsWith(".json")) {
    return json();
  }
  if (filePath.endsWith(".md")) {
    return markdown();
  }
  if (filePath.endsWith(".rs")) {
    return rust();
  }

  return [];
}

export function CodeEditorPanel({
  workspace,
  filePath,
  onClose,
  onDirtyChange
}: CodeEditorPanelProps) {
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!filePath) {
      setContent("");
      setIsDirty(false);
      setSaveMessage(null);
      setIsLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    if (!filePath) {
      return;
    }

    const currentFilePath = filePath;
    let isMounted = true;

    async function loadFile() {
      setIsLoading(true);
      setSaveMessage(null);
      setIsDirty(false);
      onDirtyChange(currentFilePath, false);

      try {
        const file = await invoke<WorkspaceFileContent>("read_workspace_file", {
          payload: {
            workspacePath: workspace.path,
            filePath: currentFilePath
          }
        });

        if (!isMounted) {
          return;
        }

        setContent(file.content);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setContent("");
        setSaveMessage(
          error instanceof Error ? error.message : "Unable to load file."
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadFile();

    return () => {
      isMounted = false;
    };
  }, [filePath, workspace.path]);

  useEffect(() => {
    if (!editorRootRef.current || isLoading || !filePath) {
      return;
    }

    editorViewRef.current?.destroy();

    const saveFile = async () => {
      const view = editorViewRef.current;
      if (!view) {
        return true;
      }

      setIsSaving(true);
      setSaveMessage(null);

      try {
        await invoke("save_workspace_file", {
          payload: {
            workspacePath: workspace.path,
            filePath,
            content: view.state.doc.toString()
          }
        });
        setIsDirty(false);
        onDirtyChange(filePath, false);
        setSaveMessage("Saved");
        return true;
      } catch (error) {
        setSaveMessage(
          error instanceof Error ? error.message : "Unable to save file."
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    };

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setIsDirty(true);
        onDirtyChange(filePath, true);
      }
    });

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          void saveFile();
          return true;
        }
      },
      indentWithTab
    ]);

    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          history(),
          EditorState.readOnly.of(false),
          EditorView.editable.of(true),
          EditorView.contentAttributes.of({
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
            "data-editor": "codemirror"
          }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          saveKeymap,
          EditorView.lineWrapping,
          oneDark,
          updateListener,
          extensionForFile(filePath)
        ]
      }),
      parent: editorRootRef.current
    });

    editorViewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, [content, filePath, isLoading, onDirtyChange, workspace.path]);

  if (!filePath) {
    return (
      <section className="editor-panel">
        <div className="editor-empty-state">
          <p className="editor-empty-title">No file selected</p>
          <p className="editor-empty-copy">Choose a file from the Files panel to open it in CodeMirror.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="editor-panel">
      <div className="editor-header">
        <div className="editor-title-row">
          <span className="editor-file-name">{filePath.split("/").pop()}</span>
          <span className="editor-file-path">
            {formatWorkspacePath(`${workspace.path}/${filePath}`)}
          </span>
        </div>
        <div className="sub-toolbar-actions">
          <span className="editor-status">
            {isLoading ? "loading" : isSaving ? "saving" : isDirty ? "modified" : "ready"}
          </span>
          <button
            type="button"
            className="editor-save-button"
            disabled={isLoading || isSaving || !isDirty}
            onClick={() => {
              void (async () => {
                const view = editorViewRef.current;
                if (!view) {
                  return;
                }
                setIsSaving(true);
                setSaveMessage(null);
                try {
                  await invoke("save_workspace_file", {
                    payload: {
                      workspacePath: workspace.path,
                      filePath,
                      content: view.state.doc.toString()
                    }
                  });
                  setIsDirty(false);
                  onDirtyChange(filePath, false);
                  setSaveMessage("Saved");
                } catch (error) {
                  setSaveMessage(
                    error instanceof Error ? error.message : "Unable to save file."
                  );
                } finally {
                  setIsSaving(false);
                }
              })();
            }}
          >
            Save
          </button>
          <button type="button" onClick={onClose}>×</button>
        </div>
      </div>
      {saveMessage ? <div className="editor-inline-message">{saveMessage}</div> : null}

      <div className="editor-surface">
        <div ref={editorRootRef} className="codemirror-root" />
      </div>
    </section>
  );
}
