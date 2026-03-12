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

type TerminalSnapshot = {
  data: string;
  seq: number;
};

type TerminalEvent = {
  sessionId: string;
  data: string;
  seq: number;
};

function encodeTerminalKey(event: KeyboardEvent) {
  if (event.key === "Enter") {
    return "\r";
  }
  if (event.key === "Backspace") {
    return "\u007f";
  }
  if (event.key === "Tab") {
    return "\t";
  }
  if (event.key === "Escape") {
    return "\u001b";
  }
  if (event.key === "ArrowUp") {
    return "\u001b[A";
  }
  if (event.key === "ArrowDown") {
    return "\u001b[B";
  }
  if (event.key === "ArrowRight") {
    return "\u001b[C";
  }
  if (event.key === "ArrowLeft") {
    return "\u001b[D";
  }
  if (event.key === "Home") {
    return "\u001b[H";
  }
  if (event.key === "End") {
    return "\u001b[F";
  }
  if (event.key === "Delete") {
    return "\u001b[3~";
  }
  if (event.ctrlKey && !event.metaKey && event.key.length === 1) {
    const upper = event.key.toUpperCase();
    const code = upper.charCodeAt(0);
    if (code >= 64 && code <= 95) {
      return String.fromCharCode(code - 64);
    }
  }
  if (!event.metaKey && !event.altKey && event.key.length === 1) {
    return event.key;
  }

  return null;
}

export function TerminalPanel({ activeTabId, workspace }: TerminalPanelProps) {
  const terminalRootRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const lastSeenSeqRef = useRef(0);
  const isHydratingSnapshotRef = useRef(false);
  const pendingOutputRef = useRef<TerminalEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [terminalStatus, setTerminalStatus] = useState("connecting");

  const focusTerminal = () => {
    terminalRootRef.current?.focus();
    const terminal = xtermRef.current;
    if (!terminal) {
      return;
    }

    terminal.focus();
    const textarea = (terminal as unknown as { textarea?: HTMLTextAreaElement }).textarea;
    textarea?.focus();
  };

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
    let createdSessionId: string | null = null;
    let unlistenPromise: Promise<() => void> | null = null;
    let disposeInputBinding: (() => void) | null = null;
    const currentWorkspacePath = workspace.path;

    terminal.clear();
    terminal.writeln(`\u001b[36mStarting terminal for ${workspace.name}...\u001b[0m`);
    setTerminalStatus("connecting");
    lastSeenSeqRef.current = 0;
    isHydratingSnapshotRef.current = false;
    pendingOutputRef.current = [];

    unlistenPromise = listen<TerminalEvent>("terminal-output", (event) => {
      if (event.payload.sessionId !== currentSessionIdRef.current) {
        return;
      }

      if (isHydratingSnapshotRef.current) {
        pendingOutputRef.current.push(event.payload);
        return;
      }

      if (event.payload.seq > lastSeenSeqRef.current) {
        lastSeenSeqRef.current = event.payload.seq;
        terminal.write(event.payload.data);
      }
    });

    const sendTerminalInput = (data: string) => {
      if (!currentSessionIdRef.current) {
        return;
      }

      void invoke("write_terminal", {
        payload: {
          sessionId: currentSessionIdRef.current,
          data
        }
      }).catch(() => {
        setTerminalStatus("error");
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!currentSessionIdRef.current) {
        return;
      }

      const input = encodeTerminalKey(event);
      if (!input) {
        return;
      }

      event.preventDefault();
      setTerminalStatus((current) => (current === "error" ? current : "connected"));
      sendTerminalInput(input);
    };

    const handlePaste = (event: ClipboardEvent) => {
      if (!currentSessionIdRef.current) {
        return;
      }

      const text = event.clipboardData?.getData("text");
      if (!text) {
        return;
      }

      event.preventDefault();
      sendTerminalInput(text.replace(/\n/g, "\r"));
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("paste", handlePaste, true);

    disposeInputBinding = () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("paste", handlePaste, true);
    };

    const resizeTerminal = () => {
      fitAddon.fit();

      if (!currentSessionIdRef.current) {
        return;
      }

      void invoke("resize_terminal", {
        payload: {
          sessionId: currentSessionIdRef.current,
          cols: terminal.cols,
          rows: terminal.rows
        }
      }).catch(() => {
        setTerminalStatus("error");
      });
    };

    const setupSession = async () => {
      try {
        fitAddon.fit();
        focusTerminal();

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

        currentSessionIdRef.current = created.sessionId;
        createdSessionId = created.sessionId;
        isHydratingSnapshotRef.current = true;

        const snapshot = await invoke<TerminalSnapshot>("read_terminal_snapshot", {
          payload: { sessionId: created.sessionId }
        });

        lastSeenSeqRef.current = snapshot.seq;
        setSessionId(created.sessionId);
        setTerminalStatus("connected");
        terminal.clear();
        if (snapshot.data) {
          terminal.write(snapshot.data);
        }

        const pendingOutput = pendingOutputRef.current
          .filter((item) => item.seq > snapshot.seq)
          .sort((left, right) => left.seq - right.seq);
        pendingOutputRef.current = [];
        for (const item of pendingOutput) {
          lastSeenSeqRef.current = item.seq;
          terminal.write(item.data);
        }
        isHydratingSnapshotRef.current = false;

        focusTerminal();

        const observer = new ResizeObserver(() => {
          resizeTerminal();
        });

        if (terminalRootRef.current) {
          observer.observe(terminalRootRef.current);
          terminalRootRef.current.addEventListener("mousedown", focusTerminal);
        }

        resizeObserverRef.current = observer;

        return () => {
          observer.disconnect();
          terminalRootRef.current?.removeEventListener("mousedown", focusTerminal);
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
      currentSessionIdRef.current = null;
      lastSeenSeqRef.current = 0;
      isHydratingSnapshotRef.current = false;
      pendingOutputRef.current = [];
      setSessionId(null);
      resizeObserverRef.current?.disconnect();
      disposeInputBinding?.();
      disposeSessionBindings?.();
      void unlistenPromise?.then((unlisten) => unlisten());

      if (createdSessionId) {
        void invoke("close_terminal", {
          payload: { sessionId: createdSessionId }
        }).catch(() => undefined);
      }
    };
  }, [workspace.id, workspace.name, workspace.path]);

  return (
    <section className="terminal-panel">
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
              <span className={`terminal-status terminal-status-${terminalStatus}`}>
                {terminalStatus}
              </span>
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
          <div ref={terminalRootRef} className="xterm-root" tabIndex={0} />
        </div>
      </div>
    </section>
  );
}
