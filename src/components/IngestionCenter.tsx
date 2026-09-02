import React, { useState, useEffect } from "react";
import { smritiApi, RawEpisode, SmritiStats } from "../api";

interface IngestionCenterProps {
  daemonOnline: boolean;
  logs: Array<{ time: string; text: string; type: string }>;
  pendingEpisodes: RawEpisode[];
  unconsolidatedCount: number;
  onIngestSuccess: () => Promise<void>;
  onConsolidateSuccess: () => Promise<void>;
  addLog: (text: string, type?: "info" | "consolidation") => void;
}

export function IngestionCenter({
  daemonOnline,
  logs,
  pendingEpisodes,
  unconsolidatedCount,
  onIngestSuccess,
  onConsolidateSuccess,
  addLog,
}: IngestionCenterProps) {
  // Ingest Form State (Scoped locally)
  const [newMemory, setNewMemory] = useState("");
  const [newContext, setNewContext] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [stats, setStats] = useState<SmritiStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [lastStatsFetch, setLastStatsFetch] = useState<string | null>(null);

  const [editingEpisode, setEditingEpisode] = useState<RawEpisode | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const fetchStats = async () => {
    setStatsLoading(true);
    addLog("Refreshing system stats and pending memory queue...", "info");
    try {
      const data = await smritiApi.getStats();
      setStats(data);
      setLastStatsFetch(new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      await onIngestSuccess();
      addLog("System stats and pending memory queue refreshed successfully.", "info");
    } catch (err: any) {
      addLog(`Failed to fetch stats: ${err.message}`, "info");
    } finally {
      setStatsLoading(false);
    }
  };

  // Auto-fetch stats on mount
  useEffect(() => {
    if (daemonOnline) fetchStats();
  }, [daemonOnline]);

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemory.trim()) return;

    setIsIngesting(true);
    addLog(`Ingesting memory (private=${isPrivate})...`, "info");
    try {
      const res = await smritiApi.encodeMemory(newMemory, newContext, isPrivate);
      if (res.status === "encoded") {
        addLog(`Ingestion successful. Memory ID: ${res.id}`, "info");
        setNewMemory("");
        setNewContext("");
        await onIngestSuccess();
      }
    } catch (err: any) {
      addLog(`Ingestion failed: ${err.message}`, "info");
    } finally {
      setIsIngesting(false);
    }
  };

  const handleConsolidate = async () => {
    setIsConsolidating(true);
    addLog("Consolidation triggered (System 2 background processes)...", "consolidation");
    try {
      const res = await smritiApi.consolidate();
      addLog(`Consolidation finished. Results: ${res.stats}`, "consolidation");
      await onConsolidateSuccess();
    } catch (err: any) {
      addLog(`Consolidation failed: ${err.message}`, "consolidation");
    } finally {
      setIsConsolidating(false);
    }
  };

  const handleDeleteEpisode = async (id: string) => {
    addLog(`Deleting pending episode: ${id.substring(0, 8)}...`, "info");
    try {
      await smritiApi.deleteEpisode(id);
      addLog("Episode deleted successfully.", "info");
      await onIngestSuccess();
    } catch (err: any) {
      addLog(`Failed to delete: ${err.message}`, "info");
    }
  };

  const handleSaveEdit = async () => {
    if (!editingEpisode) return;
    addLog(`Editing pending episode: ${editingEpisode.id.substring(0, 8)}...`, "info");
    try {
      await smritiApi.editEpisode(editingEpisode.id, editingContent);
      addLog("Episode content edited successfully.", "info");
      setEditingEpisode(null);
      await onIngestSuccess();
    } catch (err: any) {
      addLog(`Failed to edit: ${err.message}`, "info");
    }
  };

  return (
    <div className="pane logs-pane" style={{ background: "transparent", border: "none", padding: 0 }}>
      <div className="ingest-grid">
        {/* Left Column: Ingest Form */}
        <div className="ingest-col">
          <section className="log-input-box" style={{ height: "100%", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="log-input-header">
              <h3 style={{ fontSize: "14px", fontWeight: "700", borderBottom: "1px solid var(--border)", paddingBottom: "10px", width: "100%", textTransform: "uppercase", color: "var(--accent)", letterSpacing: "0.5px" }}>
                Ingest Raw Observation
              </h3>
            </div>
            <form onSubmit={handleIngest} style={{ display: "flex", flexDirection: "column", gap: "16px", flex: 1 }}>
              <div className="form-group" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <label style={{ fontSize: "12px", fontWeight: "600", color: "#cbd5e1" }}>Observation Content</label>
                <textarea
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  placeholder="Type what SMRITI should remember (e.g. key technical decisions, milestones, structural configurations)..."
                  className="ingest-textarea"
                  disabled={!daemonOnline}
                  required
                  style={{ flex: 1, marginTop: "6px" }}
                />
              </div>
              
              <div className="form-group">
                <label style={{ fontSize: "12px", fontWeight: "600", color: "#cbd5e1" }}>Category Context (Optional)</label>
                <input 
                  type="text" 
                  value={newContext} 
                  onChange={(e) => setNewContext(e.target.value)}
                  placeholder="Category topic or context namespace..."
                  disabled={!daemonOnline}
                  style={{ marginTop: "6px" }}
                />
              </div>
              
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" }}>
                <label className="switch-label">
                  <input 
                    type="checkbox" 
                    checked={isPrivate} 
                    onChange={(e) => setIsPrivate(e.target.checked)} 
                  />
                  <div className="switch-toggle"></div>
                  <span>Private Room</span>
                </label>
                
                <button 
                  type="submit" 
                  className="btn-primary" 
                  disabled={isIngesting || !daemonOnline}
                  style={{ padding: "10px 24px", flex: "none" }}
                >
                  {isIngesting ? "Ingesting..." : "Remember"}
                </button>
              </div>
            </form>
          </section>
        </div>

        {/* Right Column: Pending Queue & Operations logs */}
        <div className="ingest-col">
          {/* Stats Dashboard */}
          <section className="pending-queue" style={{ marginBottom: "12px", padding: "14px 16px" }}>
            <div className="queue-header" style={{ marginBottom: stats ? "12px" : "0" }}>
              <div>
                <h3 style={{ fontSize: "13px" }}>Engine Stats</h3>
                {lastStatsFetch && (
                  <span style={{ fontSize: "9px", color: "var(--text-muted)", display: "block", marginTop: "2px" }}>
                    Last refreshed: {lastStatsFetch}
                  </span>
                )}
              </div>
              <button
                className="btn-primary"
                onClick={fetchStats}
                disabled={statsLoading || !daemonOnline}
                style={{
                  padding: "5px 12px",
                  fontSize: "10px",
                  flex: "none",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px"
                }}
              >
                <span style={{ 
                  display: "inline-block", 
                  animation: statsLoading ? "spin 1s linear infinite" : "none",
                  fontSize: "11px"
                }}>↻</span>
                {statsLoading ? "Loading..." : "Refresh Stats"}
              </button>
            </div>

            {stats && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: "8px"
              }}>
                {[
                  { label: "Episodes", value: stats.episode_buffer?.total_episodes ?? 0, color: "#38bdf8" },
                  { label: "Unconsolidated", value: stats.episode_buffer?.unconsolidated ?? 0, color: (stats.episode_buffer?.unconsolidated ?? 0) > 0 ? "#f59e0b" : "#4ade80" },
                  { label: "Rooms", value: stats.palace?.room_count ?? 0, color: "#a78bfa" },
                  { label: "Memories", value: stats.palace?.memory_count ?? 0, color: "#06b6d4" },
                  { label: "Vectors", value: stats.vector_store?.total_vectors ?? 0, color: "#f472b6" },
                ].map((item) => (
                  <div key={item.label} style={{
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: "8px",
                    padding: "10px 8px",
                    textAlign: "center",
                    border: "1px solid rgba(255,255,255,0.05)"
                  }}>
                    <div style={{ fontSize: "18px", fontWeight: "700", color: item.color, fontVariantNumeric: "tabular-nums" }}>
                      {item.value}
                    </div>
                    <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Pending Consolidation Queue Panel */}
          <section className="pending-queue">
            <div className="queue-header">
              <div>
                <h3>Pending Queue ({pendingEpisodes.length})</h3>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px", display: "block" }}>
                  {unconsolidatedCount > 0
                    ? `${unconsolidatedCount} unconsolidated episode${unconsolidatedCount !== 1 ? "s" : ""} across all sources`
                    : "System 1 raw episodes awaiting System 2 reflection"}
                </span>
              </div>
              <button 
                className="btn-primary"
                onClick={handleConsolidate}
                disabled={isConsolidating || !daemonOnline || unconsolidatedCount === 0}
                style={{ 
                  padding: "6px 14px", 
                  fontSize: "11px", 
                  flex: "none",
                  background: unconsolidatedCount > 0 ? "var(--accent-gradient)" : "rgba(255, 255, 255, 0.03)",
                  border: unconsolidatedCount > 0 ? "none" : "1px solid var(--border)",
                  color: unconsolidatedCount > 0 ? "#fff" : "var(--text-muted)"
                }}
              >
                {isConsolidating ? "Consolidating..." : `Consolidate${unconsolidatedCount > 0 ? ` (${unconsolidatedCount})` : ""}`}
              </button>
            </div>
            
            {isConsolidating && (
              <div className="consolidation-wave-container" title="System 2 is consolidating memories...">
                <span style={{ fontSize: "11px", color: "var(--accent)", marginRight: "8px" }}>System 2 Reflecting</span>
                <div className="consolidation-bar" style={{ animationDelay: "0.1s" }}></div>
                <div className="consolidation-bar" style={{ animationDelay: "0.3s" }}></div>
                <div className="consolidation-bar" style={{ animationDelay: "0.5s" }}></div>
                <div className="consolidation-bar" style={{ animationDelay: "0.2s" }}></div>
                <div className="consolidation-bar" style={{ animationDelay: "0.4s" }}></div>
              </div>
            )}

            <div className="queue-list">
              {pendingEpisodes.length === 0 ? (
                <div className="empty-state" style={{ padding: "30px 10px", textAlign: "center" }}>
                  🧪 Pending queue is empty.<br />All observations have been consolidated.
                </div>
              ) : (
                pendingEpisodes.map((ep) => {
                  let epDate = "—";
                  try {
                    if (ep.timestamp) {
                      const dateStr = ep.timestamp.replace(" ", "T");
                      const parsedDate = new Date(dateStr);
                      if (!isNaN(parsedDate.getTime())) {
                        epDate = parsedDate.toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit"
                        });
                      }
                    }
                  } catch (err) {
                    console.error("Date parsing error:", err);
                  }
                  return (
                    <div 
                      key={ep.id} 
                      className="queue-item"
                      style={{ 
                        display: "flex", 
                        justifyContent: "space-between", 
                        alignItems: "center", 
                        gap: "12px",
                        padding: "8px 12px"
                      }}
                    >
                      <span 
                        style={{ 
                          textOverflow: "ellipsis", 
                          overflow: "hidden", 
                          whiteSpace: "nowrap", 
                          flex: 1,
                          fontSize: "12px",
                          color: "#cbd5e1"
                        }}
                        title={ep.content}
                      >
                        {ep.content}
                      </span>
                      
                      <div className="queue-actions">
                        <button 
                          className="btn-icon" 
                          onClick={() => {
                            setEditingEpisode(ep);
                            setEditingContent(ep.content);
                          }}
                          title="Edit observation"
                        >
                          ✏️
                        </button>
                        <button 
                          className="btn-icon delete" 
                          onClick={() => handleDeleteEpisode(ep.id)}
                          title="Delete observation"
                        >
                          🗑️
                        </button>
                      </div>

                      <div 
                        style={{ 
                          display: "flex", 
                          gap: "6px", 
                          fontSize: "9px", 
                          color: "var(--text-muted)", 
                          flexShrink: 0,
                          alignItems: "center"
                        }}
                      >
                        <span style={{ background: "rgba(255, 255, 255, 0.04)", padding: "2px 4px", borderRadius: "3px" }}>
                          {ep.id.substring(0, 6)}
                        </span>
                        <span>{epDate}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Logs Stream Panel */}
          <section className="logs-display" style={{ display: "flex", flexDirection: "column" }}>
            <div 
              className="sidebar-header" 
              onClick={() => setLogsExpanded(!logsExpanded)}
              style={{ 
                cursor: "pointer", 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center",
                userSelect: "none"
              }}
            >
              <span>System Operations Log ({logs.length})</span>
              <span style={{ 
                fontSize: "12px", 
                color: "var(--accent)", 
                transition: "transform 0.2s", 
                transform: logsExpanded ? "rotate(90deg)" : "rotate(0deg)",
                marginRight: "4px"
              }}>
                ▶
              </span>
            </div>
            
            {logsExpanded && (
              <div className="logs-stream" style={{ marginTop: "12px" }}>
                {logs.length === 0 ? (
                  <div className="empty-state">No operations registered. Ingest a memory to start logs.</div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className={`log-entry ${log.type}`}>
                      <span className="log-timestamp">[{log.time}]</span>
                      <span className="log-text">{log.text}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        </div>
      </div>
      
      {/* Edit Episode Modal Overlay */}
      {editingEpisode && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ fontSize: "14px", fontWeight: "700", borderBottom: "1px solid var(--border)", paddingBottom: "10px", marginBottom: "16px", textTransform: "uppercase", color: "var(--accent)", letterSpacing: "0.5px" }}>
              Edit Raw Observation
            </h3>
            <textarea
              value={editingContent}
              onChange={(e) => setEditingContent(e.target.value)}
              className="ingest-textarea"
              style={{ width: "100%", height: "120px", background: "rgba(0,0,0,0.3)", color: "white", padding: "10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", resize: "none" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button className="btn-secondary" style={{ flex: "none", padding: "8px 16px" }} onClick={() => setEditingEpisode(null)}>
                Cancel
              </button>
              <button className="btn-primary" style={{ flex: "none", padding: "8px 16px" }} onClick={handleSaveEdit}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
