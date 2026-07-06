import React from "react";
import { SmritiAppConfig } from "../api";

interface SettingsPanelProps {
  config: SmritiAppConfig;
  setConfig: React.Dispatch<React.SetStateAction<SmritiAppConfig>>;
  handleSaveSettings: (e: React.FormEvent) => Promise<void>;
  daemonOnline: boolean;
}

export function SettingsPanel({
  config,
  setConfig,
  handleSaveSettings,
  daemonOnline,
}: SettingsPanelProps) {
  return (
    <div className="pane" style={{ padding: "0 20px" }}>
      <form className="settings-pane" onSubmit={handleSaveSettings}>
        <div className="settings-body">
          {/* Storage Configuration */}
          <section className="settings-section">
            <h3>📂 Storage Configuration</h3>
            
            <div className="form-group">
              <label>Storage Mode</label>
              <select 
                value={config.storage_mode}
                onChange={(e) => setConfig({ ...config, storage_mode: e.target.value as any })}
              >
                <option value="local">Local-Only (Save on laptop)</option>
                <option value="cloud">Cloud Sync (Secure cloud palacing)</option>
              </select>
              <span className="form-hint">
                Choose whether to keep memory indexes completely offline on this computer or synchronize with a secure remote server.
              </span>
            </div>
            
            {config.storage_mode === "cloud" && (
              <>
                <div className="form-group">
                  <label>Cloud Sync Endpoint</label>
                  <input 
                    type="text" 
                    placeholder="https://api.smriti-memcore.com/v1" 
                    value={config.cloud_endpoint || ""}
                    onChange={(e) => setConfig({ ...config, cloud_endpoint: e.target.value })}
                  />
                  <span className="form-hint">Secure API endpoint URL for cloud sync synchronization.</span>
                </div>
                <div className="form-group">
                  <label>Cloud Access Token</label>
                  <input 
                    type="password" 
                    placeholder="smriti_tok_..." 
                    value={config.cloud_token || ""}
                    onChange={(e) => setConfig({ ...config, cloud_token: e.target.value })}
                  />
                  <span className="form-hint">Authentication token used to sync memory logs securely.</span>
                </div>
              </>
            )}
            
            <div className="form-group">
              <label>Local Base Storage Path</label>
              <input 
                type="text" 
                value={config.storage_path}
                onChange={(e) => setConfig({ ...config, storage_path: e.target.value })}
              />
              <span className="form-hint">
                Local directory path on your machine where episodes, vectors, and category databases are persisted.
              </span>
            </div>
          </section>

          {/* Reasoning Model Configuration */}
          <section className="settings-section">
            <h3>🧠 Reasoning Model (System 2)</h3>
            
            <div className="form-group">
              <label>LLM Provider</label>
              <select 
                value={config.llm_provider}
                onChange={(e) => setConfig({ ...config, llm_provider: e.target.value as any })}
              >
                <option value="ollama">Ollama (Local / Offline)</option>
                <option value="openai">OpenAI API (Cloud)</option>
                <option value="anthropic">Anthropic Claude API (Cloud)</option>
                <option value="gemini">Google Gemini API (Cloud)</option>
              </select>
              <span className="form-hint">
                Language model engine utilized by SMRITI System 2 to consolidate raw events, structure thematic rooms, and reflect on insights.
              </span>
            </div>
            
            {config.llm_provider === "ollama" && (
              <>
                <div className="form-group">
                  <label>Ollama Base URL</label>
                  <input 
                    type="text" 
                    value={config.ollama_base_url || ""}
                    onChange={(e) => setConfig({ ...config, ollama_base_url: e.target.value })}
                  />
                  <span className="form-hint">Connection endpoint for your locally running Ollama instance (default port 11434).</span>
                </div>
                <div className="form-group">
                  <label>Ollama Model Name</label>
                  <input 
                    type="text" 
                    value={config.llm_model}
                    onChange={(e) => setConfig({ ...config, llm_model: e.target.value })}
                    placeholder="e.g. mistral"
                  />
                  <span className="form-hint">Name of the downloaded Ollama LLM to run (e.g. mistral, llama3, deepseek).</span>
                </div>
              </>
            )}
            
            {config.llm_provider !== "ollama" && (
              <>
                <div className="form-group">
                  <label>
                    {config.llm_provider === "openai" && "OpenAI API Key"}
                    {config.llm_provider === "anthropic" && "Anthropic API Key"}
                    {config.llm_provider === "gemini" && "Gemini API Key"}
                  </label>
                  <input 
                    type="password" 
                    placeholder="sk-..." 
                    value={
                      config.llm_provider === "openai" ? config.openai_api_key || "" :
                      config.llm_provider === "anthropic" ? config.anthropic_api_key || "" :
                      config.gemini_api_key || ""
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (config.llm_provider === "openai") setConfig({ ...config, openai_api_key: val });
                      else if (config.llm_provider === "anthropic") setConfig({ ...config, anthropic_api_key: val });
                      else setConfig({ ...config, gemini_api_key: val });
                    }}
                  />
                  <span className="form-hint">Your private API authorization key. It remains encrypted and stored on your local disk.</span>
                </div>
                <div className="form-group">
                  <label>Model Identifier</label>
                  <input 
                    type="text" 
                    value={config.llm_model}
                    onChange={(e) => setConfig({ ...config, llm_model: e.target.value })}
                    placeholder={
                      config.llm_provider === "openai" ? "gpt-4o" :
                      config.llm_provider === "anthropic" ? "claude-3-5-sonnet-latest" :
                      "gemini-1.5-flash"
                    }
                  />
                  <span className="form-hint">Target model version to call (e.g. gpt-4o, claude-3-5-sonnet-latest).</span>
                </div>
              </>
            )}
          </section>
        </div>
        <div className="settings-footer">
          {!daemonOnline && (
            <span style={{ fontSize: "11px", color: "var(--red)", marginRight: "auto", display: "flex", alignItems: "center", gap: "4px" }}>
              ⚠️ SMRITI Sidecar Daemon Offline — Settings cannot be saved.
            </span>
          )}
          <button type="submit" className="btn-primary" disabled={!daemonOnline} style={{ padding: "10px 24px" }}>
            Save Configuration
          </button>
        </div>
      </form>
    </div>
  );
}
