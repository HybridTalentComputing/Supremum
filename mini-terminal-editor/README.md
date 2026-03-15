# Subset

Minimal Tauri + xterm.js terminal application. Single session, full PTY support.

## Tech Stack

- Tauri 2
- React 19 + Vite 7
- xterm.js 5.3 (@xterm/xterm) + FitAddon
- portable-pty (Rust)

## Run

```bash
npm install
npm run tauri dev
```

Dev server: http://localhost:1421

## Features

- PTY spawn with shell (SHELL or /bin/zsh)
- Keyboard input via transparent overlay
- PTY output via `terminal-output` events
- Resize on window change
- Local echo for typed characters
- Paste support
