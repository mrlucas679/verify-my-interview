// Interactive scam-intelligence evidence graph (react-force-graph-2d).
//
// Renders reports + the hard identifiers they share (domains, emails, phones,
// payment handles). Node color encodes type, size encodes how many reports
// touch the entity, an outer ring encodes trust. Clicking a node opens a
// detail panel with its linked reports — every connection is inspectable.

import { useCallback, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { X } from 'lucide-react';
import type { EntityGraph, GraphNode, NodeType, TrustLevel } from '../lib/types';

const NODE_COLORS: Record<NodeType, string> = {
  report: '#4d7cfe',
  domain: '#e0783b',
  email: '#e0a93b',
  phone: '#f0544f',
  payment_handle: '#f0544f',
  company: '#8a93a6',
  recruiter_alias: '#c084fc',
};

const TRUST_RING: Partial<Record<TrustLevel, string>> = {
  corroborated: '#f0544f',
  trusted: '#4d7cfe',
};

const TYPE_LABELS: Record<NodeType, string> = {
  report: 'Report',
  domain: 'Domain',
  email: 'Email',
  phone: 'Phone',
  payment_handle: 'Payment handle',
  company: 'Impersonated brand',
  recruiter_alias: 'Recruiter alias',
};

interface FGNode extends GraphNode {
  x?: number;
  y?: number;
}

export function EvidenceGraph({
  graph,
  height = 380,
}: {
  graph: EntityGraph;
  height?: number;
}) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.edges.map((e) => ({ ...e })),
    }),
    [graph]
  );

  const neighbors = useMemo(() => {
    if (!selected) return [];
    const ids = new Set<string>();
    for (const e of graph.edges) {
      if (e.source === selected.id) ids.add(e.target);
      if (e.target === selected.id) ids.add(e.source);
    }
    return graph.nodes.filter((n) => ids.has(n.id));
  }, [selected, graph]);

  const drawNode = useCallback(
    (node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isCase = node.id === 'report:case-current';
      const r = isCase ? 9 : 4 + Math.min(node.reportCount ?? 1, 6);
      const color = NODE_COLORS[node.type] ?? '#8a93a6';

      // Trust / case ring
      const ring = isCase ? '#ffffff' : node.trust ? TRUST_RING[node.trust] : undefined;
      if (ring) {
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, r + 2.5, 0, 2 * Math.PI);
        ctx.strokeStyle = ring;
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.globalAlpha = node.type === 'company' || node.type === 'recruiter_alias' ? 0.7 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Labels at readable zoom only
      if (globalScale > 1.1 || isCase) {
        const label =
          node.label.length > 26 ? `${node.label.slice(0, 24)}…` : node.label;
        ctx.font = `${10 / globalScale}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = isCase ? '#e2e8f0' : '#8a93a6';
        ctx.fillText(label, node.x!, node.y! + r + 3 / globalScale);
      }
    },
    []
  );

  return (
    <div className="surface relative overflow-hidden">
      <div className="pointer-events-none absolute left-4 top-3 z-10 flex flex-wrap gap-x-4 gap-y-1">
        {(
          ['report', 'domain', 'email', 'phone', 'payment_handle', 'company'] as NodeType[]
        ).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-faint">
            <span className="h-2 w-2 rounded-full" style={{ background: NODE_COLORS[t] }} />
            {TYPE_LABELS[t]}
          </span>
        ))}
      </div>

      {data.nodes.length <= 1 ? (
        <div className="grid place-items-center p-10 text-sm text-muted" style={{ height }}>
          No network connections found for this case.
        </div>
      ) : (
        <ForceGraph2D
          ref={fgRef as any}
          graphData={data}
          height={height}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeCanvasObject={drawNode as any}
          nodePointerAreaPaint={(node: any, color, ctx) => {
            const r = 6 + Math.min(node.reportCount ?? 1, 6);
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }}
          linkColor={() => 'rgba(138,147,166,0.25)'}
          linkWidth={(l: any) => Math.min(l.weight ?? 1, 3)}
          onNodeClick={(node: any) => setSelected(node as GraphNode)}
          onBackgroundClick={() => setSelected(null)}
          cooldownTicks={80}
          onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
        />
      )}

      {selected && (
        <div className="absolute bottom-3 right-3 top-12 z-20 w-72 overflow-y-auto rounded-xl border border-line bg-ink-900/95 p-4 backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="eyebrow">{TYPE_LABELS[selected.type]}</p>
              <p className="mt-1 break-all font-mono text-sm text-slate-100">{selected.label}</p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="rounded-md p-1 text-faint hover:bg-ink-700 hover:text-slate-200"
              aria-label="Close details"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <dl className="mt-3 space-y-2 text-xs">
            {selected.trust && (
              <div className="flex justify-between">
                <dt className="text-faint">Trust</dt>
                <dd
                  className="font-mono uppercase tracking-wide"
                  style={{ color: TRUST_RING[selected.trust] ?? '#8a93a6' }}
                >
                  {selected.trust}
                </dd>
              </div>
            )}
            {selected.scamType && (
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-faint">Scam type</dt>
                <dd className="text-right text-slate-300">{selected.scamType}</dd>
              </div>
            )}
            {selected.type !== 'report' && (
              <div className="flex justify-between">
                <dt className="text-faint">Seen in reports</dt>
                <dd className="font-mono text-slate-300">{selected.reportCount}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-faint">First seen</dt>
              <dd className="font-mono text-slate-300">{selected.firstSeen}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-faint">Last seen</dt>
              <dd className="font-mono text-slate-300">{selected.lastSeen}</dd>
            </div>
          </dl>

          {neighbors.length > 0 && (
            <div className="mt-4">
              <p className="eyebrow">Connected to</p>
              <ul className="mt-2 space-y-1.5">
                {neighbors.slice(0, 10).map((n) => (
                  <li key={n.id} className="flex items-center gap-2 text-xs text-slate-300">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: NODE_COLORS[n.type] }}
                    />
                    <button
                      className="truncate text-left font-mono hover:text-accent"
                      onClick={() => setSelected(n)}
                      title={n.label}
                    >
                      {n.label}
                    </button>
                  </li>
                ))}
                {neighbors.length > 10 && (
                  <li className="text-[11px] text-faint">+{neighbors.length - 10} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
