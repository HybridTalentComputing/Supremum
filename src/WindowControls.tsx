import { useEffect, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    });
    void win.isMaximized().then(setMaximized);
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  const stop = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="window-controls"
      data-tauri-drag-region="false"
      onMouseDown={stop}
    >
      <button
        className="window-controls-btn"
        onClick={() => void invoke("window_minimize")}
        onMouseDown={stop}
        data-tauri-drag-region="false"
        aria-label="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        className="window-controls-btn"
        onClick={() => void invoke("window_toggle_maximize")}
        onMouseDown={stop}
        data-tauri-drag-region="false"
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1.5" y="0" width="8.5" height="8.5" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="0" y="1.5" width="8.5" height="8.5" fill="var(--titlebar-bg, #090909)" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        className="window-controls-btn window-controls-close"
        onClick={() => void invoke("window_close")}
        onMouseDown={stop}
        data-tauri-drag-region="false"
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
