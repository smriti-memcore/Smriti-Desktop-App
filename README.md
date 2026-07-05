# SMRITI Desktop App

An enterprise-grade, privacy-first desktop application companion for **SMRITI Memcore**. Built using **Tauri (v2)**, **React**, and **D3.js**, it runs SMRITI's core memory engine in the background as a standalone Python sidecar daemon.

## Architecture

```text
┌─────────────────────────────────┐
│          Tauri Frontend         │
│     React + TypeScript + D3     │
└────────────────┬────────────────┘
                 │ Local HTTP API
                 ▼ (localhost:7799)
┌─────────────────────────────────┐
│     SMRITI Python Sidecar       │
│     (desktop_daemon.py)         │
└─────────────────────────────────┘
```

## Prerequites

1. **Rust & Cargo:** Installed on your path (for building the Tauri Rust wrapper).
2. **Node.js:** For building the React web interface.
3. **SMRITI Core:** The public [smriti-memcore](https://github.com/shivamtyagi18/smriti-memcore) repository cloned locally.

## Local Setup & Development

### 1. Build the Sidecar Binary
The desktop app runs SMRITI as an isolated, standalone executable sidecar. Build the sidecar for your target operating system using the python build script (run using SMRITI's virtualenv python which contains all core memory engine dependencies):

```bash
/Users/shivtatva/.smriti/venv/bin/python3 sidecars/sidecar_build.py
```

This compiles `sidecars/desktop_daemon.py` using `PyInstaller` and copies the compiled binary matching your OS (e.g. `smriti-daemon-aarch64-apple-darwin`) into `src-tauri/sidecars/`.

### 2. Run the App in Development Mode
Launch the Tauri desktop client:

```bash
npm install
npm run tauri dev
```

This will start the Vite frontend server, compile the Rust binary, spin up the packaged Python sidecar daemon on port `7799` in the background, and open the SMRITI dashboard window.

## Features

1. **Palace Inspector:** Interactive D3.js force-directed graph to navigate your agent's memory Palace. Clicking memory nodes allows strength inspection and pruning.
2. **Ingest & Stream Logs:** Live terminal-like feed monitoring SMRITI's background operations (System 1 immediate heuristics and System 2 async consolidation runs).
3. **Custom Configurations:** Toggle between local-only storage and cloud sync databases. Seamlessly switch reasoning models (Local Ollama vs. OpenAI, Anthropic, or Google Gemini API).
