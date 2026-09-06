import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { smritiApi, AIMeterStats } from "../api";
import "./TrayPopoverView.css";

interface TrayPopoverViewProps {
  daemonOnline?: boolean;
}

const getInitialBudget = (): number => {
  try {
    const saved = localStorage.getItem("aimeter_daily_budget");
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch (e) {
    // ignore
  }
  return 5.0;
};

export const TrayPopoverView: React.FC<TrayPopoverViewProps> = () => {
  const [stats, setStats] = useState<AIMeterStats | null>(null);
  const [timeRange, setTimeRange] = useState<"day" | "month">("day");
  const [localBudget, setLocalBudget] = useState<number>(getInitialBudget);
  const [memoryCount, setMemoryCount] = useState<number>(() => {
    const cached = localStorage.getItem("smriti_totalMemories");
    return cached ? parseInt(cached, 10) : 0;
  });
  const [roomCount, setRoomCount] = useState<number>(() => {
    const cached = localStorage.getItem("smriti_totalRooms");
    return cached ? parseInt(cached, 10) : 0;
  });
  const [showBudgetInput, setShowBudgetInput] = useState(false);
  const [budgetVal, setBudgetVal] = useState<string>(() => String(getInitialBudget()));
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showProxyInfo, setShowProxyInfo] = useState(false);

  const fetchStats = async () => {
    try {
      const [aiData, palaceData] = await Promise.allSettled([
        smritiApi.getAIMeterStats(timeRange),
        smritiApi.getGraph(),
      ]);

      let cost = 0;
      if (aiData.status === "fulfilled") {
        const data = aiData.value;
        setStats(data);
        cost = data.today?.cost ?? 0;
        if (data.daily_budget) {
          setLocalBudget(data.daily_budget);
          try {
            localStorage.setItem("aimeter_daily_budget", String(data.daily_budget));
          } catch (e) {}
        }
      }

      let mems = memoryCount;
      if (palaceData.status === "fulfilled") {
        const graph = palaceData.value;
        if (graph && graph.stats) {
          mems = graph.stats.total_memories;
          setMemoryCount(mems);
          setRoomCount(graph.stats.total_rooms);
          try {
            localStorage.setItem("smriti_totalMemories", String(mems));
            localStorage.setItem("smriti_totalRooms", String(graph.stats.total_rooms));
          } catch (e) {}
        }
      }

      // Update macOS top menu bar navbar title directly
      const title = `$${cost.toFixed(2)} • ${mems} mem`;
      try {
        await invoke("update_tray_title", { title });
      } catch (e) {}
    } catch (err) {
      console.error("Failed to load stats in tray popover:", err);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, [timeRange]);

  const handleOpenPalace = async () => {
    try {
      await invoke("open_main_window");
      await invoke("hide_tray_window");
    } catch (e) {
      console.error("Failed to open main window:", e);
    }
  };

  const handleClosePopover = async () => {
    try {
      await invoke("hide_tray_window");
    } catch (e) {
      console.error("Failed to hide tray window:", e);
    }
  };

  const handleQuitApp = async () => {
    try {
      await invoke("exit_app");
    } catch (e) {
      console.error("Failed to exit app:", e);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(budgetVal);
    if (!isNaN(num) && num > 0) {
      setLocalBudget(num);
      try {
        localStorage.setItem("aimeter_daily_budget", String(num));
      } catch (e) {
        // ignore
      }
      setStats((prev) => {
        const cost = prev?.today?.cost ?? 0;
        const newPct = Math.min(100, Math.round((cost / num) * 100));
        return prev
          ? { ...prev, daily_budget: num, budget_percentage: newPct }
          : prev;
      });
      setShowBudgetInput(false);
      try {
        const res = await smritiApi.setDailyBudget(num);
        if (res && res.daily_budget) {
          setLocalBudget(res.daily_budget);
        }
        await fetchStats();
      } catch (err) {
        console.error("Failed to save budget:", err);
      }
    }
  };

  const formatTokens = (num: number) => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
    return String(num);
  };

  const todayCost = stats?.today?.cost ?? 0;
  const budget = stats?.daily_budget ?? localBudget;
  const percentage = Math.min(100, Math.round((todayCost / (budget || 1)) * 100));

  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  let gaugeColor = "#10b981";
  if (percentage >= 90) gaugeColor = "#ef4444";
  else if (percentage >= 70) gaugeColor = "#c5a059";

  return (
    <div className="tray-popover-container">
      {/* Top Header Bar */}
      <header className="tray-header">
        <div className="tray-brand">
          <img src="/logo.png" alt="SMRITI" className="tray-logo" />
          <div className="tray-title-group">
            <span className="tray-app-name">SMRITI</span>
            <span className="tray-badge">AIMeter :5333</span>
          </div>
        </div>

        <div className="tray-header-actions">
          <button
            type="button"
            className="tray-btn-open-palace"
            onClick={handleOpenPalace}
            title="Open Full Memory Palace Window"
          >
            <span>🏛️</span> Open Palace
          </button>
          <button
            type="button"
            className="tray-btn-close"
            onClick={handleClosePopover}
            title="Close Popover"
          >
            ✕
          </button>
        </div>
      </header>

      {/* Spend & Gauge Card */}
      <div className="tray-spend-card">
        <div className="tray-spend-header">
          <span className="tray-period-label">
            {timeRange === "month" ? "THIS MONTH'S SPEND" : "TODAY'S SPEND"}
          </span>
          <div className="tray-range-toggle">
            <button
              type="button"
              className={timeRange === "day" ? "active" : ""}
              onClick={() => setTimeRange("day")}
            >
              Today
            </button>
            <button
              type="button"
              className={timeRange === "month" ? "active" : ""}
              onClick={() => setTimeRange("month")}
            >
              Month
            </button>
          </div>
        </div>

        <div className="tray-gauge-row">
          <div className="tray-gauge-svg-wrap">
            <svg width="84" height="84" viewBox="0 0 84 84">
              <circle cx="42" cy="42" r={radius} className="tray-gauge-bg" />
              <circle
                cx="42"
                cy="42"
                r={radius}
                className="tray-gauge-val"
                style={{
                  stroke: gaugeColor,
                  strokeDasharray: circumference,
                  strokeDashoffset: strokeDashoffset,
                }}
              />
            </svg>
            <div className="tray-gauge-center">
              <span className="tray-gauge-pct">{percentage}%</span>
              <span className="tray-gauge-sub">{timeRange === "month" ? "month" : "daily"}</span>
            </div>
          </div>

          <div className="tray-spend-meta">
            <div className="tray-cost-large">${todayCost.toFixed(4)}</div>
            <div className="tray-budget-sub">
              {!showBudgetInput ? (
                <span>
                  Budget: <strong>${budget.toFixed(2)}</strong> / day{" "}
                  <button
                    type="button"
                    className="tray-link-btn"
                    onClick={() => {
                      setBudgetVal(String(budget));
                      setShowBudgetInput(true);
                    }}
                  >
                    ✎
                  </button>
                </span>
              ) : (
                <form onSubmit={handleSaveBudget} className="tray-inline-budget-form">
                  <span>$</span>
                  <input
                    type="number"
                    step="0.50"
                    min="0.50"
                    value={budgetVal}
                    onChange={(e) => setBudgetVal(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="tray-btn-save">✓</button>
                  <button
                    type="button"
                    className="tray-btn-cancel"
                    onClick={() => setShowBudgetInput(false)}
                  >
                    ✕
                  </button>
                </form>
              )}
            </div>
            <div className="tray-status-chip" style={{ color: gaugeColor }}>
              {percentage < 70 && "● On Target"}
              {percentage >= 70 && percentage < 90 && "▲ Approaching Cap"}
              {percentage >= 90 && "⚠️ High Usage Alert"}
            </div>
          </div>
        </div>
      </div>

      {/* Memory Palace Quick Status Card */}
      <div className="tray-palace-card" onClick={handleOpenPalace}>
        <div className="tray-palace-icon">🏛️</div>
        <div className="tray-palace-info">
          <div className="tray-palace-title">Memory Palace</div>
          <div className="tray-palace-meta">
            <strong>{memoryCount}</strong> memories in <strong>{roomCount}</strong> rooms
          </div>
        </div>
        <button type="button" className="tray-palace-action-btn">
          Explore Palace →
        </button>
      </div>

      {/* KPI Counters */}
      <div className="tray-kpi-row">
        <div className="tray-kpi-box">
          <div className="tray-kpi-label">TOTAL TOKENS</div>
          <div className="tray-kpi-value">
            {formatTokens(stats?.today?.total_tokens ?? 0)}
          </div>
          <div className="tray-kpi-detail">
            In: {formatTokens(stats?.today?.input_tokens ?? 0)} • Out:{" "}
            {formatTokens(stats?.today?.output_tokens ?? 0)}
          </div>
        </div>

        <div className="tray-kpi-box">
          <div className="tray-kpi-label">REQUESTS</div>
          <div className="tray-kpi-value">{stats?.today?.requests ?? 0}</div>
          <div className="tray-kpi-detail">
            {stats && Object.values(stats.providers).some((p) => p.count > 0)
              ? Object.entries(stats.providers)
                  .filter(([_, p]) => p.count > 0)
                  .map(([name, p]) => `${name}: ${p.count}`)
                  .join(" • ")
              : "Listening on :5333"}
          </div>
        </div>
      </div>

      {/* Top Models Mini List */}
      {stats && stats.models && stats.models.length > 0 && (
        <div className="tray-models-section">
          <div className="tray-section-title">TOP MODELS</div>
          <div className="tray-models-list">
            {stats.models.slice(0, 3).map((m) => (
              <div key={m.model} className="tray-model-item">
                <span className="tray-model-name" title={m.model}>
                  {m.model.replace("claude-", "c-").replace("-2024", "")}
                </span>
                <span className="tray-model-tokens">
                  {formatTokens(m.input_tokens + m.output_tokens)} tok
                </span>
                <span className="tray-model-cost">${m.cost.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Proxy Config Dropdown */}
      <div className="tray-proxy-bar">
        <button
          type="button"
          className="tray-proxy-toggle"
          onClick={() => setShowProxyInfo(!showProxyInfo)}
        >
          <span>🔌 Local AI Proxy Config</span>
          <span>{showProxyInfo ? "▲" : "▼"}</span>
        </button>

        {showProxyInfo && (
          <div className="tray-proxy-dropdown">
            <div className="tray-snippet-row">
              <span>Claude Code:</span>
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    'export ANTHROPIC_BASE_URL="http://127.0.0.1:5333/anthropic"',
                    "claude"
                  )
                }
              >
                {copiedKey === "claude" ? "✓ Copied" : "Copy Env"}
              </button>
            </div>
            <code>export ANTHROPIC_BASE_URL="http://127.0.0.1:5333/anthropic"</code>

            <div className="tray-snippet-row" style={{ marginTop: "6px" }}>
              <span>OpenAI / Cursor:</span>
              <button
                type="button"
                onClick={() =>
                  handleCopy("http://127.0.0.1:5333/openai/v1", "openai")
                }
              >
                {copiedKey === "openai" ? "✓ Copied" : "Copy URL"}
              </button>
            </div>
            <code>http://127.0.0.1:5333/openai/v1</code>
          </div>
        )}
      </div>

      {/* Bottom Footer Actions */}
      <footer className="tray-footer">
        <button
          type="button"
          className="tray-footer-action primary"
          onClick={handleOpenPalace}
        >
          <span>🏛️</span> Open Full App
        </button>
        <button
          type="button"
          className="tray-footer-action quit"
          onClick={handleQuitApp}
          title="Quit Smriti Daemon & Application"
        >
          <span>🚪</span> Quit
        </button>
      </footer>
    </div>
  );
};
