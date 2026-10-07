'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, type ApiEdge, type ApiNode, type ChatPayload } from '@/lib/api';
import { useRepositoryContext } from '@/components/RepositoryLayout';
import { ChatPanel } from '@/components/ChatPanel';
import { GraphCanvas, type CanvasMode } from '@/components/GraphCanvas';
import { Button } from '@/components/ui/button';

export default function ChatPage() {
  const { repository } = useRepositoryContext();
  const id = repository.id;
  const [canvasPath, setCanvasPath] = useState<string[]>([]);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [split, setSplit] = useState(true);
  const [mode] = useState<CanvasMode>('api');

  function handleViewOnCanvas(payload: ChatPayload) {
    setCanvasPath(payload.canvasPath);
    setFocusNodeId(payload.canvasPath[0] ?? null);
    if (!split) setSplit(true);
  }

  return (
    <div className="chat-page" style={{ height: '100%' }}>
      <div className="chat-toolbar">
        <span className="muted small">
          {split ? 'Answers highlight on the canvas' : 'Canvas hidden'}
        </span>
        <Button type="button" variant="outline" className="btn-outline" onClick={() => setSplit((s) => !s)}>
          {split ? 'Hide canvas' : 'Show canvas'}
        </Button>
      </div>
      <div className={split ? 'chat-split' : 'chat-page'} style={{ minHeight: 0 }}>
        <ChatPanel repositoryId={id} onViewOnCanvas={handleViewOnCanvas} />
        <AnimatePresence initial={false}>
          {split && (
            <motion.div
              key="split-canvas"
              style={{ minWidth: 0, position: 'relative', overflow: 'hidden' }}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <SplitCanvas
                repositoryId={id}
                repositoryBranch={repository.branch}
                indexStatus={repository.indexStatus}
                highlight={canvasPath}
                focusNodeId={focusNodeId}
                mode={mode}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SplitCanvas({
  repositoryId,
  repositoryBranch,
  indexStatus,
  highlight,
  focusNodeId,
  mode,
}: {
  repositoryId: string;
  repositoryBranch: string;
  indexStatus: string;
  highlight: string[];
  focusNodeId: string | null;
  mode: CanvasMode;
}) {
  const [nodes, setNodes] = useState<ApiNode[]>([]);
  const [edges, setEdges] = useState<ApiEdge[]>([]);

  useEffect(() => {
    let active = true;
    void api.graph(repositoryId, { scope: 'full', limit: 1200 }).then((data) => {
      if (!active) return;
      setNodes(data.nodes);
      setEdges(data.edges);
    });
    return () => {
      active = false;
    };
  }, [repositoryId, repositoryBranch]);

  return (
    <>
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        layout="auto"
        mode={mode}
        selectedNodeId={focusNodeId}
        highlightIds={highlight}
        focusNodeId={focusNodeId}
        onSelect={() => undefined}
      />
      <div className="canvas-status" style={{ left: 12, right: 12 }}>
        <div>{highlight.length > 0 ? `${highlight.length} highlighted nodes` : 'Ask a question, then View on Canvas'}</div>
        <div>graph: {indexStatus}</div>
      </div>
    </>
  );
}
