/**
 * Terminal component: xterm.js with native input (onData).
 * Uses Tauri Channel for PTY output streaming (dispatcher pattern).
 */
import { invoke, Channel } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, useCallback } from "react";
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

type TerminalOutputPayload = {
  sessionId: string;
  data: string;
};

// Batched writes: coalesce Channel output per animation frame
let writeBuffer: string[] = [];
let writeRafId: number | null = null;

function batchedWrite(data: string, getXterm: () => Terminal | null) {
  writeBuffer.push(data);
  if (writeRafId === null) {
    writeRafId = requestAnimationFrame(() => {
      writeRafId = null;
      if (writeBuffer.length > 0) {
        const xterm = getXterm();
        if (xterm) xterm.write(writeBuffer.join(""));
        writeBuffer = [];
      }
    });
  }
}

function disposeWriteBatch() {
  if (writeRafId !== null) {
    cancelAnimationFrame(writeRafId);
    writeRafId = null;
  }
  writeBuffer = [];
}

export function TerminalPanel({ activeTabId, workspace }: TerminalPanelProps) {
  const terminalRootRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<
    "connecting" | "connected" | "error"
  >("connecting");

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  const focusTerminal = useCallback(() => {
    terminalRootRef.current?.focus();
    const terminal = xtermRef.current;
    if (!terminal) return;
    terminal.focus();
    const textarea = (terminal as unknown as { textarea?: HTMLTextAreaElement })
      .textarea;
    textarea?.focus();
  }, []);

  useEffect(() => {
    const mountPoint = terminalRootRef.current;
    if (!mountPoint) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        '"IBM Plex Mono", "JetBrains Mono", "SFMono-Regular", monospace',
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
    terminal.open(mountPoint);

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      disposeWriteBatch();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = xtermRef.current;
    const fitAddon = fitAddonRef.current;

    if (!terminal || !fitAddon) return;

    let isActive = true;
    let createdSessionId: string | null = null;
    const currentWorkspacePath = workspace.path;

    terminal.clear();
    terminal.writeln(
      `\u001b[36mStarting terminal for ${workspace.name}...\u001b[0m`
    );
    setTerminalStatus("connecting");

    const dataDisposable = terminal.onData((data) => {
      if (!currentSessionIdRef.current) return;
      invoke("write_terminal", {
        payload: {
          sessionId: currentSessionIdRef.current,
          data
        }
      }).catch(() => setTerminalStatus("error"));
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (!currentSessionIdRef.current) return;
      invoke("resize_terminal", {
        payload: {
          sessionId: currentSessionIdRef.current,
          cols,
          rows
        }
      }).catch(() => setTerminalStatus("error"));
    });

    const setupSession = async () => {
      try {
        fitAddon.fit();
        focusTerminal();

        const channel = new Channel<TerminalOutputPayload>();
        channel.onmessage = (msg) => {
          if (msg.sessionId !== currentSessionIdRef.current) return;
          batchedWrite(msg.data, () => xtermRef.current);
        };

        const created = await invoke<TerminalCreated>("create_terminal", {
          payload: {
            workspacePath: currentWorkspacePath,
            cols: terminal.cols,
            rows: terminal.rows
          },
          onOutput: channel
        });

        if (!isActive) {
          await invoke("close_terminal", {
            payload: { sessionId: created.sessionId }
          }).catch(() => undefined);
          return;
        }

        currentSessionIdRef.current = created.sessionId;
        createdSessionId = created.sessionId;
        setSessionId(created.sessionId);
        setTerminalStatus("connected");
        terminal.clear();

        focusTerminal();

        const observer = new ResizeObserver(() => {
          fitAddon.fit();
          if (!currentSessionIdRef.current) return;
          invoke("resize_terminal", {
            payload: {
              sessionId: currentSessionIdRef.current,
              cols: terminal.cols,
              rows: terminal.rows
            }
          }).catch(() => setTerminalStatus("error"));
        });

        if (terminalRootRef.current) {
          observer.observe(terminalRootRef.current);
          terminalRootRef.current.addEventListener("mousedown", focusTerminal);
        }

        return () => {
          observer.disconnect();
          terminalRootRef.current?.removeEventListener(
            "mousedown",
            focusTerminal
          );
        };
      } catch {
        terminal.writeln("");
        terminal.writeln(
          "\u001b[31mUnable to start terminal session.\u001b[0m"
        );
        setTerminalStatus("error");
        return undefined;
      }
    };

    let disposeSessionBindings: (() => void) | undefined;

    void setupSession().then((dispose) => {
      disposeSessionBindings = dispose;
    });

    return () => {
      isActive = false;
      currentSessionIdRef.current = null;
      setSessionId(null);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      disposeSessionBindings?.();

      if (createdSessionId) {
        void invoke("close_terminal", {
          payload: { sessionId: createdSessionId }
        }).catch(() => undefined);
      }
    };
  }, [workspace.id, workspace.name, workspace.path, focusTerminal]);

  // Resize on container size change
  useEffect(() => {
    const el = terminalRootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

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
              <span
                className={`terminal-status terminal-status-${terminalStatus}`}
              >
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
          <div
            ref={terminalRootRef}
            className="xterm-root"
            tabIndex={0}
            role="application"
            aria-label="Terminal"
            onMouseDown={() => xtermRef.current?.focus()}
          />
        </div>
      </div>
    </section>
  );
}
