/**
 * Terminal component: xterm.js with native input (onData).
 * Uses Tauri Channel for PTY output streaming (dispatcher pattern).
 */
import { invoke, Channel } from "@tauri-apps/api/core";
import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
/* xterm.css 由 index.css 统一导入，确保覆盖样式生效 */

type TerminalOutputPayload = { terminal_id: string; data: string };

const COMMAND_PROMPT_PATTERN = /^(?:.*?)(?:[#$%>]\s+)(.+)$/;
const DIRECTORY_PROMPT_PATTERN = /([^\s]+)\s+[#$%>]\s*$/;
const PROMPT_ONLY_PATTERN = /[#$%>]\s*$/;
const TITLE_ALIASES: Record<string, string> = {
  claude: "Claude Code",
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  copilot: "Copilot",
  "cursor-agent": "Cursor Agent",
};

function getExecutableLabel(command: string) {
  const normalized = command.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const firstToken = normalized.split(" ")[0] ?? "";
  const executable = firstToken.split("/").pop()?.toLowerCase() ?? "";
  const alias = TITLE_ALIASES[executable];
  if (alias) return alias;

  if (normalized.length <= 32) {
    return normalized;
  }

  return `${normalized.slice(0, 31)}…`;
}

function getBufferLine(xterm: Terminal, lineNumber: number) {
  return xterm.buffer.active.getLine(lineNumber)?.translateToString(true).trim() ?? "";
}

function deriveShellTitle(xterm: Terminal, fallbackTitle: string) {
  const buffer = xterm.buffer.active;
  const currentLineNumber = buffer.baseY + buffer.cursorY;

  for (let offset = 0; offset < 12; offset += 1) {
    const line = getBufferLine(xterm, currentLineNumber - offset);
    if (!line) continue;

    const commandMatch = line.match(COMMAND_PROMPT_PATTERN);
    if (commandMatch?.[1]) {
      return commandMatch[1].trim();
    }

    const directoryMatch = line.match(DIRECTORY_PROMPT_PATTERN);
    if (directoryMatch?.[1]) {
      return directoryMatch[1].trim();
    }

    if (offset === 0) {
      return line;
    }
  }

  return fallbackTitle;
}

function isPromptVisible(xterm: Terminal) {
  const buffer = xterm.buffer.active;
  const currentLineNumber = buffer.baseY + buffer.cursorY;
  const currentLine = getBufferLine(xterm, currentLineNumber);
  return PROMPT_ONLY_PATTERN.test(currentLine);
}

type TerminalComponentProps = {
  terminalId: string;
  cwd?: string;
  active?: boolean;
  defaultTitle?: string;
  onTitleChange?: (title: string) => void;
  canSendSelectionToClaude?: boolean;
  onSendSelectionToClaude?: (selection: string) => void | Promise<void>;
  startupCommands?: string[];
};

export function TerminalComponent({
  terminalId,
  cwd,
  active = true,
  defaultTitle = "Terminal",
  onTitleChange,
  canSendSelectionToClaude = false,
  onSendSelectionToClaude,
  startupCommands,
}: TerminalComponentProps) {
  const terminalSurfaceRef = useRef<HTMLDivElement | null>(null);
  const terminalRootRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const statusRef = useRef<"connecting" | "connected" | "error">("connecting");
  const writeBufferRef = useRef<string[]>([]);
  const writeRafIdRef = useRef<number | null>(null);
  const titleRef = useRef(defaultTitle);
  const defaultTitleRef = useRef(defaultTitle);
  const onTitleChangeRef = useRef(onTitleChange);
  const inputBufferRef = useRef("");
  const runningCommandTitleRef = useRef<string | null>(null);
  const startupCommandsRef = useRef(startupCommands);
  const startupCommandsExecutedRef = useRef(false);
  const startupTimeoutRef = useRef<number | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuSelection, setContextMenuSelection] = useState("");

  useEffect(() => {
    defaultTitleRef.current = defaultTitle;
    if (!titleRef.current) {
      titleRef.current = defaultTitle;
    }
  }, [defaultTitle]);

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  useEffect(() => {
    startupCommandsRef.current = startupCommands;
  }, [startupCommands]);

  useEffect(() => {
    if (!contextMenuPosition) return;

    const closeMenu = () => {
      setContextMenuPosition(null);
    };

    const handlePointerDown = () => {
      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    const handleWindowBlur = () => {
      closeMenu();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("resize", closeMenu);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("resize", closeMenu);
    };
  }, [contextMenuPosition]);

  const emitTitle = useCallback(
    (nextTitle: string) => {
      const normalizedTitle = nextTitle.trim() || defaultTitleRef.current;
      if (titleRef.current === normalizedTitle) return;
      titleRef.current = normalizedTitle;
      onTitleChangeRef.current?.(normalizedTitle);
    },
    []
  );

  const syncDerivedTitle = useCallback(() => {
    const xterm = xtermRef.current;
    if (!xterm) return;
    if (runningCommandTitleRef.current) {
      if (isPromptVisible(xterm)) {
        runningCommandTitleRef.current = null;
      } else {
        emitTitle(runningCommandTitleRef.current);
        return;
      }
    }
    emitTitle(deriveShellTitle(xterm, defaultTitleRef.current));
  }, [emitTitle]);

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
        syncDerivedTitle();
      });
    }
  }, [syncDerivedTitle]);

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
      fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.5,
      theme: {
        background: "#02070c",
        foreground: "#ffffff",
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
    titleRef.current = defaultTitleRef.current;
    inputBufferRef.current = "";
    runningCommandTitleRef.current = null;
    startupCommandsExecutedRef.current = false;
    onTitleChangeRef.current?.(defaultTitleRef.current);

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
          if (
            startupCommandsRef.current?.length &&
            !startupCommandsExecutedRef.current
          ) {
            startupCommandsExecutedRef.current = true;
            startupTimeoutRef.current = window.setTimeout(() => {
              const data = startupCommandsRef.current
                ?.map((command) => `${command}\r`)
                .join("");
              if (!data) return;
              invoke("write_terminal", { terminalId, data }).catch(() => {
                statusRef.current = "error";
              });
            }, 80);
          }
        })
        .catch((err) => {
          xterm.writeln(`\r\nError: ${err}\r\n`);
          statusRef.current = "error";
        });
    });

    // Forward xterm input to PTY
    const dataDisposable = xterm.onData((data) => {
      if (data === "\r") {
        const command = inputBufferRef.current.trim();
        inputBufferRef.current = "";
        if (command) {
          const nextRunningTitle = getExecutableLabel(command);
          if (nextRunningTitle) {
            runningCommandTitleRef.current = nextRunningTitle;
            emitTitle(nextRunningTitle);
          }
        } else {
          runningCommandTitleRef.current = null;
        }
      } else if (data === "\u007f") {
        inputBufferRef.current = inputBufferRef.current.slice(0, -1);
      } else if (data === "\u0015") {
        inputBufferRef.current = "";
      } else if (data >= " " && data !== "\u007f") {
        inputBufferRef.current += data;
      }

      invoke("write_terminal", { terminalId, data }).catch(() => {
        statusRef.current = "error";
      });
    });

    const titleDisposable = xterm.onTitleChange((nextTitle) => {
      runningCommandTitleRef.current = nextTitle.trim() || null;
      emitTitle(nextTitle);
    });

    const resizeDisposable = xterm.onResize(({ cols, rows }) => {
      invoke("resize_terminal", { terminalId, cols, rows }).catch(() => {
        statusRef.current = "error";
      });
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (startupTimeoutRef.current !== null) {
        window.clearTimeout(startupTimeoutRef.current);
        startupTimeoutRef.current = null;
      }
      dataDisposable.dispose();
      titleDisposable.dispose();
      resizeDisposable.dispose();
      invoke("close_terminal", { terminalId }).catch(() => {});
      disposeWriteBatch();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [batchedWrite, cwd, disposeWriteBatch, emitTitle, fit, syncDerivedTitle, terminalId]);

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
      syncDerivedTitle();
    });
    return () => cancelAnimationFrame(rafId);
  }, [active, fit, syncDerivedTitle]);

  const handleCopySelection = useCallback(async () => {
    const xterm = xtermRef.current;
    if (!xterm) return;
    const selection = xterm.getSelection();
    if (!selection) return;

    try {
      await navigator.clipboard.writeText(selection);
    } catch (error) {
      console.error(`Failed to copy terminal selection for ${terminalId}:`, error);
    }
  }, [terminalId]);

  const handlePaste = useCallback(async () => {
    try {
      const clipboardText = await invoke<string>("read_clipboard_text").catch(async (invokeError) => {
        console.warn(`Falling back to navigator clipboard for terminal ${terminalId}:`, invokeError);
        return navigator.clipboard.readText();
      });
      if (!clipboardText) return;
      await invoke("write_terminal", { terminalId, data: clipboardText });
    } catch (error) {
      console.error(`Failed to paste into terminal ${terminalId}:`, error);
    }
  }, [terminalId]);

  const handleSelectAll = useCallback(() => {
    xtermRef.current?.selectAll();
  }, []);

  const handleSendSelection = useCallback(() => {
    if (!contextMenuSelection || !onSendSelectionToClaude) return;
    void onSendSelectionToClaude(contextMenuSelection);
  }, [contextMenuSelection, onSendSelectionToClaude]);

  return (
    <>
      <div
        ref={terminalSurfaceRef}
        className="terminal-surface"
        role="application"
        aria-label="Terminal"
        onMouseDown={() => xtermRef.current?.focus()}
        onContextMenuCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const xterm = xtermRef.current;
          setContextMenuSelection(xterm?.getSelection() ?? "");
          setContextMenuPosition({ x: event.clientX, y: event.clientY });
        }}
      >
        <div ref={terminalRootRef} className="xterm-root" />
      </div>
      {contextMenuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              className="terminal-context-menu"
              style={{
                left: contextMenuPosition.x,
                top: contextMenuPosition.y,
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              <div className="terminal-context-menu-label">Terminal</div>
              <button
                type="button"
                className="terminal-context-menu-item"
                disabled={!contextMenuSelection || !canSendSelectionToClaude}
                onClick={() => {
                  handleSendSelection();
                  setContextMenuPosition(null);
                }}
              >
                Send to Claude Code
              </button>
              <div className="terminal-context-menu-separator" />
              <button
                type="button"
                className="terminal-context-menu-item"
                disabled={!contextMenuSelection}
                onClick={() => {
                  void handleCopySelection();
                  setContextMenuPosition(null);
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="terminal-context-menu-item"
                onClick={() => {
                  void handlePaste();
                  setContextMenuPosition(null);
                }}
              >
                Paste
              </button>
              <div className="terminal-context-menu-separator" />
              <button
                type="button"
                className="terminal-context-menu-item"
                onClick={() => {
                  handleSelectAll();
                  setContextMenuPosition(null);
                }}
              >
                Select All
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
