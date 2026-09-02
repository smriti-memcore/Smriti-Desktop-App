# SMRITI Desktop App

An enterprise-grade, privacy-first desktop companion for **[SMRITI Memcore](https://github.com/smriti-memcore/smriti-memcore)** — a biologically-inspired Long-Term Memory engine for AI agents. Built with **Tauri v2**, **React 19**, **TypeScript**, and **D3.js**, it runs the full SMRITI engine locally as a Python sidecar daemon.

## Architecture

```text
┌──────────────────────────────────────────┐
│            Tauri v2 Frontend             │
│     React 19 + TypeScript + D3.js        │
│                                          │
│  ┌────────────┐  ┌───────────────────┐   │
│  │ GraphPane  │  │ IngestionCenter   │   │
│  │ MemoryTable│  │ SettingsPanel     │   │
│  └────────────┘  └───────────────────┘   │
└──────────────────┬───────────────────────┘
                   │ REST API
                   ▼ (localhost:7799)
┌──────────────────────────────────────────┐
│        SMRITI Python Sidecar Daemon      │
│          (desktop_daemon.py)             │
│                                          │
│  Attention Gate → Episode Buffer →       │
│  Palace Placement → System 2 Reflection  │
└──────────────────────────────────────────┘
```

## Prerequisites

1. **Rust & Cargo:** Installed on your path (for building the Tauri Rust wrapper).
2. **Node.js (v18+):** For building the React web interface.
3. **Python 3.11+:** With a virtualenv containing SMRITI's dependencies.
4. **SMRITI Core:** The [smriti-memcore](https://github.com/smriti-memcore/smriti-memcore) repository cloned locally.
5. **Ollama (Optional):** For local, offline LLM reasoning via models like Mistral.

## Local Setup & Development

### 1. Install Frontend Dependencies

```bash
npm install
```

### 2. Build the Sidecar Binary

The desktop app runs SMRITI as an isolated, standalone executable sidecar. Build it for your target OS using the Python build script (run with SMRITI's virtualenv which contains all core engine dependencies):

```bash
~/.smriti/venv/bin/python3 sidecars/sidecar_build.py
```

This compiles `sidecars/desktop_daemon.py` using **PyInstaller** and copies the compiled binary matching your architecture (e.g., `smriti-daemon-aarch64-apple-darwin`) into `src-tauri/sidecars/`.

> **Important:** After any changes to `desktop_daemon.py`, you must rebuild the sidecar binary for the changes to take effect.

### 3. Run the App in Development Mode

```bash
npm run tauri dev
```

This will:
- Start the Vite frontend dev server with HMR
- Compile the Rust Tauri binary
- Auto-spawn the Python sidecar daemon on port `7799`
- Open the SMRITI dashboard window

> **🍏 Note for macOS Users ("App is damaged"):**
> Because this build is self-signed, macOS Gatekeeper may quarantine web downloads and show *"Smriti is damaged and can’t be opened"*. To remove the quarantine attribute and open the app, run this single command in Terminal:
> ```bash
> xattr -cr /Applications/Smriti.app
> ```

### 4. Running Sidecar Tests

To run the sidecar's automated unit tests and verify the REST API endpoints, configurations, and bootstrap routines:

```bash
python3 -m unittest sidecars/tests/test_daemon.py -v
```

## Features

### 🏛️ Semantic Palace Explorer
Interactive D3.js force-directed graph visualizing your agent's Memory Palace. Category Rooms cluster related memories. Click any node to inspect its properties (strength, status, reflection level, visibility) in the side panel. Supports zoom, pan, drag, and auto-reframe.

### 📊 Memory Table View
Searchable, sortable tabular grid of all memories with filters for Category Room, Visibility (shared/private), and Status (active/pinned/decaying/archived). Persists your view preference across tab switches.

### 📝 Ingestion Control Center
Two-column layout with a rich observation entry form (with private room toggle) and a live Pending Consolidation Queue showing raw System 1 episodes awaiting System 2 reflection. Trigger consolidation directly from the UI.

### ⚙️ System Configuration
Toggle between local-only storage and cloud sync. Seamlessly switch reasoning models between local Ollama (Mistral, Qwen, etc.) and cloud APIs (OpenAI, Anthropic, Google Gemini).

### 🧠 Reflection Level Badges
Visual color-coded state indicators on every memory node:
- **Direct** (Cyan) — Level 0: Raw consolidated observation
- **Observation** (Purple) — Level 1: Reflected observation
- **Insight** (Pink) — Level 2: Synthesized insight
- **Principle** (Gold) — Level 3: Core generalized principle

### 📡 Live Operations Log
Real-time streaming of sidecar daemon logs via Tauri event bridge. Collapsible accordion showing System 1 encoding events, System 2 consolidation progress, and error traces.

## Project Structure

```text
Smriti-Desktop-App/
├── src/
│   ├── App.tsx              # Root layout, navigation, health polling (~160 lines)
│   ├── App.css              # Dark glassmorphism design system
│   ├── api.ts               # REST client & TypeScript data models
│   └── components/
│       ├── GraphPane.tsx     # D3 force graph + Palace Node Inspector
│       ├── MemoryTable.tsx   # Searchable memory grid with filters & sorting
│       ├── IngestionCenter.tsx  # Observation entry + pending queue + logs
│       └── SettingsPanel.tsx # Storage & LLM provider configuration
├── src-tauri/
│   ├── src/lib.rs           # Rust: sidecar spawning & event bridge
│   ├── tauri.conf.json      # Tauri v2 window & sidecar config
│   └── sidecars/            # Compiled sidecar binaries (gitignored)
├── sidecars/
│   ├── desktop_daemon.py    # Python REST server wrapping smriti_memcore
│   └── sidecar_build.py     # PyInstaller packaging script
└── package.json
```

## Data Storage

All user data is stored locally at `~/.smriti/`:
- **Palace Graph:** `~/.smriti/global/palace/palace.json`
- **Episode Buffer:** `~/.smriti/global/episodes/episodes.db` (SQLite)
- **Vector Store:** `~/.smriti/global/vectors/`
- **Configuration:** `~/.smriti/config.json`

## License

This repository is **private** and proprietary to the smriti-memcore organization.
