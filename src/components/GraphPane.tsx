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
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const prevGraphDataRef = useRef<string>("");
  const isInitializedRef = useRef<boolean>(false);

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
    if (!svgRef.current || !graphData || viewMode !== "graph") {
      // Clear data hash ref and initialized state on viewMode change/unmount
      prevGraphDataRef.current = "";
      isInitializedRef.current = false;
      return;
    }

    // Check if graph data actually changed by comparing IDs
    const currentDataHash = JSON.stringify({
      rooms: graphData.rooms.map(r => r.id).sort(),
      memories: graphData.memories.map(m => m.id).sort()
    });
    if (currentDataHash === prevGraphDataRef.current) {
      return; // Skip rebuild if data is unchanged (preserves zoom/drag state)
    }
    prevGraphDataRef.current = currentDataHash;

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

    links.forEach((l: any) => {
      l.t = Math.random();
      l.speed = 0.003 + Math.random() * 0.004;
      l.is_active = false;
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
    if (!isInitializedRef.current) {
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
      isInitializedRef.current = true;
    }

    // Draw links
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("path")
      .data(links)
      .enter()
      .append("path")
      .attr("class", "link")
      .attr("stroke", (d: any) => d.source.color || "var(--accent)")
      .attr("fill", "none");

    // Draw particle dots (synapses transmitting impulses)
    const particle = g
      .append("g")
      .attr("class", "particles")
      .selectAll("circle")
      .data(links)
      .enter()
      .append("circle")
      .attr("class", "particle-dot")
      .attr("r", 2.5)
      .attr("fill", (d: any) => d.source.color || "var(--accent)");

    // Draw nodes
    const node = g
      .append("g")
      .attr("class", "nodes")
      .selectAll("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("class", (d) => d.type === "room" ? "node room-node" : "node memory-node")
      .attr("r", (d) => d.type === "room" ? 16 : 8)
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
      })
      .on("mouseover", (_, d) => {
        if (!tooltipRef.current) return;
        let content = "";
        if (d.type === "room") {
          content = `<strong>🏛️ Category Room</strong><br/>Topic: ${d.label}`;
        } else {
          const strength = d.raw?.strength ? (d.raw.strength * 100).toFixed(0) : "0";
          const level = d.raw?.reflection_level || 0;
          const levelNames = ["Direct", "Observation", "Insight", "Principle"];
          const stateName = levelNames[level] || "Direct";
          content = `<strong>🧠 Memory Node</strong><br/><p style="margin: 4px 0;">${d.raw?.content.substring(0, 100)}${d.raw?.content.length > 100 ? "..." : ""}</p><em>Strength: ${strength}%<br/>State: ${stateName} (Level ${level})</em>`;
        }
        tooltipRef.current.innerHTML = content;
        tooltipRef.current.style.opacity = "1";

        // Highlight active classes
        svg.classed("has-active", true);
        node.classed("active", (n: any) => n.id === d.id);
        link.classed("active", (l: any) => {
          const sId = typeof l.source === "object" ? l.source.id : l.source;
          const tId = typeof l.target === "object" ? l.target.id : l.target;
          const isActive = sId === d.id || tId === d.id;
          l.is_active = isActive;
          return isActive;
        });
        particle.classed("active", (l: any) => l.is_active);
      })
      .on("mousemove", (event) => {
        if (!tooltipRef.current || !svgRef.current) return;
        const container = svgRef.current.getBoundingClientRect();
        tooltipRef.current.style.left = `${event.clientX - container.left + 14}px`;
        tooltipRef.current.style.top = `${event.clientY - container.top + 14}px`;
      })
      .on("mouseout", () => {
        if (!tooltipRef.current) return;
        tooltipRef.current.style.opacity = "0";
        svg.classed("has-active", false);
        node.classed("active", false);
        link.classed("active", false).each((l: any) => { l.is_active = false; });
        particle.classed("active", false);
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
      .attr("dx", 20)
      .attr("dy", 5)
      .text((d) => "🏛️ " + d.label);

    // Simulation Ticks
    simulation.on("tick", () => {
      link.attr("d", (d: any) => {
        const x1 = d.source.x;
        const y1 = d.source.y;
        const x2 = d.target.x;
        const y2 = d.target.y;
        
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dr = Math.sqrt(dx * dx + dy * dy);
        
        if (dr === 0) return `M ${x1} ${y1} L ${x2} ${y2}`;
        
        // Curve factor: 0.18 gives a beautiful organic curve
        const curveFactor = 0.18;
        const cx = (x1 + x2) / 2 - (dy / dr) * (dr * curveFactor);
        const cy = (y1 + y2) / 2 + (dx / dr) * (dr * curveFactor);
        
        return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
      });

      // Update particle dot positions along the quadratic bezier curve
      particle.each(function(d: any) {
        const x1 = d.source.x;
        const y1 = d.source.y;
        const x2 = d.target.x;
        const y2 = d.target.y;
        
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dr = Math.sqrt(dx * dx + dy * dy);
        
        if (dr === 0) {
          d3.select(this).attr("cx", x1).attr("cy", y1);
          return;
        }
        
        const curveFactor = 0.18;
        const cx = (x1 + x2) / 2 - (dy / dr) * (dr * curveFactor);
        const cy = (y1 + y2) / 2 + (dx / dr) * (dr * curveFactor);
        
        // Advance progress t (fast when active, slow when inactive)
        d.t = (d.t + (d.is_active ? 0.015 : d.speed)) % 1;
        const t = d.t;
        
        // Compute position using Bezier equation
        const px = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
        const py = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
        
        d3.select(this).attr("cx", px).attr("cy", py);
      });

      node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);

      label.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
    });

    // Drag handlers
    function dragstarted(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function dragged(event: any, d: any) {
      d.fx = event.x;
      d.fy = event.y;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function dragended(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // Continuous particle animation loop (independent of force simulation ticks)
    const timer = d3.timer(() => {
      particle.each(function(d: any) {
        const x1 = d.source.x;
        const y1 = d.source.y;
        const x2 = d.target.x;
        const y2 = d.target.y;
        if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dr = Math.sqrt(dx * dx + dy * dy);
        
        if (dr === 0) {
          d3.select(this).attr("cx", x1).attr("cy", y1);
          return;
        }
        
        const curveFactor = 0.18;
        const cx = (x1 + x2) / 2 - (dy / dr) * (dr * curveFactor);
        const cy = (y1 + y2) / 2 + (dx / dr) * (dr * curveFactor);
        
        d.t = (d.t + (d.is_active ? 0.015 : d.speed)) % 1;
        const t = d.t;
        
        const px = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
        const py = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
        
        d3.select(this).attr("cx", px).attr("cy", py);
      });
    });

    return () => {
      simulation.stop();
      timer.stop();
    };
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
              <>
                <svg ref={svgRef} className="graph-canvas"></svg>
                <div ref={tooltipRef} className="graph-tooltip" style={{ opacity: 0, left: 0, top: 0 }}></div>
              </>
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
