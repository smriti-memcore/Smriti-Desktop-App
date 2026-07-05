import os
import sys
import json
import logging
import traceback
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer

# Add Smriti repository to path to enable local import (Option B)
# We assume the user has the repository at /Users/shivtatva/HomeProjects/Memory
sys.path.insert(0, "/Users/shivtatva/HomeProjects/Memory")

from smriti_memcore.core import SMRITI
from smriti_memcore.models import SmritiConfig, MemorySource, Modality, Visibility

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("smriti-desktop-daemon")

CONFIG_PATH = Path("~/.smriti/config.json").expanduser()
_smriti_instance = None

def load_config() -> SmritiConfig:
    """Load configuration from ~/.smriti/config.json or return default."""
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r") as f:
                data = json.load(f)
                
            # Resolve standard SmritiConfig keys
            llm_model = data.get("llm_model", "mistral")
            ollama_url = data.get("ollama_base_url", "http://localhost:11434")
            
            # Resolve API Keys
            openai_key = data.get("openai_api_key")
            anthropic_key = data.get("anthropic_api_key")
            gemini_key = data.get("gemini_api_key")
            
            storage_path = data.get("storage_path", "~/.smriti/global")
            
            return SmritiConfig(
                storage_path=storage_path,
                llm_model=llm_model,
                ollama_base_url=ollama_url,
                openai_api_key=openai_key,
                anthropic_api_key=anthropic_key,
                gemini_api_key=gemini_key
            )
        except Exception as e:
            logger.error(f"Error loading config.json: {e}")
            
    return SmritiConfig()

def get_smriti() -> SMRITI:
    """Singleton getter for SMRITI instance."""
    global _smriti_instance
    if _smriti_instance is None:
        config = load_config()
        logger.info(f"Initializing SMRITI instance with storage_path: {config.storage_path}, model: {config.llm_model}")
        _smriti_instance = SMRITI(config)
    return _smriti_instance

def reload_smriti():
    """Re-load SMRITI instance when config changes."""
    global _smriti_instance
    _smriti_instance = None
    get_smriti()


class DesktopDaemonHandler(BaseHTTPRequestHandler):
    
    def log_message(self, format, *args):
        pass  # Silence normal logs, keep stdout clean
        
    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        
    def _respond(self, code: int, content_type: str, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            if self.path == "/api/health":
                smriti = get_smriti()
                res = {
                    "status": "ok",
                    "storage_path": smriti.config.storage_path,
                    "model": smriti.config.llm_model,
                    "ollama_base_url": smriti.config.ollama_base_url
                }
                self._respond(200, "application/json", json.dumps(res).encode())
                
            elif self.path == "/api/config":
                config_data = {}
                if CONFIG_PATH.exists():
                    try:
                        with open(CONFIG_PATH, "r") as f:
                            config_data = json.load(f)
                    except Exception:
                        pass
                if not config_data:
                    # Provide defaults
                    smriti = get_smriti()
                    config_data = {
                        "storage_mode": "local",
                        "storage_path": smriti.config.storage_path,
                        "llm_provider": "ollama",
                        "llm_model": smriti.config.llm_model,
                        "ollama_base_url": smriti.config.ollama_base_url,
                        "openai_api_key": smriti.config.openai_api_key or "",
                        "anthropic_api_key": smriti.config.anthropic_api_key or "",
                        "gemini_api_key": smriti.config.gemini_api_key or ""
                    }
                self._respond(200, "application/json", json.dumps(config_data).encode())
                
            elif self.path == "/api/graph":
                smriti = get_smriti()
                # Read Palace memory elements
                memories = []
                for m_id, m in smriti.palace.memories.items():
                    memories.append({
                        "id": m.id,
                        "content": m.content,
                        "room_id": m.room_id,
                        "strength": m.strength,
                        "status": m.status.value if hasattr(m.status, 'value') else str(m.status),
                        "visibility": m.visibility.value if hasattr(m.visibility, 'value') else str(m.visibility),
                        "reflection_level": m.reflection_level,
                        "created_at": m.creation_time.isoformat() if hasattr(m.creation_time, 'isoformat') else str(m.creation_time)
                    })
                
                rooms = []
                for r_id, r in smriti.palace.rooms.items():
                    rooms.append({
                        "id": r.id,
                        "topic": r.topic,
                        "visibility": r.visibility.value if hasattr(r.visibility, 'value') else str(r.visibility)
                    })
                    
                # Format response similarly to the built-in graph server
                res = {
                    "memories": memories,
                    "rooms": rooms,
                    "stats": {
                        "total_memories": len(memories),
                        "total_rooms": len(rooms),
                    }
                }
                self._respond(200, "application/json", json.dumps(res).encode())
                
            elif self.path == "/api/episodes":
                smriti = get_smriti()
                # Read recent unconsolidated episodes
                episodes = []
                # Fetch recent items from episode_buffer if accessible
                if hasattr(smriti.episode_buffer, "episodes"):
                    for ep in smriti.episode_buffer.episodes.values():
                        episodes.append({
                            "id": ep.id,
                            "content": ep.content,
                            "timestamp": ep.timestamp.isoformat() if hasattr(ep.timestamp, 'isoformat') else str(ep.timestamp),
                            "salience": ep.salience.composite if hasattr(ep.salience, 'composite') else 0.5
                        })
                self._respond(200, "application/json", json.dumps(episodes).encode())
                
            else:
                self._respond(404, "application/json", b'{"error": "Endpoint not found"}')
                
        except Exception as e:
            logger.error(f"Error handling GET {self.path}: {e}")
            logger.error(traceback.format_exc())
            self._respond(500, "application/json", json.dumps({"error": str(e)}).encode())

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            body = json.loads(post_data) if post_data else {}
            
            if self.path == "/api/config":
                # Save new configuration
                CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
                
                # Align frontend parameters to SmritiConfig
                storage_mode = body.get("storage_mode", "local")
                llm_provider = body.get("llm_provider", "ollama")
                llm_model = body.get("llm_model", "mistral")
                
                config_to_save = {
                    "storage_mode": storage_mode,
                    "storage_path": body.get("storage_path", "~/.smriti/global"),
                    "cloud_endpoint": body.get("cloud_endpoint", ""),
                    "cloud_token": body.get("cloud_token", ""),
                    "llm_provider": llm_provider,
                    "llm_model": llm_model,
                    "ollama_base_url": body.get("ollama_base_url", "http://localhost:11434"),
                    "openai_api_key": body.get("openai_api_key", ""),
                    "anthropic_api_key": body.get("anthropic_api_key", ""),
                    "gemini_api_key": body.get("gemini_api_key", "")
                }
                
                with open(CONFIG_PATH, "w") as f:
                    json.dump(config_to_save, f, indent=2)
                
                # Reload engine with new settings
                reload_smriti()
                logger.info("Successfully updated SMRITI configuration.")
                self._respond(200, "application/json", b'{"status": "saved"}')
                
            elif self.path == "/api/encode":
                content = body.get("content")
                if not content:
                    self._respond(400, "application/json", b'{"error": "content is required"}')
                    return
                    
                context = body.get("context", "")
                private = body.get("private", False)
                
                # Determine visibility
                visibility = Visibility.PRIVATE if private else Visibility.SHARED
                
                smriti = get_smriti()
                source = MemorySource.USER_STATED
                m_id = smriti.encode(content, context=context, source=source)
                
                # If private, explicitly override memory visibility
                if m_id and private:
                    memory = smriti.palace.memories.get(m_id)
                    if memory:
                        memory.visibility = Visibility.PRIVATE
                
                if m_id:
                    smriti.save()
                
                self._respond(200, "application/json", json.dumps({"status": "success", "id": m_id}).encode())
                
            elif self.path == "/api/recall":
                query = body.get("query")
                if not query:
                    self._respond(400, "application/json", b'{"error": "query is required"}')
                    return
                    
                smriti = get_smriti()
                recalled_memories = smriti.recall(query)
                
                results = []
                for m in recalled_memories:
                    results.append({
                        "id": m.id,
                        "content": m.content,
                        "strength": m.strength,
                        "status": m.status.value if hasattr(m.status, 'value') else str(m.status)
                    })
                self._respond(200, "application/json", json.dumps(results).encode())
                
            elif self.path == "/api/consolidate":
                smriti = get_smriti()
                logger.info("Triggering background consolidation...")
                stats = smriti.consolidate()
                smriti.save()
                self._respond(200, "application/json", json.dumps({"status": "success", "stats": str(stats)}).encode())
                
            else:
                self._respond(404, "application/json", b'{"error": "Endpoint not found"}')
                
        except Exception as e:
            logger.error(f"Error handling POST {self.path}: {e}")
            logger.error(traceback.format_exc())
            self._respond(500, "application/json", json.dumps({"error": str(e)}).encode())


def run_daemon(port=7799):
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
