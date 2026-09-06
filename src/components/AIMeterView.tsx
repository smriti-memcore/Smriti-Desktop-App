import React, { useState, useEffect } from "react";
import { smritiApi, AIMeterStats } from "../api";

interface AIMeterViewProps {
  daemonOnline?: boolean;
}

export const AIMeterView: React.FC<AIMeterViewProps> = ({ daemonOnline: _daemonOnline }) => {
  const [stats, setStats] = useState<AIMeterStats | null>(null);
  const [timeRange, setTimeRange] = useState<"day" | "month">("day");
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [newBudget, setNewBudget] = useState("5.00");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  const fetchStats = async () => {
    try {
      const data = await smritiApi.getAIMeterStats(timeRange);
      setStats(data);
      if (data.daily_budget) {
        setNewBudget(String(data.daily_budget));
      }
    } catch (err) {
      console.error("Failed to load AIMeter statistics:", err);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [timeRange]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleOpenBudgetModal = () => {
    if (stats?.daily_budget) {
      setNewBudget(String(stats.daily_budget));
    }
    setShowBudgetModal(true);
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(newBudget);
    if (!isNaN(num) && num > 0) {
      // Optimistically update React state immediately so user sees the change right away
      setStats((prev) => {
        const cost = prev?.today?.cost ?? 0;
        const newPct = Math.min(100, Math.round((cost / num) * 100));
        if (prev) {
          return {
            ...prev,
            daily_budget: num,
            budget_percentage: newPct,
          };
        }
        return {
          today: { cost: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, requests: 0 },
          daily_budget: num,
          budget_percentage: newPct,
          providers: {},
          models: [],
          recent_logs: [],
          trend: [],
          config: {},
        };
      });
      setShowBudgetModal(false);

      try {
        const res = await smritiApi.setDailyBudget(num);
        if (res && res.daily_budget) {
          setStats((prev) => (prev ? { ...prev, daily_budget: res.daily_budget } : prev));
        }
        await fetchStats();
      } catch (err) {
        console.error("Failed to save budget to daemon:", err);
      }
    }
  };

  const handleResetToday = async () => {
    if (confirm("Are you sure you want to clear today's intercepted usage logs?")) {
      setStats((prev) =>
        prev
          ? {
              ...prev,
              today: {
                cost: 0,
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
                requests: 0,
              },
              budget_percentage: 0,
            }
          : prev
      );
      try {
        await smritiApi.resetAIMeterTodayLogs();
        await fetchStats();
      } catch (err) {
        console.error("Failed to reset today logs:", err);
      }
    }
  };

  const formatTokens = (num: number) => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
    return String(num);
  };

  const todayCost = stats?.today?.cost ?? 0;
  const budget = stats?.daily_budget ?? 5.0;
  const percentage = Math.min(100, Math.round((todayCost / (budget || 1)) * 100));

  // Gauge stroke dash values
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  let gaugeColor = "#10b981"; // green
  if (percentage >= 90) gaugeColor = "#ef4444"; // red
  else if (percentage >= 70) gaugeColor = "#c5a059"; // bronze/amber

  // Max value for 7-day trend chart scaling
  const maxTrendCost = Math.max(...(stats?.trend.map((t) => t.cost) || [0.1]), 0.1);

  return (
    <div className="aimeter-container">
      {/* Top Action Bar */}
      <div className="aimeter-action-bar">
        <div className="aimeter-title-area">
          <h3>
            <span>📊</span> AIMeter — AI Usage & Cost Tracker
          </h3>
          <span className="aimeter-subtitle">
            Zero-latency local proxy & Claude Code watcher monitoring active token expenses
          </span>
        </div>

        <div className="aimeter-controls">
          <div className="time-range-toggle">
            <button
              type="button"
              className={`range-btn ${timeRange === "day" ? "active" : ""}`}
              onClick={() => setTimeRange("day")}
            >
              Today
            </button>
            <button
              type="button"
              className={`range-btn ${timeRange === "month" ? "active" : ""}`}
              onClick={() => setTimeRange("month")}
            >
              This Month
            </button>
          </div>

          <button type="button" className="aimeter-btn proxy-btn" onClick={() => setShowSetupGuide(!showSetupGuide)}>
            <span>⚙️</span> Setup Proxy
          </button>
          <button type="button" className="aimeter-btn budget-btn" onClick={handleOpenBudgetModal}>
            <span>🎯</span> Set Budget
          </button>
          <button type="button" className="aimeter-btn reset-btn" onClick={handleResetToday} title="Clear today's logs">
            <span>🗑️</span> Reset
          </button>
        </div>
      </div>

      {/* Quick Setup Drawer */}
      {showSetupGuide && (
        <div className="proxy-setup-drawer">
          <div className="setup-drawer-header">
            <h4>🔌 Route Local AI Traffic Through AIMeter Proxy (:5333)</h4>
            <button className="close-btn" onClick={() => setShowSetupGuide(false)}>
              ✕
            </button>
          </div>
          <p>
            Configure your development environment to point base URLs to AIMeter's zero-latency local proxy. All tokens
            and dollar costs will be intercepted and visualised automatically:
          </p>

          <div className="setup-grid">
            <div className="setup-card">
              <div className="setup-card-header">
                <strong>Global Shell (~/.zshrc or ~/.bashrc)</strong>
                <button
                  className="copy-snippet-btn"
                  onClick={() =>
                    handleCopy(
                      'export OPENAI_BASE_URL="http://127.0.0.1:5333/openai/v1"\nexport ANTHROPIC_BASE_URL="http://127.0.0.1:5333/anthropic"',
                      "shell"
                    )
                  }
                >
                  {copiedKey === "shell" ? "✓ Copied" : "Copy Snippet"}
                </button>
              </div>
              <pre>
                <code>
                  export OPENAI_BASE_URL="http://127.0.0.1:5333/openai/v1"
                  <br />
                  export ANTHROPIC_BASE_URL="http://127.0.0.1:5333/anthropic"
                </code>
              </pre>
            </div>

            <div className="setup-card">
              <div className="setup-card-header">
                <strong>Cursor / VS Code Settings</strong>
                <button
                  className="copy-snippet-btn"
                  onClick={() => handleCopy("http://127.0.0.1:5333/openai/v1", "cursor")}
                >
                  {copiedKey === "cursor" ? "✓ Copied" : "Copy Base URL"}
                </button>
              </div>
              <pre>
                <code>
                  OpenAI Base URL: http://127.0.0.1:5333/openai/v1
                  <br />
                  Anthropic Base URL: http://127.0.0.1:5333/anthropic
                </code>
              </pre>
            </div>

            <div className="setup-card">
              <div className="setup-card-header">
                <strong>Claude Code CLI</strong>
                <button
                  className="copy-snippet-btn"
                  onClick={() =>
                    handleCopy('export ANTHROPIC_BASE_URL="http://127.0.0.1:5333/anthropic"', "claude")
                  }
                >
                  {copiedKey === "claude" ? "✓ Copied" : "Copy Snippet"}
                </button>
              </div>
              <pre>
                <code>
                  export ANTHROPIC_BASE_URL="http://127.0.0.1:5333/anthropic"
                </code>
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Main KPI Metric Grid */}
      <div className="aimeter-kpi-grid">
        {/* Card 1: Daily Spend Gauge */}
        <div className="aimeter-card kpi-gauge-card">
          <div className="card-label">TODAY'S SPEND</div>
          <div className="gauge-wrapper">
            <div className="gauge-svg-box">
              <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r={radius} className="gauge-bg" />
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  className="gauge-val"
                  style={{
                    stroke: gaugeColor,
                    strokeDasharray: circumference,
                    strokeDashoffset: strokeDashoffset,
                  }}
                />
              </svg>
              <div className="gauge-center-text">
                <span className="gauge-percent">{percentage}%</span>
                <span className="gauge-sub">of budget</span>
              </div>
            </div>

            <div className="gauge-info">
              <div className="spend-amount">${todayCost.toFixed(4)}</div>
              <div className="spend-budget">
                Budget: <strong>${budget.toFixed(2)}</strong> / day
              </div>
              <div className="spend-status" style={{ color: gaugeColor }}>
                {percentage < 70 && "● On Target"}
                {percentage >= 70 && percentage < 90 && "▲ Approaching Cap"}
                {percentage >= 90 && "⚠️ High Usage Alert"}
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Total Tokens */}
        <div className="aimeter-card">
          <div className="card-label">TOTAL TOKENS PROCESSED</div>
          <div className="kpi-big-num">
            {formatTokens(stats?.today?.total_tokens ?? 0)}
          </div>
          <div className="token-breakdown">
            <div className="token-sub">
              <span>Input:</span> <strong>{formatTokens(stats?.today?.input_tokens ?? 0)}</strong>
            </div>
            <div className="token-sub">
              <span>Output:</span> <strong>{formatTokens(stats?.today?.output_tokens ?? 0)}</strong>
            </div>
          </div>
        </div>

        {/* Card 3: Total Requests */}
        <div className="aimeter-card">
          <div className="card-label">TOTAL API REQUESTS</div>
          <div className="kpi-big-num">{stats?.today?.requests ?? 0}</div>
          <div className="provider-chips">
            {stats &&
              Object.entries(stats.providers)
                .filter(([_, data]) => data.count > 0)
                .map(([name, data]) => (
                  <span key={name} className="provider-chip">
                    {name}: {data.count}
                  </span>
                ))}
            {(!stats || Object.values(stats.providers).every((p) => p.count === 0)) && (
              <span className="text-muted" style={{ fontSize: "11px" }}>
                Listening on background proxy...
              </span>
            )}
          </div>
        </div>

        {/* Card 4: Proxy Service Status */}
        <div className="aimeter-card kpi-gateway-card">
          <div className="card-label">INTERCEPTOR GATEWAYS</div>
          <div className="gateway-status-pill">
            <span className="pulsing-dot"></span>
            <span className="gateway-status-text">Active &amp; Intercepting</span>
          </div>
          <div className="gateway-details">
            <div className="gateway-detail-row">
              <span className="detail-name">Proxy Gateway</span>
              <span className="detail-tag port-tag">:5333</span>
            </div>
            <div className="gateway-detail-row">
              <span className="detail-name">Claude Code</span>
              <span className="detail-tag watcher-tag">⚡ Live</span>
            </div>
          </div>
        </div>
      </div>

      {/* Middle Row: 7-Day Trend Chart & Top Models */}
      <div className="aimeter-mid-grid">
        {/* 7-Day Trend Chart */}
        <div className="aimeter-card chart-card">
          <div className="card-header-clean">
            <h4>7-Day Spend Trajectory</h4>
            <span className="chart-meta">USD ($) per day</span>
          </div>
          <div className="trend-bar-chart">
            {stats?.trend.map((item, idx) => {
              const heightPct = Math.max(8, Math.round((item.cost / maxTrendCost) * 100));
              return (
                <div key={idx} className="trend-bar-col">
                  <div className="bar-hover-val">${item.cost.toFixed(3)}</div>
                  <div className="trend-bar-track">
                    <div className="trend-bar-fill" style={{ height: `${heightPct}%` }}></div>
                  </div>
                  <span className="bar-day-label">{item.day}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Model Breakdown */}
        <div className="aimeter-card models-card">
          <div className="card-header-clean">
            <h4>Top Models by Cost</h4>
            <span className="chart-meta">{stats?.models.length ?? 0} active models</span>
          </div>

          <div className="models-list">
            {stats && stats.models.length > 0 ? (
              stats.models.slice(0, 5).map((m, idx) => (
                <div key={idx} className="model-row">
                  <div className="model-name-group">
                    <span className="model-name">{m.model}</span>
                    <span className="model-provider-tag">{m.provider}</span>
                  </div>
                  <div className="model-cost-group">
                    <div className="model-cost">${m.cost.toFixed(4)}</div>
                    <div className="model-tokens">{formatTokens(m.input_tokens + m.output_tokens)} tok</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state-notice">
                No external API calls logged yet today. Route requests via <code>:5333</code> or use Claude Code CLI!
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: Live Request Log Table */}
      <div className="aimeter-card logs-table-card">
        <div className="card-header-clean">
          <h4>Live Intercepted API Logs</h4>
          <span className="chart-meta">
            {stats?.recent_logs.length ? `${stats.recent_logs.length} recent requests` : "Real-time stream"}
          </span>
        </div>

        {stats && stats.recent_logs.length > 0 ? (
          <div className="table-responsive">
            <table className="aimeter-logs-table">
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>PROVIDER</th>
                  <th>MODEL</th>
                  <th>SOURCE</th>
                  <th>INPUT TOK</th>
                  <th>OUTPUT TOK</th>
                  <th>COST (USD)</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent_logs.map((log) => {
                  const time = new Date(log.timestamp).toLocaleTimeString();
                  return (
                    <tr key={log.id}>
                      <td className="time-col">{time}</td>
                      <td>
                        <span className="table-badge provider">{log.provider}</span>
                      </td>
                      <td className="model-col">{log.model}</td>
                      <td>
                        <span className={`table-badge source ${log.source.toLowerCase().replace(/[\s_]+/g, "-")}`}>
                          {log.source}
                        </span>
                      </td>
                      <td>{formatTokens(log.input_tokens)}</td>
                      <td>{formatTokens(log.output_tokens)}</td>
                      <td className="cost-col">${log.cost.toFixed(5)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-logs-banner">
            <div className="empty-logs-icon">📡</div>
            <div className="empty-logs-content">
              <strong>No API requests intercepted yet today</strong>
              <p>
                Run any prompt with <strong>Claude Code</strong> in your terminal, or point your <strong>Cursor / VS Code / SDK</strong> base URL to <code>http://127.0.0.1:5333/openai/v1</code> to inspect token usage live.
              </p>
            </div>
            <button
              type="button"
              className="aimeter-btn proxy-btn"
              onClick={() => setShowSetupGuide(true)}
            >
              <span>🔌</span> Setup Proxy Guide
            </button>
          </div>
        )}
      </div>

      {/* Set Budget Modal */}
      {showBudgetModal && (
        <div className="aimeter-modal-backdrop" onClick={() => setShowBudgetModal(false)}>
          <div className="aimeter-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🎯 Daily API Budget Threshold</h3>
              <button className="close-btn" onClick={() => setShowBudgetModal(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveBudget}>
              <div className="form-group">
                <label>Daily Budget Limit ($ USD):</label>
                <input
                  type="number"
                  step="0.50"
                  min="0.50"
                  value={newBudget}
                  onChange={(e) => setNewBudget(e.target.value)}
                  required
                />
                <span className="input-hint">
                  The visual gauge will warn you when your daily spending approaches or exceeds this target.
                </span>
              </div>
              <div className="modal-actions">
                <button type="button" className="aimeter-btn secondary" onClick={() => setShowBudgetModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="aimeter-btn primary">
                  Save Budget
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
