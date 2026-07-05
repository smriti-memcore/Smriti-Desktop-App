import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { PalaceGraph, MemoryNode, PalaceRoom } from "../api";
import { MemoryTable } from "./MemoryTable";

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: "room" | "memory";
  val: number;
  color: string;
  raw?: any;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string;
  target: string;
  value: number;
}

interface GraphPaneProps {
  daemonOnline: boolean;
  viewMode: "graph" | "table";
  setViewMode: (mode: "graph" | "table") => void;
  graphData: PalaceGraph | null;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  selectedNode: any;
  setSelectedNode: (node: any) => void;
}

export function GraphPane({
  daemonOnline,
  viewMode,
  setViewMode,
  graphData,
  refreshing,
  onRefresh,
  selectedNode,
  setSelectedNode,
}: GraphPaneProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef<any>(null);
  const svgSelectionRef = useRef<any>(null);
  const nodesRef = useRef<GraphNode[]>([]);

  const handleReframe = () => {
    const nodes = nodesRef.current;
    if (!nodes || nodes.length === 0 || !svgSelectionRef.current || !zoomRef.current || !svgRef.current) return;

    const width = svgRef.current.clientWidth || 600;
    const height = svgRef.current.clientHeight || 500;

    // Calculate bounding box of all nodes
    const xs = nodes.map(n => n.x || 0);
    const ys = nodes.map(n => n.y || 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const pad = 40;
    const graphWidth = (maxX - minX) + pad * 2;
    const graphHeight = (maxY - minY) + pad * 2;

    if (graphWidth <= 0 || graphHeight <= 0) return;

    // Calculate optimal scale to fit all nodes inside the viewport
    let scale = Math.min(width / graphWidth, height / graphHeight);
    // Constrain scale to reasonable minimum/maximum bounds
    scale = Math.min(Math.max(scale, 0.25), 1.5);

    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const dx = (width / 2) - scale * midX;
    const dy = (height / 2) - scale * midY;

    const transform = d3.zoomIdentity.translate(dx, dy).scale(scale);

    svgSelectionRef.current
      .transition()
      .duration(750)
      .call(zoomRef.current.transform, transform);
  };

  const handleZoomIn = () => {
    if (svgSelectionRef.current && zoomRef.current) {
      svgSelectionRef.current
        .transition()
        .duration(300)
        .call(zoomRef.current.scaleBy, 1.3);
    }
  };

  const handleZoomOut = () => {
    if (svgSelectionRef.current && zoomRef.current) {
      svgSelectionRef.current
        .transition()
        .duration(300)
        .call(zoomRef.current.scaleBy, 0.7);
    }
  };

  // D3 force simulation render
  useEffect(() => {
    if (!svgRef.current || !graphData || viewMode !== "graph") return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); // Clear previous render

    const width = svgRef.current.clientWidth || 600;
    const height = svgRef.current.clientHeight || 500;

    // Convert API data to D3 Nodes and Links
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    // Add rooms
    graphData.rooms.forEach((room: PalaceRoom) => {
      nodes.push({
        id: `room:${room.id}`,
        label: room.topic,
        type: "room",
        val: 12,
        color: "#6366f1",
        raw: room
      });
    });

    // Add memories
    graphData.memories.forEach((memory: MemoryNode) => {
      const parentRoomId = `room:${memory.room_id}`;
      nodes.push({
        id: `mem:${memory.id}`,
        label: memory.content.length > 35 ? memory.content.substring(0, 35) + "..." : memory.content,
        type: "memory",
        val: 5,
        color: memory.visibility === "private" ? "#f59e0b" : "#06b6d4",
        raw: memory
      });

      // Link to parent room
      links.push({
        source: `mem:${memory.id}`,
        target: parentRoomId,
        value: 1
      });
    });

    // Setup visual container group for zoom/pan support
    const g = svg.append("g");

    // Add Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>().on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
    svg.call(zoom);
    zoomRef.current = zoom;
    svgSelectionRef.current = svg;
    nodesRef.current = nodes;

    // Build forces
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3.forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(50)
      )
      .force("charge", d3.forceManyBody().strength(-120))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(15));

    // Run ticks synchronously to pre-calculate settled positions
    for (let i = 0; i < 150; ++i) {
      simulation.tick();
    }

    // Apply auto-fit (reframe) immediately on load based on settled positions
    const xs = nodes.map(n => n.x || 0);
    const ys = nodes.map(n => n.y || 0);
    if (xs.length > 0) {
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      const pad = 40;
      const graphWidth = (maxX - minX) + pad * 2;
      const graphHeight = (maxY - minY) + pad * 2;

      if (graphWidth > 0 && graphHeight > 0) {
        let scale = Math.min(width / graphWidth, height / graphHeight);
        scale = Math.min(Math.max(scale, 0.25), 1.5);

        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        const dx = (width / 2) - scale * midX;
        const dy = (height / 2) - scale * midY;

        const transform = d3.zoomIdentity.translate(dx, dy).scale(scale);
        svg.call(zoom.transform, transform);
      }
    }

    // Draw links
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("class", "link")
      .attr("stroke", "#1e293b");

    // Draw nodes
    const node = g
      .append("g")
      .attr("class", "nodes")
      .selectAll("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("class", "node")
      .attr("r", (d) => d.val)
      .attr("fill", (d) => d.color)
      .attr("stroke", "#090d16")
      .attr("stroke-width", 1.5)
      .call(
        d3.drag<SVGCircleElement, GraphNode>()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended)
      )
      .on("click", (_, d) => {
        setSelectedNode(d);
      });

    // Add Labels for Rooms
    const label = g
      .append("g")
      .attr("class", "labels")
      .selectAll("text")
      .data(nodes.filter(n => n.type === "room"))
      .enter()
      .append("text")
      .attr("class", "node-label")
      .attr("dx", 12)
      .attr("dy", 4)
      .text((d) => d.label);

    // Simulation Ticks
    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);

      label.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
    });

    // Drag handlers
    function dragstarted(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: any) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
  }, [graphData, viewMode]);

  if (!daemonOnline) {
    return (
      <div className="pane">
        <div className="empty-state">Daemon is offline. Start the background server to explore memory Palace.</div>
      </div>
    );
  }

  const roomMap = new Map<string, string>(graphData?.rooms?.map((r) => [r.id, r.topic]) || []);

  return (
    <div className="pane graph-pane" style={{ padding: 0, overflow: "hidden" }}>
      <div className="graph-view" style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", position: "relative" }}>
        
        {/* Controls Header Bar */}
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center", 
          padding: "12px 16px", 
          borderBottom: "1px solid var(--border)",
          background: "rgba(0, 0, 0, 0.15)",
          flexShrink: 0,
          zIndex: 10,
          flexWrap: "wrap",
          gap: "8px"
        }}>
          {/* Toggle Controls (Left Side) */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button 
              className="btn-secondary" 
              style={{ 
                padding: "6px 12px", 
                fontSize: "11px",
                background: viewMode === "graph" ? "rgba(99, 102, 241, 0.15)" : "rgba(255, 255, 255, 0.03)",
                borderColor: viewMode === "graph" ? "var(--accent)" : "var(--border)",
                color: viewMode === "graph" ? "var(--text)" : "var(--text-muted)"
              }} 
              onClick={() => setViewMode("graph")}
            >
              Graph View
            </button>
            <button 
              className="btn-secondary" 
              style={{ 
                padding: "6px 12px", 
                fontSize: "11px",
                background: viewMode === "table" ? "rgba(99, 102, 241, 0.15)" : "rgba(255, 255, 255, 0.03)",
                borderColor: viewMode === "table" ? "var(--accent)" : "var(--border)",
                color: viewMode === "table" ? "var(--text)" : "var(--text-muted)"
              }} 
              onClick={() => setViewMode("table")}
            >
              Table View
            </button>
          </div>

          {/* Action Controls (Right Side) */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {viewMode === "graph" && (
              <>
                <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: "11px" }} onClick={handleReframe}>Reframe</button>
                <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: "11px" }} onClick={handleZoomIn}>+</button>
                <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: "11px" }} onClick={handleZoomOut}>-</button>
              </>
            )}
            <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: "11px" }} onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* View Contents */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", width: "100%" }}>
          {viewMode === "graph" ? (
            !graphData ? (
              <div className="empty-state">Loading SMRITI Memory Palace...</div>
            ) : (
              <svg ref={svgRef} className="graph-canvas"></svg>
            )
          ) : (
            <MemoryTable 
              graphData={graphData} 
              roomMap={roomMap} 
              selectedNode={selectedNode}
              setSelectedNode={setSelectedNode}
            />
          )}
        </div>
      </div>
      
      {/* Node detail side panel */}
      <div className="graph-sidebar">
        <div className="sidebar-header">Palace Node Inspector</div>
        <div className="selection-details">
          {!selectedNode ? (
            <div className="empty-state">Select an item in the explorer to inspect its details.</div>
          ) : (
            <>
              <div>
                <span className="selected-node-title" style={{ fontSize: "18px", fontWeight: "800" }}>
                  {selectedNode.type === "room" ? "Category Room" : "Memory Node"}
                </span>
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px" }}>
                <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  TYPE: {selectedNode.type}
                </span>
                {selectedNode.type === "memory" && (
                  <>
                    <span style={{ 
                      fontSize: "11px", 
                      fontWeight: "800", 
                      color: selectedNode.raw?.visibility === "private" ? "var(--gold)" : "var(--accent)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px"
                    }}>
                      VISIBILITY: {String(selectedNode.raw?.visibility).toUpperCase()}
                    </span>
                    <span style={{ 
                      fontSize: "11px", 
                      fontWeight: "800", 
                      color: 
                        selectedNode.raw?.reflection_level === 0 ? "#22d3ee" :
                        selectedNode.raw?.reflection_level === 1 ? "#c084fc" :
                        selectedNode.raw?.reflection_level === 2 ? "#f472b6" :
                        "#f59e0b",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px"
                    }}>
                      STATE: {
                        selectedNode.raw?.reflection_level === 0 ? "DIRECT" :
                        selectedNode.raw?.reflection_level === 1 ? "OBSERVATION" :
                        selectedNode.raw?.reflection_level === 2 ? "INSIGHT" :
                        "PRINCIPLE"
                      } (LEVEL {selectedNode.raw?.reflection_level || 0})
                    </span>
                  </>
                )}
              </div>
              
              <div className="selected-node-content" style={{ marginTop: "20px" }}>
                <strong style={{ display: "block", marginBottom: "6px", fontSize: "13px", color: "var(--text-muted)" }}>
                  {selectedNode.type === "room" ? "Topic:" : "Content:"}
                </strong>
                <p style={{ whiteSpace: "pre-wrap", color: "#cbd5e1", lineHeight: "1.6", fontSize: "13px" }}>
                  {selectedNode.type === "room" ? selectedNode.raw?.topic : selectedNode.raw?.content}
                </p>
              </div>

              {selectedNode.type === "memory" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "24px" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "18px", fontWeight: "800", color: "var(--accent)" }}>
                      {(selectedNode.raw?.strength * 100).toFixed(0)}%
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: "2px" }}>
                      Memory Strength
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "15px", fontWeight: "700", color: "var(--text)" }}>
                      {selectedNode.raw?.status}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: "2px" }}>
                      Status
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
