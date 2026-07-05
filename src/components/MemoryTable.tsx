import { useState } from "react";
import { PalaceGraph, MemoryNode } from "../api";

interface MemoryTableProps {
  graphData: PalaceGraph | null;
  roomMap: Map<string, string>;
  selectedNode: any;
  setSelectedNode: (node: any) => void;
}

export function MemoryTable({
  graphData,
  roomMap,
  selectedNode,
  setSelectedNode,
}: MemoryTableProps) {
  // Table View & Filtering States (Scoped locally)
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRoomFilter, setSelectedRoomFilter] = useState("all");
  const [selectedVisibilityFilter, setSelectedVisibilityFilter] = useState("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("all");
  const [sortField, setSortField] = useState<"content" | "strength" | "created">("created");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Filter and sort memories for the table representation
  const toggleSort = (field: "content" | "strength" | "created") => {
    if (sortField === field) {
      setSortDirection(prev => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const tableMemories = graphData && graphData.memories ? graphData.memories.filter((m: MemoryNode) => {
    const matchesSearch = searchQuery === "" || m.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRoom = selectedRoomFilter === "all" || m.room_id === selectedRoomFilter;
    const matchesVisibility = selectedVisibilityFilter === "all" || m.visibility === selectedVisibilityFilter;
    const matchesStatus = selectedStatusFilter === "all" || m.status === selectedStatusFilter;
    return matchesSearch && matchesRoom && matchesVisibility && matchesStatus;
  }).sort((a: MemoryNode, b: MemoryNode) => {
    let aVal: any = sortField === "created" ? a.created_at : sortField === "strength" ? a.strength : a.content;
    let bVal: any = sortField === "created" ? b.created_at : sortField === "strength" ? b.strength : b.content;
    
    if (aVal === undefined || aVal === null) return 1;
    if (bVal === undefined || bVal === null) return -1;
    
    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
    return 0;
  }) : [];

  return (
    <div className="table-view-container">
      {/* Filters Bar */}
      <div className="table-filters">
        <input 
          type="text" 
          placeholder="Search memory content..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: "220px" }}
        />
        <select 
          value={selectedRoomFilter}
          onChange={(e) => setSelectedRoomFilter(e.target.value)}
          style={{ width: "160px" }}
        >
          <option value="all">All Category Rooms</option>
          {graphData?.rooms?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.topic.length > 25 ? r.topic.substring(0, 25) + "..." : r.topic}
            </option>
          ))}
        </select>
        <select 
          value={selectedVisibilityFilter}
          onChange={(e) => setSelectedVisibilityFilter(e.target.value)}
        >
          <option value="all">All Visibility</option>
          <option value="shared">Shared</option>
          <option value="private">Private</option>
        </select>
        <select 
          value={selectedStatusFilter}
          onChange={(e) => setSelectedStatusFilter(e.target.value)}
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="pinned">Pinned</option>
          <option value="decaying">Decaying</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Grid Data Wrapper */}
      <div className="table-wrapper">
        {tableMemories.length === 0 ? (
          <div className="empty-state" style={{ padding: "40px" }}>
            No memories match the filter criteria.
          </div>
        ) : (
          <table className="memory-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort("content")} style={{ minWidth: "350px" }}>
                  Memory Content {sortField === "content" && (sortDirection === "asc" ? "▲" : "▼")}
                </th>
                <th style={{ width: "200px" }}>Room / Category</th>
                <th onClick={() => toggleSort("strength")} style={{ width: "100px", textAlign: "right" }}>
                  Strength {sortField === "strength" && (sortDirection === "asc" ? "▲" : "▼")}
                </th>
                <th style={{ width: "90px" }}>Status</th>
                <th style={{ width: "120px" }}>State</th>
                <th style={{ width: "90px" }}>Visibility</th>
                <th onClick={() => toggleSort("created")} style={{ width: "120px" }}>
                  Created At {sortField === "created" && (sortDirection === "asc" ? "▲" : "▼")}
                </th>
              </tr>
            </thead>
            <tbody>
              {tableMemories.map((m: MemoryNode) => {
                const isSelected = selectedNode && selectedNode.id === `mem:${m.id}`;
                const formattedDate = new Date(m.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                });
                
                return (
                  <tr 
                    key={m.id} 
                    className={isSelected ? "selected" : ""} 
                    onClick={() => setSelectedNode({
                      id: `mem:${m.id}`,
                      label: m.content.length > 35 ? m.content.substring(0, 35) + "..." : m.content,
                      type: "memory",
                      val: 5,
                      color: m.visibility === "private" ? "#f59e0b" : "#06b6d4",
                      raw: m
                    })}
                  >
                    <td 
                      style={{ 
                        fontWeight: 500, 
                        lineHeight: "1.4",
                        maxWidth: "350px",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        overflow: "hidden"
                      }} 
                      title={m.content}
                    >
                      {m.content}
                    </td>
                    <td>
                      <span className="meta-pill" style={{ 
                        background: "rgba(99, 102, 241, 0.1)", 
                        borderColor: "rgba(99, 102, 241, 0.3)", 
                        color: "var(--accent)",
                        textTransform: "none",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "180px",
                        display: "inline-block"
                      }}>
                        {roomMap.get(m.room_id) || m.room_id}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: "bold", color: m.strength >= 0.8 ? "#10b981" : m.strength >= 0.5 ? "#f59e0b" : "#ef4444" }}>
                      {(m.strength * 100).toFixed(0)}%
                    </td>
                    <td>
                      <span className={`meta-pill ${m.status}`}>
                        {m.status}
                      </span>
                    </td>
                    <td>
                      <span className="meta-pill" style={{
                        background: 
                          m.reflection_level === 0 ? "rgba(6, 182, 212, 0.08)" : 
                          m.reflection_level === 1 ? "rgba(168, 85, 247, 0.08)" :
                          m.reflection_level === 2 ? "rgba(236, 72, 153, 0.08)" : 
                          "rgba(245, 158, 11, 0.08)",
                        borderColor: 
                          m.reflection_level === 0 ? "rgba(6, 182, 212, 0.2)" : 
                          m.reflection_level === 1 ? "rgba(168, 85, 247, 0.2)" :
                          m.reflection_level === 2 ? "rgba(236, 72, 153, 0.2)" : 
                          "rgba(245, 158, 11, 0.2)",
                        color: 
                          m.reflection_level === 0 ? "#22d3ee" : 
                          m.reflection_level === 1 ? "#c084fc" :
                          m.reflection_level === 2 ? "#f472b6" : 
                          "#f59e0b",
                        textTransform: "uppercase",
                        fontSize: "10px",
                        borderStyle: "solid",
                        borderWidth: "1px"
                      }}>
                        {
                          m.reflection_level === 0 ? "Direct" :
                          m.reflection_level === 1 ? "Observation" :
                          m.reflection_level === 2 ? "Insight" :
                          "Principle"
                        }
                      </span>
                    </td>
                    <td>
                      <span className={`meta-pill ${m.visibility}`} style={{
                        color: m.visibility === "private" ? "var(--gold)" : "var(--accent)"
                      }}>
                        {m.visibility}
                      </span>
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                      {formattedDate}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
