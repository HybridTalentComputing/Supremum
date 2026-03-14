/**
 * Terminal component: xterm.js with native input (onData).
 * Uses Tauri Channel for PTY output streaming (dispatcher pattern).
 */
import { invoke, Channel } from "@tauri-apps/api/core";
import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
/* xterm.css 由 index.css 统一导入，确保覆盖样式生效 */

const TERMINAL_ID = "term-1";

type TerminalOutputPayload = { terminal_id: string; data: string };

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

type TerminalComponentProps = {
  cwd?: string;
};

export function TerminalComponent({ cwd }: TerminalComponentProps) {
  const terminalSurfaceRef = useRef<HTMLDivElement | null>(null);
  const terminalRootRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const statusRef = useRef<"connecting" | "connected" | "error">("connecting");
  const fitTimeoutsRef = useRef<number[]>([]);

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
        terminalId: TERMINAL_ID,
        cols,
        rows,
      }).catch(() => {
        statusRef.current = "error";
      });
    }
  }, []);

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

    const scheduleFit = () => {
      requestAnimationFrame(() => fit());
      fitTimeoutsRef.current.push(window.setTimeout(() => fit(), 50));
      fitTimeoutsRef.current.push(window.setTimeout(() => fit(), 150));
      fitTimeoutsRef.current.push(window.setTimeout(() => fit(), 320));
      if ("fonts" in document) {
        void document.fonts.ready.then(() => fit());
      }
    };

    // Defer fit + PTY creation to next frame so container has layout
    const rafId = requestAnimationFrame(() => {
      scheduleFit();

      const channel = new Channel<TerminalOutputPayload>();
      channel.onmessage = (msg) => {
        batchedWrite(msg.data, () => xtermRef.current);
      };

      invoke("create_terminal", {
        terminalId: TERMINAL_ID,
        cwd: cwd || null,
        cols: xterm.cols,
        rows: xterm.rows,
        onOutput: channel,
      })
        .then(() => {
          statusRef.current = "connected";
          scheduleFit();
        })
        .catch((err) => {
          xterm.writeln(`\r\nError: ${err}\r\n`);
          statusRef.current = "error";
        });
    });

    // Forward xterm input to PTY
    const dataDisposable = xterm.onData((data) => {
      invoke("write_terminal", { terminalId: TERMINAL_ID, data }).catch(() => {
        statusRef.current = "error";
      });
    });

    const resizeDisposable = xterm.onResize(({ cols, rows }) => {
      invoke("resize_terminal", { terminalId: TERMINAL_ID, cols, rows }).catch(() => {
        statusRef.current = "error";
      });
    });

    return () => {
      cancelAnimationFrame(rafId);
      fitTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      fitTimeoutsRef.current = [];
      dataDisposable.dispose();
      resizeDisposable.dispose();
      invoke("close_terminal", { terminalId: TERMINAL_ID }).catch(() => {});
      disposeWriteBatch();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Resize on container size change
  useEffect(() => {
    const el = terminalSurfaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  useEffect(() => {
    const handleWindowResize = () => fit();
    const handleVisibilityChange = () => {
      if (!document.hidden) fit();
    };

    window.addEventListener("resize", handleWindowResize);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fit]);

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
