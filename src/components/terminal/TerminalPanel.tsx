import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";
import {
  formatWorkspacePath,
  type WorkspaceContext
} from "../../lib/mock-data/workbench";

type TerminalPanelProps = {
  activeTabId: string;
  workspace: WorkspaceContext;
};

type TerminalCreated = {
  sessionId: string;
};

type TerminalEvent = {
  sessionId: string;
  data: string;
};

export function TerminalPanel({ activeTabId, workspace }: TerminalPanelProps) {
  const terminalRootRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [terminalStatus, setTerminalStatus] = useState("connecting");

  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"IBM Plex Mono", "JetBrains Mono", "SFMono-Regular", monospace',
      fontSize: 13,
      lineHeight: 1.5,
      theme: {
        background: "#02070c",
        foreground: "#c9d8e6",
        cursor: "#1fd8ff",
        cursorAccent: "#02070c",
        selectionBackground: "rgba(31, 216, 255, 0.24)",
        black: "#02070c",
        brightBlack: "#5e7389",
        red: "#ff5f73",
        green: "#34f5a4",
        yellow: "#f6c661",
        blue: "#53b8ff",
        magenta: "#ce8cff",
        cyan: "#1fd8ff",
        white: "#f3f7fa",
        brightWhite: "#ffffff"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    if (terminalRootRef.current) {
      terminal.open(terminalRootRef.current);
      fitAddon.fit();
      terminal.focus();
    }

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      resizeObserverRef.current?.disconnect();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = xtermRef.current;
    const fitAddon = fitAddonRef.current;

    if (!terminal || !fitAddon) {
      return;
    }

    let isActive = true;
    let currentSessionId: string | null = null;
    let unlistenPromise: Promise<() => void> | null = null;
    const currentWorkspacePath = workspace.path;

    terminal.clear();
    terminal.writeln(`\u001b[36mStarting terminal for ${workspace.name}...\u001b[0m`);
    setTerminalStatus("connecting");

    const setupSession = async () => {
      try {
        fitAddon.fit();

        const created = await invoke<TerminalCreated>("create_terminal", {
          payload: {
            workspacePath: currentWorkspacePath,
            cols: terminal.cols,
            rows: terminal.rows
          }
        });

        if (!isActive) {
          await invoke("close_terminal", {
            payload: { sessionId: created.sessionId }
          }).catch(() => undefined);
          return;
        }

        currentSessionId = created.sessionId;
        setSessionId(created.sessionId);
        setTerminalStatus("connected");
        terminal.clear();

        unlistenPromise = listen<TerminalEvent>("terminal-output", (event) => {
          if (event.payload.sessionId === currentSessionId) {
            terminal.write(event.payload.data);
          }
        });

        const disposable = terminal.onData((data) => {
          if (!currentSessionId) {
            return;
          }

          void invoke("write_terminal", {
            payload: {
              sessionId: currentSessionId,
              data
            }
          });
        });

        const resizeTerminal = () => {
          fitAddon.fit();

          if (!currentSessionId) {
            return;
          }

          void invoke("resize_terminal", {
            payload: {
              sessionId: currentSessionId,
              cols: terminal.cols,
              rows: terminal.rows
            }
          });
        };

        resizeTerminal();

        const observer = new ResizeObserver(() => {
          resizeTerminal();
        });

        if (terminalRootRef.current) {
          observer.observe(terminalRootRef.current);
        }

        resizeObserverRef.current = observer;

        return () => {
          observer.disconnect();
          disposable.dispose();
        };
      } catch (error) {
        terminal.writeln("");
        terminal.writeln("\u001b[31mUnable to start terminal session.\u001b[0m");
        setTerminalStatus("error");
      }
    };

    let disposeSessionBindings: (() => void) | undefined;

    void setupSession().then((dispose) => {
      disposeSessionBindings = dispose;
    });

    return () => {
      isActive = false;
      setSessionId(null);
      resizeObserverRef.current?.disconnect();
      disposeSessionBindings?.();
      void unlistenPromise?.then((unlisten) => unlisten());

      if (currentSessionId) {
        void invoke("close_terminal", {
          payload: { sessionId: currentSessionId }
        }).catch(() => undefined);
      }
    };
  }, [workspace.id, workspace.name, workspace.path]);

  return (
    <section className="terminal-panel">
      <div className="sub-toolbar">
        <div className="sub-toolbar-left">
          <span className="sub-toolbar-dot" />
          <span className="sub-toolbar-title">Terminal</span>
        </div>
        <div className="sub-toolbar-actions">
          <span className={`terminal-status terminal-status-${terminalStatus}`}>
            {terminalStatus}
          </span>
          <button type="button">□</button>
          <button type="button">×</button>
        </div>
      </div>

      <div className="terminal-content">
        <div className="terminal-session">
          <div className="terminal-avatar">
            <span>⌘</span>
          </div>
          <div className="terminal-session-meta">
            <div className="terminal-session-title">
              <span className="terminal-session-name">
                {workspace.name} Code
              </span>
              <span className="terminal-session-version">v2.0.74</span>
            </div>
            <div className="terminal-session-subtitle">
              <span>{activeTabId}</span>
              <span className="terminal-session-divider">·</span>
              <span>{workspace.status}</span>
              {sessionId ? (
                <>
                  <span className="terminal-session-divider">·</span>
                  <span>{sessionId}</span>
                </>
              ) : null}
            </div>
            <div className="terminal-session-path">
              {formatWorkspacePath(workspace.path)}
            </div>
          </div>
        </div>

        <div className="terminal-surface">
          <div ref={terminalRootRef} className="xterm-root" />
        </div>
      </div>
    </section>
  );
}
