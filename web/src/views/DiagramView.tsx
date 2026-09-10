import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useNodesState, useEdgesState, useReactFlow, type Node, type Edge, type NodeProps, type NodeChange } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { Save, LayoutGrid, Focus, EyeOff, Eye, Search, Maximize2, Table2, Download } from 'lucide-react';
import type { SchemaSnapshot, TableInfo } from '@schemaforge/shared';
import { tableKey } from '@schemaforge/shared';
import { api } from '../api';
import { openTable, useStore } from '../store';

type ErNodeData = { table: TableInfo; dim: boolean; selected: boolean; showAll: boolean };
type ErNode = Node<ErNodeData, 'er'>;

const MAX_COLS = 14;
const NODE_W = 220;

function ErNodeView({ data }: NodeProps<ErNode>) {
  const t = data.table;
  const fkCols = new Set(t.foreignKeys.flatMap((f) => f.columns));
  const cols = data.showAll ? t.columns : t.columns.slice(0, MAX_COLS);
  return (
    <div className={`er-node ${data.selected ? 'selected' : ''} ${data.dim ? 'dim' : ''}`} style={{ width: NODE_W }}>
      <Handle type="target" position={Position.Left} id="tgt" />
      <Handle type="source" position={Position.Right} id="src" />
      <div className="er-title"><Table2 size={11} /> {t.name}<span className="kind">{t.kind === 'table' ? (t.rowEstimate != null ? `~${t.rowEstimate}` : '') : t.kind}</span></div>
      {cols.map((c) => (
        <div className="er-col" key={c.name}>
          <span className="name" style={c.isPrimaryKey ? { fontWeight: 600 } : undefined}>{c.name}</span>
          {c.isPrimaryKey && <span className="key">PK</span>}
          {fkCols.has(c.name) && <span className="fk">FK</span>}
          <span className="type">{c.dataType.length > 14 ? c.dataType.slice(0, 13) + '…' : c.dataType}</span>
        </div>
      ))}
      {!data.showAll && t.columns.length > MAX_COLS && <div className="er-more">+{t.columns.length - MAX_COLS} more columns</div>}
    </div>
  );
}

const nodeTypes = { er: ErNodeView };

function layoutWithDagre(tables: TableInfo[], edges: Edge[]): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of tables) g.setNode(tableKey(t.schema, t.name), { width: NODE_W, height: 34 + Math.min(t.columns.length, MAX_COLS) * 18 + (t.columns.length > MAX_COLS ? 18 : 0) });
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  for (const t of tables) {
    const key = tableKey(t.schema, t.name);
    const n = g.node(key);
    if (n) out[key] = { x: n.x - NODE_W / 2, y: n.y - n.height / 2 };
  }
  return out;
}

function neighbors(snap: SchemaSnapshot, key: string, depth: number): Set<string> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => { adj.set(a, (adj.get(a) ?? new Set()).add(b)); adj.set(b, (adj.get(b) ?? new Set()).add(a)); };
  for (const t of snap.tables) for (const fk of t.foreignKeys) add(tableKey(t.schema, t.name), tableKey(fk.refSchema, fk.refTable));
  const seen = new Set([key]);
  let frontier = [key];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const k of frontier) for (const n of adj.get(k) ?? []) if (!seen.has(n)) { seen.add(n); next.push(n); }
    frontier = next;
  }
  return seen;
}

function Diagram({ connectionId, focus }: { connectionId: string; focus?: string }) {
  const snap = useStore((s) => s.schemas[connectionId]);
  const loadSchema = useStore((s) => s.loadSchema);
  const toast = useStore((s) => s.toast);
  const [nodes, setNodes, onNodesChange] = useNodesState<ErNode>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const [search, setSearch] = useState('');
  const [focusKey, setFocusKey] = useState<string | null>(focus ?? null);
  const [depth, setDepth] = useState(1);
  const [hideUnrelated, setHideUnrelated] = useState(!!focus);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showViews, setShowViews] = useState(false);
  const [showAllCols, setShowAllCols] = useState(false);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const rf = useReactFlow();
  const initialFit = useRef(false);

  useEffect(() => { if (!snap) void loadSchema(connectionId); }, [snap, connectionId, loadSchema]);
  useEffect(() => {
    api.layout(connectionId).then((l) => { if (Object.keys(l.positions).length) setPositions(l.positions); setHidden(new Set(l.hidden)); setLayoutLoaded(true); }).catch(() => setLayoutLoaded(true));
  }, [connectionId]);
  useEffect(() => { if (focus) { setFocusKey(focus); setHideUnrelated(true); } }, [focus]);

  const allEdges = useMemo<Edge[]>(() => {
    if (!snap) return [];
    const out: Edge[] = [];
    for (const t of snap.tables) for (const fk of t.foreignKeys) {
      const source = tableKey(t.schema, t.name);
      const target = tableKey(fk.refSchema, fk.refTable);
      out.push({ id: `${source}:${fk.name}`, source, target, sourceHandle: 'src', targetHandle: 'tgt', label: fk.columns.join(','), labelStyle: { fill: '#8a90a0', fontSize: 9 }, labelBgStyle: { fill: '#1d2026' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#5a6170' }, type: 'smoothstep' });
    }
    return out;
  }, [snap]);

  const visibleKeys = useMemo(() => {
    if (!snap) return new Set<string>();
    let keys = snap.tables.filter((t) => showViews || t.kind === 'table').map((t) => tableKey(t.schema, t.name));
    if (hideUnrelated && focusKey) { const n = neighbors(snap, focusKey, depth); keys = keys.filter((k) => n.has(k)); }
    keys = keys.filter((k) => !hidden.has(k));
    return new Set(keys);
  }, [snap, showViews, hideUnrelated, focusKey, depth, hidden]);

  // Build nodes whenever the visible set or layout changes.
  useEffect(() => {
    if (!snap || !layoutLoaded) return;
    const tables = snap.tables.filter((t) => visibleKeys.has(tableKey(t.schema, t.name)));
    const visEdges = allEdges.filter((e) => visibleKeys.has(e.source) && visibleKeys.has(e.target));
    const auto = layoutWithDagre(tables, visEdges);
    const q = search.trim().toLowerCase();
    const matches = q ? new Set(tables.filter((t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))).map((t) => tableKey(t.schema, t.name))) : null;
    const focusSet = focusKey && !hideUnrelated ? neighbors(snap, focusKey, depth) : null;
    setNodes((prev) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]));
      return tables.map((t) => {
        const key = tableKey(t.schema, t.name);
        const position = prevPos.get(key) ?? positions?.[key] ?? auto[key] ?? { x: 0, y: 0 };
        const dim = (matches ? !matches.has(key) : false) || (focusSet ? !focusSet.has(key) : false);
        return { id: key, type: 'er' as const, position, data: { table: t, dim, selected: key === focusKey, showAll: showAllCols }, draggable: true };
      });
    });
    setEdges(visEdges.map((e) => ({ ...e, className: e.source === focusKey || e.target === focusKey ? 'highlight' : '' })));
    if (!initialFit.current) { initialFit.current = true; setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 50); }
  }, [snap, layoutLoaded, visibleKeys, allEdges, positions, search, focusKey, hideUnrelated, depth, showAllCols, setNodes, setEdges, rf]);

  const onChange = useCallback((changes: NodeChange<ErNode>[]) => onNodesChange(changes), [onNodesChange]);

  const saveLayout = async () => {
    const pos: Record<string, { x: number; y: number }> = { ...(positions ?? {}) };
    for (const n of nodes) pos[n.id] = n.position;
    await api.saveLayout(connectionId, { positions: pos, hidden: [...hidden] });
    setPositions(pos);
    toast('Layout saved', 'success');
  };
  const autoLayout = () => {
    if (!snap) return;
    const tables = snap.tables.filter((t) => visibleKeys.has(tableKey(t.schema, t.name)));
    const auto = layoutWithDagre(tables, allEdges.filter((e) => visibleKeys.has(e.source) && visibleKeys.has(e.target)));
    setNodes((prev) => prev.map((n) => ({ ...n, position: auto[n.id] ?? n.position })));
    setPositions(null);
    setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 50);
  };
  const exportSvg = () => {
    const el = document.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!el) return;
    const text = nodes.map((n) => `${n.id}\t${n.position.x.toFixed(0)}\t${n.position.y.toFixed(0)}`).join('\n');
    const mermaid = ['erDiagram', ...edges.map((e) => `  ${e.target.split('.').pop()} ||--o{ ${e.source.split('.').pop()} : "${String(e.label ?? '')}"`)].join('\n');
    const blob = new Blob([`%% SchemaForge export\n${mermaid}\n\n%% positions\n${text}`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'schema-diagram.mmd';
    a.click();
  };

  if (!snap) return <div className="empty">Loading schema…</div>;
  const total = snap.tables.filter((t) => showViews || t.kind === 'table').length;

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div className="diagram-toolbar">
        <span className="row" style={{ gap: 4 }}><Search size={12} /><input className="input sm" placeholder="Search tables/columns" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 160 }} /></span>
        <select className="select" value={focusKey ?? ''} onChange={(e) => { setFocusKey(e.target.value || null); if (!e.target.value) setHideUnrelated(false); }} style={{ maxWidth: 180 }}>
          <option value="">Focus table…</option>
          {snap.tables.filter((t) => t.kind === 'table' || showViews).map((t) => <option key={tableKey(t.schema, t.name)} value={tableKey(t.schema, t.name)}>{t.name}</option>)}
        </select>
        {focusKey && (
          <>
            <button className={`btn sm ${hideUnrelated ? 'primary' : ''}`} onClick={() => setHideUnrelated(!hideUnrelated)} title="Hide tables not related to the focused table">{hideUnrelated ? <EyeOff size={12} /> : <Eye size={12} />} {hideUnrelated ? 'related only' : 'all'}</button>
            <select className="select" value={depth} onChange={(e) => setDepth(Number(e.target.value))}><option value={1}>depth 1</option><option value={2}>depth 2</option><option value={3}>depth 3</option></select>
          </>
        )}
        <button className="btn sm" onClick={() => setShowViews(!showViews)}>{showViews ? 'hide views' : 'show views'}</button>
        <button className="btn sm" onClick={() => setShowAllCols(!showAllCols)}>{showAllCols ? 'compact' : 'all columns'}</button>
        <button className="btn sm" onClick={autoLayout} title="Auto layout"><LayoutGrid size={12} /></button>
        <button className="btn sm" onClick={() => rf.fitView({ padding: 0.15, duration: 300 })} title="Fit"><Maximize2 size={12} /></button>
        <button className="btn sm" onClick={() => void saveLayout()} title="Save layout"><Save size={12} /> save</button>
        <button className="btn sm" onClick={exportSvg} title="Export (mermaid + positions)"><Download size={12} /></button>
        {hidden.size > 0 && <button className="btn ghost sm" onClick={() => setHidden(new Set())}>unhide {hidden.size}</button>}
        <span className="muted small">{visibleKeys.size}/{total} tables</span>
        {total > 80 && !hideUnrelated && <span className="badge yellow" title="Large schema: focus on a table to keep the diagram readable"><Focus size={10} /> large schema</span>}
      </div>
      <ReactFlow<ErNode, Edge>
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onChange} minZoom={0.05} maxZoom={2} fitView proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => { setFocusKey(n.id); const t = n.data.table; useStore.getState().select({ connectionId, table: { schema: t.schema, name: t.name } }); }}
        onNodeDoubleClick={(_, n) => openTable(connectionId, n.data.table.schema, n.data.table.name)}
        onNodeContextMenu={(e, n) => { e.preventDefault(); setHidden(new Set(hidden).add(n.id)); }}
        onPaneClick={() => { if (!hideUnrelated) setFocusKey(null); }}
      >
        <Background gap={20} color="#262a32" />
        <Controls showInteractive={false} />
        {visibleKeys.size > 12 && <MiniMap pannable zoomable nodeColor={() => '#3a3f49'} maskColor="rgba(22,24,29,0.7)" />}
      </ReactFlow>
    </div>
  );
}

export function DiagramView(props: { connectionId: string; focus?: string }) {
  return <ReactFlowProvider><Diagram {...props} /></ReactFlowProvider>;
}
