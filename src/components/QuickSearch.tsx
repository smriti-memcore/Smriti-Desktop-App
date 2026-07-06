import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { smritiApi, RecalledMemory } from "../api";

export function QuickSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecalledMemory[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus input on mount and window show
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Query API when input changes
  useEffect(() => {
    const fetchResults = async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      try {
        const data = await smritiApi.recallMemory(query);
        setResults(data.slice(0, 5)); // Limit to top 5 results for compactness
        setSelectedIndex(0);
      } catch (err) {
        console.error("Recall search failed:", err);
      }
    };

    const delayDebounceFn = setTimeout(fetchResults, 150);
    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  // Handle keyboard events (up/down/enter/escape)
  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      await getCurrentWindow().hide();
      setQuery("");
      setResults([]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length > 0 && selectedIndex < results.length) {
        const memory = results[selectedIndex];
        try {
          await navigator.clipboard.writeText(memory.content);
          // Show copy feedback in input placeholder or visual notification
          setQuery("");
          setResults([]);
          await getCurrentWindow().hide();
        } catch (err) {
          console.error("Failed to copy:", err);
        }
      }
    }
  };

  const handleResultClick = async (memory: RecalledMemory) => {
    try {
      await navigator.clipboard.writeText(memory.content);
      setQuery("");
      setResults([]);
      await getCurrentWindow().hide();
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="spotlight-wrapper" onKeyDown={handleKeyDown}>
      <div className="spotlight-input-wrap">
        <span style={{ fontSize: "16px", color: "var(--accent)" }}>🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Recall a memory (e.g. launch date, deal legal owner)..."
          className="spotlight-input"
        />
        {query && (
          <button 
            onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "11px" }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="spotlight-results">
        {query.trim() === "" ? (
          <div className="empty-state" style={{ margin: "auto", fontSize: "11px", color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <span>🧠 Search SMRITI Palace from anywhere</span>
            <span style={{ fontSize: "9px" }}>Press <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>S</kbd> to toggle</span>
          </div>
        ) : results.length === 0 ? (
          <div className="empty-state" style={{ margin: "auto", fontSize: "11px" }}>
            No matching memories found in SMRITI.
          </div>
        ) : (
          results.map((memory, index) => (
            <div
              key={memory.id}
              className={`spotlight-result-item ${index === selectedIndex ? "selected" : ""}`}
              onClick={() => handleResultClick(memory)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="spotlight-result-content">{memory.content}</div>
              <div className="spotlight-result-meta">
                <span style={{ color: "var(--accent)", fontWeight: "600" }}>
                  {(memory.strength * 100).toFixed(0)}% strength
                </span>
                <span>{memory.status}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="spotlight-footer">
        <div className="spotlight-hint">
          Press <kbd>↵</kbd> to Copy & Close &nbsp;•&nbsp; <kbd>↑↓</kbd> to Navigate
        </div>
        <div className="spotlight-hint">
          Press <kbd>Esc</kbd> to Close
        </div>
      </div>
    </div>
  );
}
