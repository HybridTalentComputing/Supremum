import { invoke } from "@tauri-apps/api/core";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension
} from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { formatWorkspacePath, type WorkspaceContext } from "../../lib/mock-data/workbench";

type CodeEditorPanelProps = {
  workspace: WorkspaceContext;
  filePath: string | null;
  revealLine?: number;
  revealNonce?: number;
  onClose: () => void;
  onDirtyChange: (filePath: string, dirty: boolean) => void;
  onSaved?: (filePath: string) => void;
};

type WorkspaceFileContent = {
  path: string;
  content: string;
};

function extensionForFile(filePath: string): Extension {
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
  revealLine,
  revealNonce,
  onClose,
  onDirtyChange,
  onSaved
}: CodeEditorPanelProps) {
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const currentFilePathRef = useRef<string | null>(null);
  const currentWorkspacePathRef = useRef(workspace.path);
  const currentDocumentRef = useRef("");
  const isApplyingExternalChangeRef = useRef(false);
  const isLoadingRef = useRef(true);
  const isSavingRef = useRef(false);
  const languageCompartmentRef = useRef(new Compartment());
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onSavedRef = useRef(onSaved);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  currentWorkspacePathRef.current = workspace.path;
  onDirtyChangeRef.current = onDirtyChange;
  onSavedRef.current = onSaved;
  isLoadingRef.current = isLoading;
  isSavingRef.current = isSaving;

  async function saveCurrentFile() {
    const view = editorViewRef.current;
    const activeFilePath = currentFilePathRef.current;
    if (!view || !activeFilePath || isLoadingRef.current || isSavingRef.current) {
      return false;
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const content = view.state.doc.toString();
      await invoke("save_workspace_file", {
        payload: {
          workspacePath: currentWorkspacePathRef.current,
          filePath: activeFilePath,
          content
        }
      });
      currentDocumentRef.current = content;
      setIsDirty(false);
      onDirtyChangeRef.current(activeFilePath, false);
      setSaveMessage("Saved");
      onSavedRef.current?.(activeFilePath);
      return true;
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : "Unable to save file."
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    if (!editorRootRef.current || editorViewRef.current) {
      return;
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged || isApplyingExternalChangeRef.current) {
        return;
      }

      const activeFilePath = currentFilePathRef.current;
      if (!activeFilePath) {
        return;
      }

      const currentContent = update.state.doc.toString();
      const dirty = currentContent !== currentDocumentRef.current;
      setIsDirty(dirty);
      onDirtyChangeRef.current(activeFilePath, dirty);
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
          lineNumbers(),
          history(),
          languageCompartmentRef.current.of([]),
          EditorState.readOnly.of(false),
          EditorView.editable.of(true),
          EditorView.contentAttributes.of({
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
            "data-editor": "codemirror"
          }),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
            {
              key: "Mod-s",
              run: () => {
                void saveCurrentFile();
                return true;
              }
            }
          ]),
          EditorView.lineWrapping,
          oneDark,
          updateListener
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
  }, []);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) {
      return;
    }

    if (!filePath) {
      currentFilePathRef.current = null;
      currentDocumentRef.current = "";
      isApplyingExternalChangeRef.current = true;
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: ""
        }
      });
      isApplyingExternalChangeRef.current = false;
      setIsDirty(false);
      setSaveMessage(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const activeFilePath = filePath;

    async function loadFile() {
      setIsLoading(true);
      setSaveMessage(null);

      try {
        const file = await invoke<WorkspaceFileContent>("read_workspace_file", {
          payload: {
            workspacePath: workspace.path,
            filePath: activeFilePath
          }
        });

        if (!isMounted || !editorViewRef.current) {
          return;
        }

        currentFilePathRef.current = activeFilePath;
        currentDocumentRef.current = file.content;

        isApplyingExternalChangeRef.current = true;
        editorViewRef.current.dispatch({
          changes: {
            from: 0,
            to: editorViewRef.current.state.doc.length,
            insert: file.content
          },
          selection: EditorSelection.cursor(0),
          effects: languageCompartmentRef.current.reconfigure(extensionForFile(activeFilePath))
        });
        isApplyingExternalChangeRef.current = false;

        setIsDirty(false);
        onDirtyChangeRef.current(activeFilePath, false);
      } catch (error) {
        if (!isMounted || !editorViewRef.current) {
          return;
        }

        currentFilePathRef.current = activeFilePath;
        currentDocumentRef.current = "";
        isApplyingExternalChangeRef.current = true;
        editorViewRef.current.dispatch({
          changes: {
            from: 0,
            to: editorViewRef.current.state.doc.length,
            insert: ""
          },
          selection: EditorSelection.cursor(0),
          effects: languageCompartmentRef.current.reconfigure(extensionForFile(activeFilePath))
        });
        isApplyingExternalChangeRef.current = false;

        setIsDirty(false);
        onDirtyChangeRef.current(activeFilePath, false);
        setSaveMessage(
          error instanceof Error ? error.message : "Unable to load file."
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
          editorViewRef.current?.focus();
        }
      }
    }

    void loadFile();

    return () => {
      isMounted = false;
    };
  }, [filePath, workspace.path]);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !filePath || !revealLine) {
      return;
    }

    const lastLine = Math.max(view.state.doc.lines, 1);
    const targetLineNumber = Math.min(Math.max(revealLine, 1), lastLine);
    const targetLine = view.state.doc.line(targetLineNumber);

    view.dispatch({
      selection: EditorSelection.cursor(targetLine.from),
      scrollIntoView: true
    });
    view.focus();
  }, [filePath, revealLine, revealNonce]);

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
              void saveCurrentFile();
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
