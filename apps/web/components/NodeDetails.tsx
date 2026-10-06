'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FolderTree, MousePointer2, Move } from 'lucide-react';
import { api, type NodeDetailPayload } from '@/lib/api';
import { NODE_COLORS } from './GraphCanvas';

const FLOW_EDGES = new Set(['CALLS', 'USES', 'RENDERS', 'CALLS_API', 'NAVIGATES_TO', 'IMPLEMENTS', 'USES_STORE', 'USES_CONTEXT']);

export function NodeDetails({
  repositoryId,
  nodeId,
  onFocusNode,
}: {
  repositoryId: string;
  nodeId: string | null;
  onFocusNode?: (nodeId: string) => void;
}) {
  const [detail, setDetail] = useState<NodeDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nodeId) {
      setDetail(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    api
      .node(repositoryId, nodeId)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repositoryId, nodeId]);

  return (
    <aside className="panel details-panel">
      <AnimatePresence mode="wait">
        {!nodeId && (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <h3>Node details</h3>
            <p className="muted">Select a node on the canvas to inspect its relationships and source evidence.</p>
            <div className="muted small" style={{ lineHeight: 1.8 }}>
              <div><MousePointer2 size={13} aria-hidden="true" /> <strong>Click</strong> a node to inspect</div>
              <div><Move size={13} aria-hidden="true" /> <strong>Drag</strong> to pan · scroll to zoom</div>
              <div><FolderTree size={13} aria-hidden="true" /> In Tree layout, <strong>click folders</strong> to expand</div>
            </div>
          </motion.div>
        )}

        {loading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="skeleton" style={{ height: 18, width: '55%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 11, width: '80%', marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 11, width: '70%' }} />
          </motion.div>
        )}

        {error && (
          <motion.p key="error" className="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {error}
          </motion.p>
        )}

        {detail && !loading && !error && (
          <motion.div
            key={detail.node.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          >
            <NodeDetailBody detail={detail} onFocusNode={onFocusNode} />
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}

function NodeDetailBody({
  detail,
  onFocusNode,
}: {
  detail: NodeDetailPayload;
  onFocusNode?: (nodeId: string) => void;
}) {
  const { node } = detail;
  const calls = [...detail.outgoing, ...detail.incoming].filter((e) => FLOW_EDGES.has(e.edgeType));

  return (
    <>
      <header className="details-header">
        <span className="type-dot" style={{ background: NODE_COLORS[node.nodeType] ?? '#94a3b8' }} />
        <div>
          <h3 title={node.qualifiedName}>{node.name}</h3>
          <div className="muted small">{node.nodeType}</div>
        </div>
      </header>

      {node.filePath && (
        <div className="detail-block">
          <div className="label">Path</div>
          <code className="path">
            {node.filePath}
            {node.startLine ? `:${node.startLine}–${node.endLine ?? node.startLine}` : ''}
          </code>
        </div>
      )}

      {Object.keys(node.metadata).length > 0 && (
        <div className="detail-block">
          <div className="label">Properties</div>
          <ul className="kv">
            {Object.entries(node.metadata)
              .filter(([, v]) => v !== null && typeof v !== 'object')
              .slice(0, 8)
              .map(([k, v]) => (
                <li key={k}>
                  <span className="muted">{k}</span> {String(v)}
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="detail-block">
        <div className="label">Relationships ({calls.length})</div>
        {calls.length === 0 && <p className="muted small">No flow relationships recorded.</p>}
        <ul className="relationships">
          {calls.slice(0, 25).map((edge) => {
            const outgoing = edge.source === node.id;
            const otherId = outgoing ? edge.target : edge.source;
            return (
              <li key={edge.id}>
                <span className={`edge-badge edge-${edge.edgeType.toLowerCase()}`}>
                  {outgoing ? '→' : '←'} {edge.edgeType}
                </span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onFocusNode?.(otherId)}
                  title={edge.evidence}
                >
                  {otherId === node.id ? node.name : otherId}
                </button>
                <span className="muted small confidence">{Math.round(edge.confidence * 100)}%</span>
                {edge.sourceFile && (
                  <div className="evidence-line">
                    <code>
                      {edge.sourceFile}
                      {edge.sourceLine ? `:${edge.sourceLine}` : ''}
                    </code>{' '}
                    {edge.evidence}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {detail.evidence && (
        <div className="detail-block">
          <div className="label">
            Source —{' '}
            <code>
              {detail.evidence.filePath}:{detail.evidence.startLine}–{detail.evidence.endLine}
            </code>
          </div>
          <pre className="code-snippet">
            {detail.evidence.snippet
              .split('\n')
              .map((line, i) => `${String(detail.evidence!.startLine + i).padStart(4, ' ')}  ${line}`)
              .join('\n')}
          </pre>
        </div>
      )}
    </>
  );
}
