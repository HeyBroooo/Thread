'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessagesSquare } from 'lucide-react';
import { api, type ChatPayload } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

const MotionButton = motion(Button);

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  payload?: ChatPayload;
}

function TypingIndicator() {
  return (
    <motion.div
      className="message assistant"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="bubble">
        <span className="typing-dots">
          <span />
          <span />
          <span />
        </span>
      </div>
    </motion.div>
  );
}

/** Used only if the suggestion service cannot be reached. */
const FALLBACK_SUGGESTIONS = [
  'What are the main entry points of this codebase?',
  'Which modules are the most connected?',
  'How does data flow from the UI to the server?',
  'What is the riskiest part of this codebase to change?',
];

export function ChatPanel({
  repositoryId,
  onViewOnCanvas,
  compact = false,
}: {
  repositoryId: string;
  onViewOnCanvas?: (payload: ChatPayload) => void;
  compact?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Questions come from the indexed graph (routes, endpoints, services …), so
  // they describe *this* codebase instead of a fixed list.
  useEffect(() => {
    let cancelled = false;
    setSuggestionsLoading(true);
    api
      .suggestions(repositoryId)
      .then((payload) => {
        if (cancelled) return;
        setSuggestions(payload.suggestions.slice(0, 4));
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestions(FALLBACK_SUGGESTIONS);
      })
      .finally(() => {
        if (!cancelled) setSuggestionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repositoryId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const payload = await api.chat(repositoryId, trimmed);
      setMessages((prev) => [...prev, { role: 'assistant', text: payload.answer, payload }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`chat-panel ${compact ? 'compact' : ''}`}>
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && !busy && (
          <motion.div
            className="empty-state"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <div className="empty-state-icon">
              <MessagesSquare size={24} strokeWidth={1.6} aria-hidden="true" />
            </div>
            <h3>Ask about this codebase</h3>
            <p className="muted" style={{ lineHeight: 1.6 }}>
              Answers are grounded in the indexed graph and cite exact files and line ranges —
              nothing is guessed.
            </p>
            <div className="suggestions">
              {suggestionsLoading
                ? [0, 1, 2].map((i) => (
                    <Skeleton key={i} style={{ width: 180, height: 32, borderRadius: 999 }} />
                  ))
                : suggestions.map((s) => (
                    <MotionButton
                      key={s}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="chip suggestions-chip"
                      onClick={() => void send(s)}
                      whileHover={{ x: 3 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ duration: 0.15 }}
                    >
                      {s}
                    </MotionButton>
                  ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              className={`message ${m.role}`}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="ui-card bubble">
                <div className="message-text">{m.text}</div>
                {m.payload && m.payload.references.length > 0 && (
                  <div className="references">
                    <div className="label">References</div>
                    {m.payload.references.map((r, j) => (
                      <MotionButton
                        key={j}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="reference"
                        onClick={() => onViewOnCanvas?.(m.payload!)}
                        title={r.snippet}
                        whileHover={{ x: 2 }}
                        transition={{ duration: 0.15 }}
                      >
                        <code>
                          {r.filePath}:{r.startLine}–{r.endLine}
                        </code>
                        {r.symbol ? <span className="muted"> · {r.symbol}</span> : null}
                      </MotionButton>
                    ))}
                  </div>
                )}
                {m.payload && (
                  <div className="meta">
                    <span>confidence {(m.payload.confidence * 100).toFixed(0)}%</span>
                    {m.payload.unverified && <span>· unverified</span>}
                    {m.payload.partial && <span>· partial graph</span>}
                    {m.payload.canvasPath.length > 0 && onViewOnCanvas && (
                      <Button type="button" variant="link" size="sm" className="link-button" onClick={() => onViewOnCanvas(m.payload!)}>
                        View on Canvas →
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          {busy && <TypingIndicator key="typing" />}
        </AnimatePresence>

        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <Alert variant="destructive">{error}</Alert>
          </motion.div>
        )}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Ask about this codebase"
          placeholder="Ask about this codebase…"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || input.trim().length === 0} className="btn-primary">Ask</Button>
      </form>
    </div>
  );
}
