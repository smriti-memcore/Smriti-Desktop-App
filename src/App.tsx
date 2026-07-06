import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { smritiApi, SmritiAppConfig, PalaceGraph, RawEpisode } from "./api";
import { GraphPane } from "./components/GraphPane";
import { IngestionCenter } from "./components/IngestionCenter";
import { SettingsPanel } from "./components/SettingsPanel";
import { QuickSearch } from "./components/QuickSearch";
import "./App.css";

function App() {
  const [windowLabel, setWindowLabel] = useState<string>("main");

  useEffect(() => {
    try {
      const win = getCurrentWindow();
      setWindowLabel(win.label);
    } catch (e) {
      console.error("Failed to get window label, defaulting to main", e);
    }
  }, []);

  const [activeTab, setActiveTab] = useState<"graph" | "logs" | "settings">("graph");
  const [palaceViewMode, setPalaceViewMode] = useState<"graph" | "table">("graph");
  const [daemonOnline, setDaemonOnline] = useState(false);
  const [totalMemories, setTotalMemories] = useState(0);
  const [totalRooms, setTotalRooms] = useState(0);
  
  // Shared Graph & Inspector State
  const [graphData, setGraphData] = useState<PalaceGraph | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Settings Form State
  const [config, setConfig] = useState<SmritiAppConfig>({
    storage_mode: "local",
    storage_path: "~/.smriti/global",
    llm_provider: "ollama",
    llm_model: "mistral",
    ollama_base_url: "http://localhost:11434",
    openai_api_key: "",
    anthropic_api_key: "",
    gemini_api_key: ""
  });

  // Logs & Stream State
  const [logs, setLogs] = useState<Array<{ time: string; text: string; type: string }>>([]);
  const [pendingEpisodes, setPendingEpisodes] = useState<RawEpisode[]>([]);

  // Listen for sidecar logs forwarded from Rust
  useEffect(() => {
    const listenPromise = listen<string>("smriti-log", (event) => {
      const text = event.payload;
      const isError = text.toLowerCase().includes("error") || text.toLowerCase().includes("traceback");
      const type = isError ? "error" : "sidecar";
      
      const lines = text.split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0);
      
      if (lines.length === 0) return;
      
      const timestamp = new Date().toLocaleTimeString();
      setLogs(prev => {
        const newEntries = lines.map(line => ({
          time: timestamp,
          text: line,
          type: type
        }));
        return [...newEntries, ...prev].slice(0, 200);
      });
    });

    return () => {
      listenPromise.then(unlisten => unlisten());
    };
  }, []);

  // Poll Daemon Health, Stats, Graph, and Pending Episodes
  useEffect(() => {
    const checkHealth = async () => {
      try {
        await smritiApi.getHealth();
        setDaemonOnline(true);
        
        const data = await smritiApi.getGraph();
        setGraphData(data);
        setTotalMemories(data.stats.total_memories);
        setTotalRooms(data.stats.total_rooms);
        
        const episodes = await smritiApi.getEpisodes();
        setPendingEpisodes(episodes);
      } catch (err) {
        setDaemonOnline(false);
      }
    };
    
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  // Load config on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await smritiApi.getConfig();
        setConfig(settings);
        addLog("Loaded configuration from backend.", "info");
      } catch (err) {
        addLog("Failed to load configuration from backend daemon.", "info");
      }
    };
    if (daemonOnline) {
      loadSettings();
    }
  }, [daemonOnline]);

  const addLog = (text: string, type: "info" | "consolidation" = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [{ time, text, type }, ...prev].slice(0, 100));
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      addLog(`Saving settings with provider: ${config.llm_provider}...`, "info");
      const res = await smritiApi.saveConfig(config);
      if (res.status === "saved") {
        addLog("Settings updated successfully. SMRITI engine reloaded.", "info");
        alert("Settings saved successfully!");
      }
    } catch (err: any) {
      addLog(`Error saving settings: ${err.message}`, "info");
      alert(`Error saving settings: ${err.message}`);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await smritiApi.getGraph();
      setGraphData(data);
      setTotalMemories(data.stats.total_memories);
      setTotalRooms(data.stats.total_rooms);
      setSelectedNode(null);
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleIngestSuccess = async () => {
    const data = await smritiApi.getGraph();
    setGraphData(data);
    setTotalMemories(data.stats.total_memories);
    setTotalRooms(data.stats.total_rooms);
    
    const episodes = await smritiApi.getEpisodes();
    setPendingEpisodes(episodes);
  };

  const handleConsolidateSuccess = async () => {
    const data = await smritiApi.getGraph();
    setGraphData(data);
    setTotalMemories(data.stats.total_memories);
    setTotalRooms(data.stats.total_rooms);
    setSelectedNode(null);
    
    const episodes = await smritiApi.getEpisodes();
    setPendingEpisodes(episodes);
  };

  if (windowLabel === "quick-search") {
    return <QuickSearch />;
  }

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="logo-section">
          <div className="logo-icon" style={{ background: "none", boxShadow: "none" }}>
            <img src="/logo.png" alt="SMRITI Logo" style={{ width: "38px", height: "38px" }} />
          </div>
          <div className="logo-text">
            <h1>SMRITI</h1>
            <span>v1.4.12 • LTM Engine</span>
          </div>
        </div>
        
        <nav className="nav-menu">
          <div 
            className={`nav-item ${activeTab === "graph" ? "active" : ""}`}
            onClick={() => setActiveTab("graph")}
          >
            <span className="nav-item-icon">🏛️</span>
            <span>Memory Palace</span>
          </div>
          <div 
            className={`nav-item ${activeTab === "logs" ? "active" : ""}`}
            onClick={() => setActiveTab("logs")}
          >
            <span className="nav-item-icon">📝</span>
            <span>Logs & Ingest</span>
          </div>
          <div 
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <span className="nav-item-icon">⚙️</span>
            <span>Settings</span>
          </div>
        </nav>
        
        <div className="status-footer">
          <div className={`status-dot ${daemonOnline ? "online" : "offline"}`}></div>
          <span>Daemon: {daemonOnline ? "CONNECTED" : "OFFLINE"}</span>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="main-content">
        <header className="top-header">
          <h2>
            {activeTab === "graph" && "Semantic Palace Explorer"}
            {activeTab === "logs" && "Memory Stream & Ingestion"}
            {activeTab === "settings" && "System Configuration"}
          </h2>
          <div className="engine-stats">
            <div className="stat-pill">
              <span className="stat-value">{totalRooms}</span>
              <span className="stat-label">Rooms</span>
            </div>
            <div className="stat-pill">
              <span className="stat-value">{totalMemories}</span>
              <span className="stat-label">Memories</span>
            </div>
          </div>
        </header>

        {activeTab === "graph" && (
          <GraphPane 
            daemonOnline={daemonOnline}
            viewMode={palaceViewMode}
            setViewMode={setPalaceViewMode}
            graphData={graphData}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
          />
        )}
        
        {activeTab === "logs" && (
          <IngestionCenter 
            daemonOnline={daemonOnline}
            logs={logs}
            pendingEpisodes={pendingEpisodes}
            onIngestSuccess={handleIngestSuccess}
            onConsolidateSuccess={handleConsolidateSuccess}
            addLog={addLog}
          />
        )}

        {activeTab === "settings" && (
          <SettingsPanel 
            config={config}
            setConfig={setConfig}
            handleSaveSettings={handleSaveSettings}
            daemonOnline={daemonOnline}
          />
        )}
      </main>
    </div>
  );
}

export default App;
