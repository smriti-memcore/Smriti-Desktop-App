"""
Test suite for the SMRITI Desktop Daemon sidecar API.

Validates every HTTP endpoint the frontend depends on, config handling,
first-run bootstrap, and error paths.

Run:
    python3 -m pytest sidecars/tests/test_daemon.py -v

Or without pytest:
    python3 -m unittest sidecars/tests/test_daemon.py -v
"""

import json
import os
import sys
import shutil
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock
from http.server import HTTPServer

# ── Ensure the sidecars directory is importable ────────────────────────────
SIDECARS_DIR = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(SIDECARS_DIR))

# We need to mock smriti_memcore before importing the daemon,
# since it may not be installed in the test environment.
# For tests that need real behavior, we mock at the function level.

# Create mock modules so `import smriti_memcore.*` succeeds at module load
mock_smriti_memcore = MagicMock()
mock_core = MagicMock()
mock_models = MagicMock()

# Create mock classes that the daemon imports
class MockVisibility:
    SHARED = "shared"
    PRIVATE = "private"

class MockMemorySource:
    DIRECT = "direct"

class MockModality:
    TEXT = "text"

mock_models.SmritiConfig = MagicMock
mock_models.MemorySource = MockMemorySource
mock_models.Modality = MockModality
mock_models.Visibility = MockVisibility

sys.modules["smriti_memcore"] = mock_smriti_memcore
sys.modules["smriti_memcore.core"] = mock_core
sys.modules["smriti_memcore.models"] = mock_models

# Now import the daemon module
import desktop_daemon as daemon


# ── Test fixtures ──────────────────────────────────────────────────────────

class FakeRequest:
    """Simulate an HTTP request body for the handler."""

    def __init__(self, method: str, path: str, body: dict | None = None):
        self.method = method
        self.path = path
        self.body_bytes = json.dumps(body).encode() if body else b""


def make_handler(method: str, path: str, body: dict | None = None):
    """Create a DesktopDaemonHandler with a fake request wired in."""
    handler = daemon.DesktopDaemonHandler.__new__(daemon.DesktopDaemonHandler)
    handler.path = path
    handler.command = method

    # Mock the header / response plumbing
    body_bytes = json.dumps(body).encode() if body else b""
    handler.headers = {"Content-Length": str(len(body_bytes)), "Content-Type": "application/json"}
    handler.rfile = BytesIO(body_bytes)
    handler.wfile = BytesIO()

    # Capture response
    handler._response_code = None
    handler._response_body = None

    def fake_respond(status, content_type, body_out):
        handler._response_code = status
        handler._response_body = json.loads(body_out.decode())

    handler._respond = fake_respond
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    return handler


# ── Bootstrap Tests ────────────────────────────────────────────────────────

class TestBootstrap(unittest.TestCase):
    """Test first-run bootstrap creates ~/.smriti/ correctly."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.orig_home = daemon.SMRITI_HOME
        self.orig_config = daemon.CONFIG_PATH
        self.orig_storage = daemon.STORAGE_PATH

        daemon.SMRITI_HOME = Path(self.tmp) / ".smriti"
        daemon.CONFIG_PATH = daemon.SMRITI_HOME / "config.json"
        daemon.STORAGE_PATH = daemon.SMRITI_HOME / "global"

    def tearDown(self):
        daemon.SMRITI_HOME = self.orig_home
        daemon.CONFIG_PATH = self.orig_config
        daemon.STORAGE_PATH = self.orig_storage
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_creates_smriti_home_directory(self):
        daemon.bootstrap_first_run()
        self.assertTrue(daemon.SMRITI_HOME.exists())
        self.assertTrue(daemon.SMRITI_HOME.is_dir())

    def test_creates_global_storage_directory(self):
        daemon.bootstrap_first_run()
        self.assertTrue(daemon.STORAGE_PATH.exists())
        self.assertTrue(daemon.STORAGE_PATH.is_dir())

    def test_creates_default_config(self):
        daemon.bootstrap_first_run()
        self.assertTrue(daemon.CONFIG_PATH.exists())

        with open(daemon.CONFIG_PATH) as f:
            config = json.load(f)

        self.assertEqual(config["llm_model"], "mistral")
        self.assertEqual(config["ollama_base_url"], "http://localhost:11434")
        self.assertIsNone(config["openai_api_key"])
        self.assertIsNone(config["anthropic_api_key"])
        self.assertIsNone(config["gemini_api_key"])
        self.assertIn("storage_path", config)

    def test_does_not_overwrite_existing_config(self):
        daemon.SMRITI_HOME.mkdir(parents=True, exist_ok=True)
        custom = {"llm_model": "gpt-4o", "custom_field": True}
        with open(daemon.CONFIG_PATH, "w") as f:
            json.dump(custom, f)

        daemon.bootstrap_first_run()

        with open(daemon.CONFIG_PATH) as f:
            config = json.load(f)

        self.assertEqual(config["llm_model"], "gpt-4o")
        self.assertTrue(config["custom_field"])

    def test_idempotent_multiple_calls(self):
        daemon.bootstrap_first_run()
        daemon.bootstrap_first_run()
        daemon.bootstrap_first_run()
        self.assertTrue(daemon.CONFIG_PATH.exists())


# ── Config Loading Tests ───────────────────────────────────────────────────

class TestLoadConfig(unittest.TestCase):
    """Test config.json parsing and defaults."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.orig_config = daemon.CONFIG_PATH
        self.orig_storage = daemon.STORAGE_PATH
        daemon.CONFIG_PATH = Path(self.tmp) / "config.json"
        daemon.STORAGE_PATH = Path(self.tmp) / "global"

    def tearDown(self):
        daemon.CONFIG_PATH = self.orig_config
        daemon.STORAGE_PATH = self.orig_storage
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_returns_defaults_when_no_config_file(self):
        config = daemon.load_config()
        # Should not crash, should return a SmritiConfig (mocked)
        self.assertIsNotNone(config)

    def test_loads_valid_config(self):
        valid = {
            "storage_path": "/custom/path",
            "llm_model": "gpt-4o",
            "ollama_base_url": "http://myserver:11434",
            "openai_api_key": "sk-test123",
            "anthropic_api_key": None,
            "gemini_api_key": None,
        }
        with open(daemon.CONFIG_PATH, "w") as f:
            json.dump(valid, f)

        config = daemon.load_config()
        self.assertIsNotNone(config)

    def test_handles_corrupt_config_gracefully(self):
        with open(daemon.CONFIG_PATH, "w") as f:
            f.write("NOT VALID JSON {{{")

        # Should not crash, should return defaults
        config = daemon.load_config()
        self.assertIsNotNone(config)

    def test_handles_empty_config_file(self):
        with open(daemon.CONFIG_PATH, "w") as f:
            f.write("{}")

        config = daemon.load_config()
        self.assertIsNotNone(config)


# ── GET Endpoint Tests ─────────────────────────────────────────────────────

class TestGetEndpoints(unittest.TestCase):
    """Test GET API endpoints return correct shapes."""

    def _mock_smriti(self):
        """Create a mock SMRITI instance with a populated palace."""
        mock = MagicMock()

        # Mock a memory
        mem = MagicMock()
        mem.id = "mem-001"
        mem.content = "Test memory content"
        mem.room_id = "room-001"
        mem.strength = 0.85
        mem.status.value = "active"
        mem.visibility.value = "shared"
        mem.reflection_level = 0
        mem.created_at = "2026-07-05T00:00:00"

        # Mock a room
        room = MagicMock()
        room.id = "room-001"
        room.name = "Test Room"
        room.memory_ids = ["mem-001"]

        # Mock palace
        mock.palace.memories = {"mem-001": mem}
        mock.palace.rooms = {"room-001": room}
        mock.palace.edges = []

        return mock

    @patch.object(daemon, "get_smriti")
    def test_health_returns_200_with_counts(self, mock_get):
        mock_get.return_value = self._mock_smriti()
        handler = make_handler("GET", "/api/health")
        handler.do_GET()

        self.assertEqual(handler._response_code, 200)
        self.assertEqual(handler._response_body["status"], "ok")
        self.assertEqual(handler._response_body["memories"], 1)
        self.assertEqual(handler._response_body["rooms"], 1)

    @patch.object(daemon, "get_smriti")
    def test_graph_returns_nodes_edges_rooms_stats(self, mock_get):
        mock_get.return_value = self._mock_smriti()
        handler = make_handler("GET", "/api/graph")
        handler.do_GET()

        self.assertEqual(handler._response_code, 200)
        body = handler._response_body
        self.assertIn("nodes", body)
        self.assertIn("edges", body)
        self.assertIn("rooms", body)
        self.assertIn("stats", body)
        self.assertEqual(len(body["nodes"]), 1)
        self.assertEqual(body["nodes"][0]["id"], "mem-001")
        self.assertEqual(body["stats"]["total_memories"], 1)

    @patch.object(daemon, "get_smriti")
    def test_graph_node_has_required_fields(self, mock_get):
        mock_get.return_value = self._mock_smriti()
        handler = make_handler("GET", "/api/graph")
        handler.do_GET()

        node = handler._response_body["nodes"][0]
        required_fields = ["id", "content", "room_id", "strength", "status",
                           "visibility", "reflection_level", "created_at"]
        for field in required_fields:
            self.assertIn(field, node, f"Missing field: {field}")

    @patch.object(daemon, "get_smriti")
    def test_pending_returns_episodes(self, mock_get):
        mock = self._mock_smriti()
        ep = MagicMock()
        ep.id = "ep-001"
        ep.content = "Test episode"
        ep.created_at = "2026-07-05T00:00:00"
        mock.episode_buffer.get_unconsolidated.return_value = [ep]
        mock_get.return_value = mock

        handler = make_handler("GET", "/api/pending")
        handler.do_GET()

        self.assertEqual(handler._response_code, 200)
        self.assertIn("episodes", handler._response_body)
        self.assertEqual(len(handler._response_body["episodes"]), 1)

    def test_unknown_get_returns_404(self):
        handler = make_handler("GET", "/api/nonexistent")
        handler.do_GET()
        self.assertEqual(handler._response_code, 404)


# ── POST Endpoint Tests ───────────────────────────────────────────────────

class TestPostEndpoints(unittest.TestCase):
    """Test POST API endpoints."""

    @patch.object(daemon, "get_smriti")
    def test_encode_returns_encoded_status(self, mock_get):
        mock = MagicMock()
        mem = MagicMock()
        mem.id = "mem-new"
        mock.encode.return_value = mem
        mock_get.return_value = mock

        handler = make_handler("POST", "/api/encode", {"content": "Hello world"})
        handler.do_POST()

        self.assertEqual(handler._response_code, 200)
        self.assertEqual(handler._response_body["status"], "encoded")
        self.assertEqual(handler._response_body["id"], "mem-new")
        mock.save.assert_called_once()

    @patch.object(daemon, "get_smriti")
    def test_encode_empty_content_returns_400(self, mock_get):
        mock_get.return_value = MagicMock()
        handler = make_handler("POST", "/api/encode", {"content": ""})
        handler.do_POST()

        self.assertEqual(handler._response_code, 400)

    @patch.object(daemon, "get_smriti")
    def test_encode_whitespace_only_returns_400(self, mock_get):
        mock_get.return_value = MagicMock()
        handler = make_handler("POST", "/api/encode", {"content": "   \n  "})
        handler.do_POST()

        self.assertEqual(handler._response_code, 400)

    @patch.object(daemon, "get_smriti")
    def test_encode_respects_visibility_shared(self, mock_get):
        mock = MagicMock()
        mock.encode.return_value = MagicMock(id="m1")
        mock_get.return_value = mock

        handler = make_handler("POST", "/api/encode",
                               {"content": "test", "visibility": "shared"})
        handler.do_POST()

        call_kwargs = mock.encode.call_args
        self.assertEqual(call_kwargs.kwargs.get("visibility"), MockVisibility.SHARED)

    @patch.object(daemon, "get_smriti")
    def test_encode_respects_visibility_private(self, mock_get):
        mock = MagicMock()
        mock.encode.return_value = MagicMock(id="m1")
        mock_get.return_value = mock

        handler = make_handler("POST", "/api/encode",
                               {"content": "secret", "visibility": "private"})
        handler.do_POST()

        call_kwargs = mock.encode.call_args
        self.assertEqual(call_kwargs.kwargs.get("visibility"), MockVisibility.PRIVATE)

    @patch.object(daemon, "get_smriti")
    def test_encode_defaults_to_shared_visibility(self, mock_get):
        mock = MagicMock()
        mock.encode.return_value = MagicMock(id="m1")
        mock_get.return_value = mock

        handler = make_handler("POST", "/api/encode",
                               {"content": "no visibility field"})
        handler.do_POST()

        call_kwargs = mock.encode.call_args
        self.assertEqual(call_kwargs.kwargs.get("visibility"), MockVisibility.SHARED)

    @patch.object(daemon, "get_smriti")
    def test_consolidate_returns_success(self, mock_get):
        mock = MagicMock()
        mock.consolidate.return_value = {"new_memories": 2}
        mock_get.return_value = mock

        handler = make_handler("POST", "/api/consolidate")
        handler.do_POST()

        self.assertEqual(handler._response_code, 200)
        self.assertEqual(handler._response_body["status"], "success")
        mock.save.assert_called_once()

    @patch.object(daemon, "get_smriti")
    def test_forget_requires_id(self, mock_get):
        mock_get.return_value = MagicMock()
        handler = make_handler("POST", "/api/forget", {})
        handler.do_POST()

        self.assertEqual(handler._response_code, 400)

    @patch.object(daemon, "get_smriti")
    def test_forget_with_id_returns_forgotten(self, mock_get):
        mock = MagicMock()
        mock_get.return_value = mock

        handler = make_handler("POST", "/api/forget", {"id": "mem-001"})
        handler.do_POST()

        self.assertEqual(handler._response_code, 200)
        self.assertEqual(handler._response_body["status"], "forgotten")
        mock.forget.assert_called_once_with("mem-001")
        mock.save.assert_called_once()

    def test_unknown_post_returns_404(self):
        handler = make_handler("POST", "/api/nonexistent", {})
        handler.do_POST()
        self.assertEqual(handler._response_code, 404)


# ── Config API Tests ───────────────────────────────────────────────────────

class TestConfigEndpoint(unittest.TestCase):
    """Test GET/POST /api/config — key redaction, preservation, and save."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.orig_home = daemon.SMRITI_HOME
        self.orig_config = daemon.CONFIG_PATH
        self.orig_storage = daemon.STORAGE_PATH

        daemon.SMRITI_HOME = Path(self.tmp) / ".smriti"
        daemon.CONFIG_PATH = daemon.SMRITI_HOME / "config.json"
        daemon.STORAGE_PATH = daemon.SMRITI_HOME / "global"
        daemon.SMRITI_HOME.mkdir(parents=True)

    def tearDown(self):
        daemon.SMRITI_HOME = self.orig_home
        daemon.CONFIG_PATH = self.orig_config
        daemon.STORAGE_PATH = self.orig_storage
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_get_config_redacts_api_keys(self):
        config = {
            "llm_model": "gpt-4o",
            "openai_api_key": "sk-real-secret-key-12345",
            "anthropic_api_key": "sk-ant-real-key",
            "gemini_api_key": None,
        }
        with open(daemon.CONFIG_PATH, "w") as f:
            json.dump(config, f)

        handler = make_handler("GET", "/api/config")
        handler.do_GET()

        self.assertEqual(handler._response_code, 200)
        body = handler._response_body
        self.assertEqual(body["openai_api_key"], "••••••••")
        self.assertEqual(body["anthropic_api_key"], "••••••••")
        # None keys should not be redacted
        self.assertIsNone(body.get("gemini_api_key"))

    @patch.object(daemon, "reload_smriti")
    def test_post_config_preserves_redacted_keys(self, mock_reload):
        # Existing config has a real key
        existing = {
            "llm_model": "gpt-4o",
            "openai_api_key": "sk-real-key-DO-NOT-LOSE",
            "anthropic_api_key": None,
            "gemini_api_key": None,
        }
        with open(daemon.CONFIG_PATH, "w") as f:
            json.dump(existing, f)

        # Frontend sends back redacted value
        update = {
            "llm_model": "mistral",
            "openai_api_key": "••••••••",
            "anthropic_api_key": None,
            "gemini_api_key": None,
        }
        handler = make_handler("POST", "/api/config", update)
        handler.do_POST()

        self.assertEqual(handler._response_code, 200)

        # Verify the real key was preserved on disk
        with open(daemon.CONFIG_PATH) as f:
            saved = json.load(f)
        self.assertEqual(saved["openai_api_key"], "sk-real-key-DO-NOT-LOSE")
        self.assertEqual(saved["llm_model"], "mistral")

    @patch.object(daemon, "reload_smriti")
    def test_post_config_saves_new_keys(self, mock_reload):
        existing = {"llm_model": "mistral", "openai_api_key": None}
        with open(daemon.CONFIG_PATH, "w") as f:
            json.dump(existing, f)

        update = {
            "llm_model": "gpt-4o",
            "openai_api_key": "sk-brand-new-key",
            "anthropic_api_key": None,
            "gemini_api_key": None,
        }
        handler = make_handler("POST", "/api/config", update)
        handler.do_POST()

        with open(daemon.CONFIG_PATH) as f:
            saved = json.load(f)
        self.assertEqual(saved["openai_api_key"], "sk-brand-new-key")


# ── Error Handling Tests ───────────────────────────────────────────────────

class TestErrorHandling(unittest.TestCase):
    """Verify error paths return 500 with JSON error body."""

    @patch.object(daemon, "get_smriti", side_effect=Exception("SMRITI init failed"))
    def test_get_health_error_returns_500(self, mock_get):
        handler = make_handler("GET", "/api/health")
        handler.do_GET()
        self.assertEqual(handler._response_code, 500)
        self.assertIn("error", handler._response_body)

    @patch.object(daemon, "get_smriti", side_effect=Exception("DB locked"))
    def test_post_encode_error_returns_500(self, mock_get):
        handler = make_handler("POST", "/api/encode", {"content": "test"})
        handler.do_POST()
        self.assertEqual(handler._response_code, 500)
        self.assertIn("error", handler._response_body)

    @patch.object(daemon, "get_smriti")
    def test_encode_save_failure_returns_500(self, mock_get):
        mock = MagicMock()
        mock.encode.return_value = MagicMock(id="m1")
        mock.save.side_effect = IOError("Disk full")
        mock_get.return_value = mock

        handler = make_handler("POST", "/api/encode", {"content": "test"})
        handler.do_POST()
        self.assertEqual(handler._response_code, 500)


# ── Content Truncation Tests ───────────────────────────────────────────────

class TestContentPreview(unittest.TestCase):
    """Verify encode response truncates long content correctly."""

    @patch.object(daemon, "get_smriti")
    def test_short_content_not_truncated(self, mock_get):
        mock = MagicMock()
        mock.encode.return_value = MagicMock(id="m1")
        mock_get.return_value = mock

        handler = make_handler("POST", "/api/encode", {"content": "Short text"})
        handler.do_POST()

        self.assertEqual(handler._response_body["content_preview"], "Short text")

    @patch.object(daemon, "get_smriti")
    def test_long_content_truncated_at_80_chars(self, mock_get):
        mock = MagicMock()
        mock.encode.return_value = MagicMock(id="m1")
        mock_get.return_value = mock

        long_text = "A" * 200
        handler = make_handler("POST", "/api/encode", {"content": long_text})
        handler.do_POST()

        preview = handler._response_body["content_preview"]
        self.assertTrue(preview.endswith("..."))
        self.assertEqual(len(preview), 83)  # 80 chars + "..."


if __name__ == "__main__":
    unittest.main()
