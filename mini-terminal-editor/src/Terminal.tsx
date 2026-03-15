/**
 * Terminal component: xterm.js with native input (onData).
 * Uses Tauri Channel for PTY output streaming (dispatcher pattern).
 */
import { invoke, Channel } from "@tauri-apps/api/core";
import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
/* xterm.css 由 index.css 统一导入，确保覆盖样式生效 */

type TerminalOutputPayload = { terminal_id: string; data: string };

type TerminalComponentProps = {
  terminalId: string;
  cwd?: string;
  active?: boolean;
};

export function TerminalComponent({
  terminalId,
  cwd,
  active = true,
}: TerminalComponentProps) {
  const terminalSurfaceRef = useRef<HTMLDivElement | null>(null);
  const terminalRootRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const statusRef = useRef<"connecting" | "connected" | "error">("connecting");
  const writeBufferRef = useRef<string[]>([]);
  const writeRafIdRef = useRef<number | null>(null);

  const batchedWrite = useCallback((data: string) => {
    writeBufferRef.current.push(data);
    if (writeRafIdRef.current === null) {
      writeRafIdRef.current = requestAnimationFrame(() => {
        writeRafIdRef.current = null;
        if (writeBufferRef.current.length === 0) return;
        const xterm = xtermRef.current;
        if (xterm) {
          xterm.write(writeBufferRef.current.join(""));
        }
        writeBufferRef.current = [];
      });
    }
  }, []);

  const disposeWriteBatch = useCallback(() => {
    if (writeRafIdRef.current !== null) {
      cancelAnimationFrame(writeRafIdRef.current);
      writeRafIdRef.current = null;
    }
    writeBufferRef.current = [];
  }, []);

  const fit = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const xterm = xtermRef.current;
    if (!fitAddon || !xterm) return;
    const dimensions = fitAddon.proposeDimensions();
    if (!dimensions) return;

    const { cols, rows } = dimensions;
    if (xterm.cols !== cols || xterm.rows !== rows) {
      xterm.resize(cols, rows);
    }

    if (statusRef.current === "connected") {
      invoke("resize_terminal", {
        terminalId,
        cols,
        rows,
      }).catch(() => {
        statusRef.current = "error";
      });
    }
  }, [terminalId]);

  useEffect(() => {
    const mountPoint = terminalRootRef.current;
    if (!mountPoint) return;

    const xterm = new Terminal({
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
      },
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(mountPoint);

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Defer fit + PTY creation to next frame so container has layout
    const rafId = requestAnimationFrame(() => {
      fit();

      const channel = new Channel<TerminalOutputPayload>();
      channel.onmessage = (msg) => {
        batchedWrite(msg.data);
      };

      invoke("create_terminal", {
        terminalId,
        cwd: cwd || null,
        cols: xterm.cols,
        rows: xterm.rows,
        onOutput: channel,
      })
        .then(() => {
          statusRef.current = "connected";
          fit();
        })
        .catch((err) => {
          xterm.writeln(`\r\nError: ${err}\r\n`);
          statusRef.current = "error";
        });
    });

    // Forward xterm input to PTY
    const dataDisposable = xterm.onData((data) => {
      invoke("write_terminal", { terminalId, data }).catch(() => {
        statusRef.current = "error";
      });
    });

    const resizeDisposable = xterm.onResize(({ cols, rows }) => {
      invoke("resize_terminal", { terminalId, cols, rows }).catch(() => {
        statusRef.current = "error";
      });
    });

    return () => {
      cancelAnimationFrame(rafId);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      invoke("close_terminal", { terminalId }).catch(() => {});
      disposeWriteBatch();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [batchedWrite, cwd, disposeWriteBatch, fit, terminalId]);

  // Resize on container size change
  useEffect(() => {
    const el = terminalSurfaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  useEffect(() => {
    if (!("fonts" in document)) return;
    let cancelled = false;

    void document.fonts.ready.then(() => {
      if (!cancelled) fit();
    });

    return () => {
      cancelled = true;
    };
  }, [fit]);

  useEffect(() => {
    if (!active) return;
    const rafId = requestAnimationFrame(() => {
      fit();
      xtermRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [active, fit]);

  return (
    <div
      ref={terminalSurfaceRef}
      className="terminal-surface"
      role="application"
      aria-label="Terminal"
      onMouseDown={() => xtermRef.current?.focus()}
    >
      <div ref={terminalRootRef} className="xterm-root" />
    </div>
  );
}
