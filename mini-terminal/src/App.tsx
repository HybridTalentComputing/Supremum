import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { TerminalComponent } from "./Terminal";
import "./index.css";

// Terminal theme background
const THEME_BG = { r: 2, g: 7, b: 12 };

export function App() {
  useEffect(() => {
    getCurrentWindow()
      .setBackgroundColor(THEME_BG)
      .catch(() => {});
  }, []);

  return (
    <div className="app">
      <TerminalComponent />
    </div>
  );
}
