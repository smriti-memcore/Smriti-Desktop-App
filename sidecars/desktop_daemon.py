import os
import sys
import json
import logging
import traceback
import threading
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer

# ---------------------------------------------------------------------------
# When running as a PyInstaller one-file bundle, all bundled packages live
# inside sys._MEIPASS at runtime.  We add that directory to sys.path so that
# `import smriti_memcore` works without any local installation on the user's
# machine.  During development (plain `python desktop_daemon.py`) _MEIPASS
# does not exist, so the normal virtualenv / PYTHONPATH is used instead.
# ---------------------------------------------------------------------------
if hasattr(sys, "_MEIPASS"):
    sys.path.insert(0, sys._MEIPASS)

from smriti_memcore.core import SMRITI
from smriti_memcore.models import SmritiConfig, MemorySource, Modality, Visibility

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("smriti-desktop-daemon")

# ── Paths ──────────────────────────────────────────────────────────────────
SMRITI_HOME = Path("~/.smriti").expanduser()
CONFIG_PATH = SMRITI_HOME / "config.json"
STORAGE_PATH = SMRITI_HOME / "global"

_smriti_instance = None


# ── First-run bootstrap ────────────────────────────────────────────────────
def bootstrap_first_run():
    """Create ~/.smriti/ with a default config on a brand-new machine."""
    SMRITI_HOME.mkdir(parents=True, exist_ok=True)
    STORAGE_PATH.mkdir(parents=True, exist_ok=True)

    if not CONFIG_PATH.exists():
        default_config = {
            "storage_path": str(STORAGE_PATH),
            "llm_model": "mistral",
            "ollama_base_url": "http://localhost:11434",
            "openai_api_key": None,
            "anthropic_api_key": None,
            "gemini_api_key": None,
        }
        with open(CONFIG_PATH, "w") as f:
            json.dump(default_config, f, indent=2)
        logger.info("First run: created ~/.smriti/config.json with default settings.")


# ── Config loader ──────────────────────────────────────────────────────────
def load_config() -> SmritiConfig:
    """Load configuration from ~/.smriti/config.json or return safe defaults."""
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r") as f:
                data = json.load(f)

            return SmritiConfig(
                storage_path=data.get("storage_path", str(STORAGE_PATH)),
                llm_model=data.get("llm_model", "mistral"),
                ollama_base_url=data.get("ollama_base_url", "http://localhost:11434"),
                openai_api_key=data.get("openai_api_key"),
                anthropic_api_key=data.get("anthropic_api_key"),
                gemini_api_key=data.get("gemini_api_key"),
            )
        except Exception as e:
            logger.error(f"Error loading config.json: {e} — using defaults.")

    return SmritiConfig(storage_path=str(STORAGE_PATH))


# ── SMRITI singleton ───────────────────────────────────────────────────────
def get_smriti() -> SMRITI:
    global _smriti_instance
    if _smriti_instance is None:
        config = load_config()
        logger.info(
            f"Initializing SMRITI | storage: {config.storage_path} | model: {config.llm_model}"
        )
        _smriti_instance = SMRITI(config)
    return _smriti_instance


def reload_smriti():
    global _smriti_instance
    _smriti_instance = None
    get_smriti()


# ── HTTP handler ───────────────────────────────────────────────────────────
class DesktopDaemonHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):  # noqa: A002
        """Suppress default access-log noise; use our logger instead."""
        logger.debug(f"{self.address_string()} - {format % args}")

    def _respond(self, status: int, content_type: str, body: bytes):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ── GET routes ─────────────────────────────────────────────────────────
    def do_GET(self):  # noqa: N802
        try:
            if self.path == "/api/health":
                smriti = get_smriti()
                palace = smriti.palace
                payload = {
                    "status": "ok",
                    "memories": len(palace.memories),
                    "rooms": len(palace.rooms),
                }
                self._respond(200, "application/json", json.dumps(payload).encode())

            elif self.path == "/api/graph":
                smriti = get_smriti()
                palace = smriti.palace

                nodes = []
                for mem in palace.memories.values():
                    nodes.append(
                        {
                            "id": mem.id,
                            "content": mem.content,
                            "room_id": mem.room_id,
                            "strength": round(mem.strength, 3),
                            "status": mem.status.value if hasattr(mem.status, "value") else str(mem.status),
                            "visibility": mem.visibility.value if hasattr(mem.visibility, "value") else str(mem.visibility),
                            "reflection_level": getattr(mem, "reflection_level", 0),
                            "created_at": mem.creation_time.isoformat() if getattr(mem, "creation_time", None) else None,
                        }
                    )

                edges = []
                for room_edges in getattr(palace, "_adj", {}).values():
                    for edge in room_edges:
                        edges.append(
                            {
                                "source": f"room:{edge.source_room_id}",
                                "target": f"room:{edge.target_room_id}",
                                "weight": round(edge.strength, 3),
                                "relationship": getattr(edge, "relationship", ""),
                            }
                        )

                rooms = []
                for room in palace.rooms.values():
                    rooms.append(
                        {
                            "id": room.id,
                            "topic": getattr(room, "topic", ""),
                            "name": getattr(room, "topic", ""),  # Keep for backward compatibility
                            "visibility": room.visibility.value if hasattr(room.visibility, "value") else str(room.visibility),
                            "memory_count": len(room.memory_ids),
                        }
                    )

                stats = {
                    "total_memories": len(palace.memories),
                    "total_rooms": len(palace.rooms),
                }

                payload = {
                    "memories": nodes,
                    "nodes": nodes,
                    "edges": edges,
                    "rooms": rooms,
                    "stats": stats
                }
                self._respond(200, "application/json", json.dumps(payload).encode())

            elif self.path == "/api/stats":
                smriti = get_smriti()
                stats = smriti.get_stats()
                self._respond(200, "application/json", json.dumps(stats, default=str).encode())

            elif self.path == "/api/pending":
                smriti = get_smriti()
                pending = smriti.episode_buffer.get_unconsolidated(limit=50)
                episodes = []
                for ep in pending:
                    episodes.append(
                        {
                            "id": ep.id,
                            "content": ep.content,
                            "timestamp": ep.timestamp.isoformat() if getattr(ep, "timestamp", None) else None,
                            "created_at": ep.timestamp.isoformat() if getattr(ep, "timestamp", None) else None,
                            "salience": getattr(ep.salience, "composite", 0.0) if ep.salience else 0.0,
                        }
                    )
                self._respond(200, "application/json", json.dumps({"episodes": episodes}).encode())

            elif self.path == "/api/config":
                config_data = {}
                if CONFIG_PATH.exists():
                    with open(CONFIG_PATH, "r") as f:
                        config_data = json.load(f)
                    # Redact API keys for safety
                    for key in ("openai_api_key", "anthropic_api_key", "gemini_api_key"):
                        if config_data.get(key):
                            config_data[key] = "••••••••"
                self._respond(200, "application/json", json.dumps(config_data).encode())

            else:
                self._respond(404, "application/json", b'{"error": "Endpoint not found"}')

        except Exception as e:
            logger.error(f"Error handling GET {self.path}: {e}")
            logger.error(traceback.format_exc())
            self._respond(500, "application/json", json.dumps({"error": str(e)}).encode())

    # ── POST routes ────────────────────────────────────────────────────────
    def do_POST(self):  # noqa: N802
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(content_length) or b"{}") if content_length else {}

            smriti = get_smriti()

            if self.path == "/api/encode":
                content = body.get("content", "").strip()
                if not content:
                    self._respond(400, "application/json", b'{"error": "content is required"}')
                    return

                visibility_raw = body.get("visibility", "shared")
                visibility = (
                    Visibility.PRIVATE if visibility_raw == "private" else Visibility.SHARED
                )

                memory = smriti.encode(
                    content=content,
                    source=MemorySource.DIRECT,
                    modality=Modality.TEXT,
                    visibility=visibility,
                )
                smriti.save()

                result = {
                    "id": memory.id if memory else None,
                    "status": "encoded",
                    "content_preview": content[:80] + "..." if len(content) > 80 else content,
                }
                self._respond(200, "application/json", json.dumps(result).encode())

            elif self.path == "/api/consolidate":
                stats = smriti.consolidate()
                smriti.save()
                self._respond(
                    200,
                    "application/json",
                    json.dumps({"status": "success", "stats": str(stats)}).encode(),
                )

            elif self.path == "/api/config":
                # Save updated config
                data = body
                SMRITI_HOME.mkdir(parents=True, exist_ok=True)
                # Preserve existing API keys if the incoming value is redacted
                existing = {}
                if CONFIG_PATH.exists():
                    with open(CONFIG_PATH, "r") as f:
                        existing = json.load(f)
                for key in ("openai_api_key", "anthropic_api_key", "gemini_api_key"):
                    if data.get(key) == "••••••••":
                        data[key] = existing.get(key)
                with open(CONFIG_PATH, "w") as f:
                    json.dump(data, f, indent=2)
                reload_smriti()
                self._respond(200, "application/json", b'{"status": "config saved"}')

            elif self.path == "/api/forget":
                memory_id = body.get("id")
                if not memory_id:
                    self._respond(400, "application/json", b'{"error": "id is required"}')
                    return
                smriti.forget(memory_id)
                smriti.save()
                self._respond(200, "application/json", b'{"status": "forgotten"}')

            elif self.path == "/api/recall":
                query = body.get("query", "").strip()
                if not query:
                    self._respond(400, "application/json", b'{"error": "query is required"}')
                    return
                memories = smriti.recall(query)
                results = []
                for m in memories:
                    results.append(
                        {
                            "id": m.id,
                            "content": m.content,
                            "strength": round(m.strength, 3),
                            "status": m.status.value if hasattr(m.status, "value") else str(m.status),
                        }
                    )
                self._respond(200, "application/json", json.dumps(results).encode())

            else:
                self._respond(404, "application/json", b'{"error": "Endpoint not found"}')

        except Exception as e:
            logger.error(f"Error handling POST {self.path}: {e}")
            logger.error(traceback.format_exc())
            self._respond(500, "application/json", json.dumps({"error": str(e)}).encode())


def monitor_parent():
    """Periodically checks if the parent Tauri process has died.
    In Unix/macOS, when a parent dies, the child process is adopted by init (PID 1).
    """
    initial_ppid = os.getppid()
    if initial_ppid == 1:
        return  # detached start
    while True:
        time.sleep(1)
        if os.getppid() == 1:
            logger.info("Parent Tauri process terminated. Exiting sidecar to release port...")
            os._exit(0)


# ── Entry point ────────────────────────────────────────────────────────────
def run_daemon(port: int = 7799):
    bootstrap_first_run()
    # Enable immediate port reuse to prevent "Address already in use" errors during dev restarts
    HTTPServer.allow_reuse_address = True
    
    # Start parent process liveness monitor thread
    monitor_thread = threading.Thread(target=monitor_parent, daemon=True)
    monitor_thread.start()

    server = HTTPServer(("127.0.0.1", port), DesktopDaemonHandler)
    logger.info(f"SMRITI Desktop Daemon running at http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Stopping SMRITI Desktop Daemon...")
    finally:
        server.server_close()


if __name__ == "__main__":
    port_arg = 7799
    if len(sys.argv) > 1:
        try:
            port_arg = int(sys.argv[1])
        except ValueError:
            pass
    run_daemon(port_arg)
