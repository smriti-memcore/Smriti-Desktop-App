#!/usr/bin/env python3
"""
AIMeter Core Module for Smriti Desktop Daemon
Provides local LLM API proxy, token calculation, Claude Code watcher, and SQLite cost analytics.
"""

import os
import sys
import json
import sqlite3
import re
import urllib.request
import urllib.parse
import http.client
import ssl
import threading
import time
import logging
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger("smriti-aimeter")

# Paths & Directories
SMRITI_DIR = Path("~/.smriti").expanduser()
LEGACY_AIMETER_DIR = Path("~/.aimeter").expanduser()

SMRITI_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = SMRITI_DIR / "usage.db"
PRICE_MAP_PATH = SMRITI_DIR / "model_prices.json"

# Fallback Pricing dictionary (per 1 Million tokens)
FALLBACK_PRICING = {
    # Anthropic
    "claude-3-5-sonnet": {"input": 3.00, "output": 15.00},
    "claude-3.5-sonnet": {"input": 3.00, "output": 15.00},
    "claude-3-7-sonnet": {"input": 3.00, "output": 15.00},
    "claude-3.7-sonnet": {"input": 3.00, "output": 15.00},
    "claude-3-5-haiku": {"input": 0.80, "output": 4.00},
    "claude-3-opus": {"input": 15.00, "output": 75.00},
    # OpenAI
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "o1": {"input": 15.00, "output": 60.00},
    "o1-preview": {"input": 15.00, "output": 60.00},
    "o1-mini": {"input": 3.00, "output": 12.00},
    "o3-mini": {"input": 1.10, "output": 4.40},
    # Gemini
    "gemini-1.5-pro": {"input": 1.25, "output": 5.00},
    "gemini-1.5-flash": {"input": 0.075, "output": 0.30},
    "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "gemini-2.0-flash-lite": {"input": 0.075, "output": 0.30},
    "gemini-2.5-pro": {"input": 1.25, "output": 5.00},
}


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost REAL NOT NULL,
        source TEXT NOT NULL,
        request_id TEXT UNIQUE NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS config (
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS pricing_overrides (
        model TEXT UNIQUE NOT NULL,
        input_cost_per_m REAL NOT NULL,
        output_cost_per_m REAL NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS file_positions (
        path TEXT PRIMARY KEY,
        last_size INTEGER NOT NULL
    )
    """)

    cursor.execute("INSERT OR IGNORE INTO config (key, value) VALUES ('daily_budget', '5.00')")
    cursor.execute("INSERT OR IGNORE INTO config (key, value) VALUES ('proxy_port', '5333')")

    # If legacy ~/.aimeter/usage.db exists, sync any missing records
    legacy_db = LEGACY_AIMETER_DIR / "usage.db"
    if legacy_db.exists():
        try:
            legacy_conn = sqlite3.connect(str(legacy_db))
            legacy_conn.row_factory = sqlite3.Row
            lcur = legacy_conn.cursor()
            lcur.execute("SELECT * FROM usage_logs")
            for row in lcur.fetchall():
                cursor.execute("""
                INSERT OR IGNORE INTO usage_logs (timestamp, provider, model, input_tokens, output_tokens, cost, source, request_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (row["timestamp"], row["provider"], row["model"], row["input_tokens"], row["output_tokens"], row["cost"], row["source"], row["request_id"]))
            legacy_conn.close()
        except Exception as e:
            logger.debug(f"Could not sync legacy records: {e}")

    conn.commit()
    conn.close()
    logger.info(f"AIMeter database initialized at {DB_PATH}")


def normalize_timestamp(ts):
    if not ts:
        return datetime.now().isoformat()
    if isinstance(ts, (int, float)):
        if ts > 1e11:  # epoch milliseconds
            ts = ts / 1000.0
        return datetime.fromtimestamp(ts).isoformat()
    if isinstance(ts, str):
        if ts.isdigit():
            val = float(ts)
            if val > 1e11:
                val = val / 1000.0
            return datetime.fromtimestamp(val).isoformat()
        try:
            clean_ts = ts.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_ts)
            return dt.astimezone().replace(tzinfo=None).isoformat()
        except Exception:
            return ts
    return datetime.now().isoformat()


def log_usage(provider, model, input_tokens, output_tokens, cost, source, request_id, timestamp=None):
    conn = get_db()
    cursor = conn.cursor()
    norm_ts = normalize_timestamp(timestamp)
    try:
        cursor.execute("""
        INSERT INTO usage_logs (timestamp, provider, model, input_tokens, output_tokens, cost, source, request_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (norm_ts, provider, model, input_tokens, output_tokens, cost, source, request_id))
        conn.commit()
        logger.info(f"[AIMeter - {source}] {model} ({input_tokens} -> {output_tokens}) Cost: ${cost:.6f}")
    except sqlite3.IntegrityError:
        pass
    finally:
        conn.close()


# ── LiteLLM Price Registry ──────────────────────────────────────────────────
class PriceRegistry:
    def __init__(self):
        self.prices = {}
        self.load_cache()
        threading.Thread(target=self.fetch_latest_prices, daemon=True).start()

    def load_cache(self):
        if PRICE_MAP_PATH.exists():
            try:
                with open(PRICE_MAP_PATH, "r") as f:
                    self.prices = json.load(f)
            except Exception as e:
                logger.warning(f"Error reading cached prices: {e}")

    def fetch_latest_prices(self):
        url = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Smriti-AIMeter/1.0"})
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode("utf-8"))
                self.prices = data
                with open(PRICE_MAP_PATH, "w") as f:
                    json.dump(data, f)
        except Exception as e:
            logger.debug(f"Could not fetch remote pricing registry (using cached/fallback): {e}")

    def get_pricing(self, model_name: str) -> dict:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT input_cost_per_m, output_cost_per_m FROM pricing_overrides WHERE model = ?", (model_name,))
        row = cursor.fetchone()
        conn.close()

        if row:
            return {
                "input": row["input_cost_per_m"],
                "output": row["output_cost_per_m"],
                "cache_creation": row["input_cost_per_m"] * 1.25,
                "cache_read": row["input_cost_per_m"] * 0.1,
            }

        clean_name = model_name.lower().strip()
        # Direct lookup in fetched LiteLLM pricing
        if clean_name in self.prices:
            p = self.prices[clean_name]
            in_cost = p.get("input_cost_per_token", 0.0) * 1_000_000.0
            out_cost = p.get("output_cost_per_token", 0.0) * 1_000_000.0
            cache_create = p.get("cache_creation_input_token_cost", in_cost * 1.25) * 1_000_000.0
            cache_read = p.get("cache_read_input_token_cost", in_cost * 0.1) * 1_000_000.0
            return {
                "input": in_cost or 3.0,
                "output": out_cost or 15.0,
                "cache_creation": cache_create or 3.75,
                "cache_read": cache_read or 0.30,
            }

        # Fuzzy match fallback
        for key, val in FALLBACK_PRICING.items():
            if key in clean_name:
                return {
                    "input": val["input"],
                    "output": val["output"],
                    "cache_creation": val.get("cache_creation", val["input"] * 1.25),
                    "cache_read": val.get("cache_read", val["input"] * 0.1),
                }

        # Default fallback
        return {"input": 3.00, "output": 15.00, "cache_creation": 3.75, "cache_read": 0.30}


price_registry = PriceRegistry()


# ── Claude Code Log Watcher ────────────────────────────────────────────────
class ClaudeLogWatcher:
    def __init__(self):
        self.running = True
        self.file_positions = {}

    def start(self):
        logger.info("Starting Claude Code log watcher thread...")
        threading.Thread(target=self.watch_loop, daemon=True).start()

    def stop(self):
        self.running = False

    def watch_loop(self):
        time.sleep(2)
        candidate_dirs = [
            Path("~/.claude/projects").expanduser(),
            Path("~/.claude/sessions").expanduser(),
            Path("~/.config/claude/projects").expanduser(),
            Path("~/.config/claude").expanduser(),
        ]

        env_dir = os.environ.get("CLAUDE_CONFIG_DIR")
        if env_dir:
            candidate_dirs.insert(0, Path(env_dir).expanduser() / "projects")
            candidate_dirs.insert(0, Path(env_dir).expanduser())

        conn = get_db()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT path, last_size FROM file_positions")
            self.file_positions = {row["path"]: row["last_size"] for row in cursor.fetchall()}
        except Exception:
            self.file_positions = {}
        finally:
            conn.close()

        while self.running:
            try:
                for cdir in candidate_dirs:
                    if cdir.exists():
                        self.scan_projects(str(cdir))
            except Exception as e:
                logger.debug(f"Error in Claude log watcher: {e}")
            time.sleep(3)

    def scan_projects(self, path: str):
        for root, dirs, files in os.walk(path):
            # Avoid descending into git or node_modules directories if any
            dirs[:] = [d for d in dirs if d not in [".git", "node_modules", "cache", "plugins"]]
            for file in files:
                if file.endswith(".jsonl"):
                    file_path = os.path.join(root, file)
                    self.process_file(file_path, file.replace(".jsonl", ""))

    def process_file(self, path: str, session_id: str):
        try:
            stat = os.stat(path)
            curr_size = stat.st_size
            last_size = self.file_positions.get(path, 0)

            if curr_size < last_size:
                last_size = 0

            if curr_size > last_size:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    f.seek(last_size)
                    new_lines = f.readlines()
                    self.file_positions[path] = f.tell()

                    conn = get_db()
                    cursor = conn.cursor()
                    try:
                        cursor.execute(
                            "INSERT OR REPLACE INTO file_positions (path, last_size) VALUES (?, ?)",
                            (path, self.file_positions[path]),
                        )
                        conn.commit()
                    except Exception:
                        pass
                    finally:
                        conn.close()

                    for idx, line in enumerate(new_lines):
                        if not line.strip():
                            continue
                        try:
                            request_id = f"claude_code_{session_id}_{last_size}_{idx}"
                            self.parse_and_log_line(line, request_id)
                        except Exception:
                            pass
        except Exception:
            pass

    def parse_and_log_line(self, line_str: str, request_id: str):
        data = json.loads(line_str)
        # Check various possible schema locations for token usage
        usage = (
            data.get("usage")
            or data.get("message", {}).get("usage")
            or data.get("event", {}).get("usage")
            or data.get("response", {}).get("usage")
            or data.get("stats", {})
        )

        if usage and isinstance(usage, dict):
            timestamp = (
                data.get("timestamp")
                or data.get("message", {}).get("timestamp")
                or data.get("snapshot", {}).get("timestamp")
            )

            # Unique message/item ID if available
            uid = data.get("uuid") or data.get("messageId") or data.get("id")
            if uid:
                request_id = f"claude_code_{uid}"

            input_tokens = (
                usage.get("input_tokens", 0)
                or usage.get("prompt_tokens", 0)
                or usage.get("promptTokenCount", 0)
                or 0
            )
            output_tokens = (
                usage.get("output_tokens", 0)
                or usage.get("completion_tokens", 0)
                or usage.get("candidatesTokenCount", 0)
                or 0
            )
            cache_creation_tokens = usage.get("cache_creation_input_tokens", 0) or 0
            cache_read_tokens = usage.get("cache_read_input_tokens", 0) or 0

            total_input = input_tokens + cache_creation_tokens + cache_read_tokens
            if total_input == 0 and output_tokens == 0:
                return

            model = (
                data.get("model")
                or data.get("message", {}).get("model")
                or data.get("metadata", {}).get("model")
                or "claude-3-7-sonnet"
            )

            pricing = price_registry.get_pricing(model)
            cost = (
                (input_tokens * pricing["input"])
                + (output_tokens * pricing["output"])
                + (cache_creation_tokens * pricing.get("cache_creation", pricing["input"] * 1.25))
                + (cache_read_tokens * pricing.get("cache_read", pricing["input"] * 0.1))
            ) / 1_000_000.0

            log_usage(
                provider="Claude Code",
                model=model,
                input_tokens=total_input,
                output_tokens=output_tokens,
                cost=cost,
                source="Claude Code",
                request_id=request_id,
                timestamp=timestamp,
            )


# ── Proxy Engine ───────────────────────────────────────────────────────────
def handle_proxy_call(method: str, path: str, headers: dict, req_body: bytes) -> tuple:
    """
    Forward HTTP request to real upstream AI provider and return:
    (status_code, response_headers, response_bytes, provider)
    """
    real_host = ""
    real_path = ""
    provider = ""

    if path.startswith("/openai"):
        real_host = "api.openai.com"
        real_path = path.replace("/openai", "")
        provider = "OpenAI"
    elif path.startswith("/anthropic"):
        real_host = "api.anthropic.com"
        real_path = path.replace("/anthropic", "")
        provider = "Anthropic"
    elif path.startswith("/gemini"):
        real_host = "generativelanguage.googleapis.com"
        real_path = path.replace("/gemini", "")
        provider = "Google Gemini"
    elif path.startswith("/openrouter"):
        real_host = "openrouter.ai"
        real_path = path.replace("/openrouter", "")
        provider = "OpenRouter"
    else:
        return 400, {}, b'{"error": "Unknown Proxy Path"}', ""

    out_headers = {}
    for header, value in headers.items():
        if header.lower() not in ["host", "accept-encoding"]:
            out_headers[header] = value
    out_headers["Host"] = real_host
    out_headers["Accept-Encoding"] = "identity"

    try:
        context = ssl.create_default_context()
        conn = http.client.HTTPSConnection(real_host, context=context, timeout=45)
        conn.request(method, real_path, body=req_body, headers=out_headers)
        resp = conn.getresponse()

        resp_headers = {}
        for h, val in resp.getheaders():
            if h.lower() not in ["transfer-encoding", "content-encoding", "access-control-allow-origin", "connection"]:
                resp_headers[h] = val

        body = resp.read()
        conn.close()

        threading.Thread(
            target=analyze_and_log_proxy_call,
            args=(provider, req_body, body),
            daemon=True,
        ).start()

        return resp.status, resp_headers, body, provider

    except Exception as e:
        logger.error(f"Proxy Connection Error: {e}")
        return 502, {"Content-Type": "application/json"}, json.dumps({"error": f"Proxy error: {str(e)}"}).encode(), provider


def analyze_and_log_proxy_call(provider: str, req_bytes: bytes, resp_bytes: bytes):
    try:
        req_str = req_bytes.decode("utf-8", errors="ignore")
        resp_str = resp_bytes.decode("utf-8", errors="ignore")

        model_match = re.search(r'"model"\s*:\s*"([^"]+)"', req_str)
        model = model_match.group(1) if model_match else "unknown"

        input_tokens = 0
        output_tokens = 0

        input_match = (
            re.search(r'"prompt_tokens"\s*:\s*(\d+)', resp_str)
            or re.search(r'"input_tokens"\s*:\s*(\d+)', resp_str)
            or re.search(r'"promptTokenCount"\s*:\s*(\d+)', resp_str)
        )
        if input_match:
            input_tokens = int(input_match.group(1))

        output_match = (
            re.search(r'"completion_tokens"\s*:\s*(\d+)', resp_str)
            or re.search(r'"output_tokens"\s*:\s*(\d+)', resp_str)
            or re.search(r'"candidatesTokenCount"\s*:\s*(\d+)', resp_str)
        )
        if output_match:
            output_tokens = int(output_match.group(1))

        if input_tokens == 0:
            inputs = [int(m) for m in re.findall(r'"input_tokens"\s*:\s*(\d+)', resp_str)]
            if inputs:
                input_tokens = max(inputs)
        if output_tokens == 0:
            outputs = [int(m) for m in re.findall(r'"output_tokens"\s*:\s*(\d+)', resp_str)]
            if outputs:
                output_tokens = max(outputs)

        # Fallback heuristic calculation if streaming or compact JSON
        if input_tokens == 0 and output_tokens == 0:
            messages_match = re.findall(r'"content"\s*:\s*"([^"]+)"', req_str)
            input_char_len = sum(len(m) for m in messages_match)
            if input_char_len > 0:
                input_tokens = max(5, int(input_char_len / 3.8))

            contents_match = re.findall(r'"content"\s*:\s*"([^"]+)"', resp_str) or re.findall(r'"text"\s*:\s*"([^"]+)"', resp_str)
            output_char_len = sum(len(c) for c in contents_match)
            if output_char_len > 0:
                output_tokens = max(5, int(output_char_len / 3.8))

        if input_tokens == 0 and output_tokens == 0:
            return

        cache_creation_match = re.search(r'"cache_creation_input_tokens"\s*:\s*(\d+)', resp_str)
        cache_read_match = re.search(r'"cache_read_input_tokens"\s*:\s*(\d+)', resp_str)
        cache_creation_tokens = int(cache_creation_match.group(1)) if cache_creation_match else 0
        cache_read_tokens = int(cache_read_match.group(1)) if cache_read_match else 0

        pricing = price_registry.get_pricing(model)
        cost = (
            (input_tokens * pricing["input"])
            + (output_tokens * pricing["output"])
            + (cache_creation_tokens * pricing.get("cache_creation", pricing["input"] * 1.25))
            + (cache_read_tokens * pricing.get("cache_read", pricing["input"] * 0.1))
        ) / 1_000_000.0

        total_input = input_tokens + cache_creation_tokens + cache_read_tokens

        req_id_match = re.search(r'"id"\s*:\s*"([^"]+)"', resp_str)
        request_id = req_id_match.group(1) if req_id_match else f"proxy_{int(time.time()*1000)}_{input_tokens}_{output_tokens}"

        log_usage(
            provider=provider,
            model=model,
            input_tokens=total_input,
            output_tokens=output_tokens,
            cost=cost,
            source="API Proxy",
            request_id=request_id,
        )
    except Exception as e:
        logger.debug(f"Error analyzing proxy call: {e}")


# ── Analytics & Stats Helper ───────────────────────────────────────────────
def get_stats_data(time_range: str = "day") -> dict:
    conn = get_db()
    cursor = conn.cursor()

    # If ~/.smriti/usage.db has 0 rows, check if ~/.aimeter/usage.db has existing data and sync
    try:
        cursor.execute("SELECT COUNT(*) as cnt FROM usage_logs")
        if cursor.fetchone()["cnt"] == 0 and (LEGACY_AIMETER_DIR / "usage.db").exists():
            legacy_conn = sqlite3.connect(str(LEGACY_AIMETER_DIR / "usage.db"))
            legacy_conn.row_factory = sqlite3.Row
            lcur = legacy_conn.cursor()
            lcur.execute("SELECT * FROM usage_logs")
            for row in lcur.fetchall():
                keys = row.keys()
                req_id = row["request_id"] if "request_id" in keys else f"legacy_{row['id']}"
                cursor.execute("""
                INSERT OR IGNORE INTO usage_logs (timestamp, provider, model, input_tokens, output_tokens, cost, source, request_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (row["timestamp"], row["provider"], row["model"], row["input_tokens"], row["output_tokens"], row["cost"], row["source"], req_id))
            conn.commit()
            legacy_conn.close()
    except Exception as e:
        logger.debug(f"On-the-fly legacy sync error: {e}")

    now = datetime.now()
    if time_range == "month":
        start_time = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    elif time_range == "year":
        start_time = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    else:
        start_time = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    cursor.execute(
        "SELECT SUM(cost) as total, SUM(input_tokens) as input, SUM(output_tokens) as output, COUNT(*) as count FROM usage_logs WHERE timestamp >= ?",
        (start_time,),
    )
    summary = cursor.fetchone()
    today_cost = summary["total"] if summary and summary["total"] is not None else 0.0
    today_input = summary["input"] if summary and summary["input"] is not None else 0
    today_output = summary["output"] if summary and summary["output"] is not None else 0
    today_requests = summary["count"] if summary and summary["count"] is not None else 0

    cursor.execute(
        """
        SELECT provider, SUM(cost) as cost, SUM(input_tokens) as input, SUM(output_tokens) as output, COUNT(*) as count
        FROM usage_logs WHERE timestamp >= ? GROUP BY provider
        """,
        (start_time,),
    )
    providers = {
        r["provider"]: {"cost": r["cost"] or 0.0, "input": r["input"] or 0, "output": r["output"] or 0, "count": r["count"] or 0}
        for r in cursor.fetchall()
    }

    for prov in ["Anthropic", "OpenAI", "Google Gemini", "Claude Code", "OpenRouter"]:
        if prov not in providers:
            providers[prov] = {"cost": 0.0, "input": 0, "output": 0, "count": 0}

    cursor.execute(
        """
        SELECT model, provider, SUM(cost) as cost, SUM(input_tokens) as input, SUM(output_tokens) as output, COUNT(*) as count
        FROM usage_logs WHERE timestamp >= ? GROUP BY model ORDER BY cost DESC
        """,
        (start_time,),
    )
    models = [dict(r) for r in cursor.fetchall()]

    cursor.execute("SELECT * FROM usage_logs ORDER BY timestamp DESC LIMIT 50")
    recent = [dict(r) for r in cursor.fetchall()]

    trend = []
    if time_range == "month":
        for i in range(29, -1, -1):
            day = now - timedelta(days=i)
            day_start = day.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
            day_end = day.replace(hour=23, minute=59, second=59, microsecond=999999).isoformat()
            cursor.execute("SELECT SUM(cost) as total FROM usage_logs WHERE timestamp >= ? AND timestamp <= ?", (day_start, day_end))
            row = cursor.fetchone()
            cost_val = row["total"] if row and row["total"] is not None else 0.0
            trend.append({"day": day.strftime("%d"), "cost": cost_val})
    else:
        for i in range(6, -1, -1):
            day = now - timedelta(days=i)
            day_start = day.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
            day_end = day.replace(hour=23, minute=59, second=59, microsecond=999999).isoformat()
            cursor.execute("SELECT SUM(cost) as total FROM usage_logs WHERE timestamp >= ? AND timestamp <= ?", (day_start, day_end))
            row = cursor.fetchone()
            cost_val = row["total"] if row and row["total"] is not None else 0.0
            trend.append({"day": day.strftime("%a"), "cost": cost_val})

    cursor.execute("SELECT key, value FROM config")
    config = {r["key"]: r["value"] for r in cursor.fetchall()}
    daily_budget = float(config.get("daily_budget", 5.00))

    conn.close()

    return {
        "today": {
            "cost": round(today_cost, 4),
            "input_tokens": today_input,
            "output_tokens": today_output,
            "total_tokens": today_input + today_output,
            "requests": today_requests,
        },
        "daily_budget": daily_budget,
        "budget_percentage": min(100.0, round((today_cost / daily_budget) * 100.0, 1)) if daily_budget > 0 else 0.0,
        "providers": providers,
        "models": models,
        "recent_logs": recent,
        "trend": trend,
        "config": config,
    }


# ── Standalone Proxy Server on Port 5333 ───────────────────────────────────
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class StandaloneAIMeterProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/stats":
            data = get_stats_data()
            self._json_response(200, data)
        elif path.startswith(("/openai", "/anthropic", "/gemini", "/openrouter")):
            status, headers, body, _ = handle_proxy_call("GET", path, dict(self.headers), b"")
            self._proxy_respond(status, headers, body)
        else:
            self._json_response(200, {"status": "ok", "service": "Smriti-AIMeter Proxy", "port": 5333})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""

        if path.startswith(("/openai", "/anthropic", "/gemini", "/openrouter")):
            status, headers, resp_body, _ = handle_proxy_call("POST", path, dict(self.headers), body)
            self._proxy_respond(status, headers, resp_body)
        elif path == "/api/budget":
            try:
                payload = json.loads(body.decode("utf-8"))
                new_budget = float(payload.get("budget", 5.0))
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("INSERT OR REPLACE INTO config (key, value) VALUES ('daily_budget', ?)", (str(new_budget),))
                conn.commit()
                conn.close()
                self._json_response(200, {"status": "ok", "daily_budget": new_budget})
            except Exception as e:
                self._json_response(400, {"error": str(e)})
        else:
            self._json_response(404, {"error": "Not Found"})

    def _json_response(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_respond(self, status: int, headers: dict, body: bytes):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        for h, v in headers.items():
            self.send_header(h, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def start_proxy_daemon_thread(port: int = 5333):
    """Starts the standalone proxy server on port 5333 in a daemon thread."""
    def _run():
        try:
            ThreadingHTTPServer.allow_reuse_address = True
            server = ThreadingHTTPServer(("127.0.0.1", port), StandaloneAIMeterProxyHandler)
            logger.info(f"AIMeter proxy listening on http://127.0.0.1:{port}")
            server.serve_forever()
        except Exception as e:
            logger.warning(f"Could not start AIMeter proxy on port {port} (port may be in use): {e}")

    threading.Thread(target=_run, daemon=True).start()
