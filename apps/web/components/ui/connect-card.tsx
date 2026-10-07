'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { AnimatePresence, motion } from 'framer-motion';
import { Alert, AlertDescription } from './alert';
import { Button } from './button';
import { Input } from './input';
import { ChevronDown } from 'lucide-react';

const GREEN = '#2D7A55';

export function ConnectCard() {
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [checkoutPath, setCheckoutPath] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [connectStage, setConnectStage] = useState<'checking' | 'cloning' | 'done' | null>(null);
  const [access, setAccess] = useState<{
    owner: string;
    name: string;
    appConfigured: boolean;
    accessible: boolean | null;
    requiresInstall: boolean;
    message: string;
  } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const url = repoUrl.trim();
    const canUseParts = owner.trim() && name.trim();
    if (!url && !canUseParts) return;
    setConnecting(true);
    setConnectStage('cloning');
    setAccess(null);
    setError(null);
    try {
      if (url) {
        setConnectStage('checking');
        try {
          setAccess(await api.checkAccess(url));
        } catch {
          setAccess(null);
        }
      }
      setConnectStage('cloning');
      await api.createRepository({
        ...(canUseParts
          ? { owner: owner.trim(), name: name.trim(), ...(branch.trim() ? { branch: branch.trim() } : {}) }
          : { repoUrl: url }),
        ...(branch.trim() && url ? { branch: branch.trim() } : {}),
        ...(checkoutPath.trim() ? { checkoutPath: checkoutPath.trim() } : {}),
      });
      setRepoUrl('');
      setOwner('');
      setName('');
      setBranch('');
      setCheckoutPath('');
      setConnectStage('done');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setConnecting(false);
      setTimeout(() => setConnectStage(null), 1200);
    }
  }

  return (
    <div className="connect-shell">
      <motion.div
        initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '100%',
            background: '#fff',
            borderRadius: '12px',
            border: '1px solid #e2e8e4',
            padding: '28px 28px 24px',
            boxShadow: '0 1px 3px rgba(25,46,34,0.04), 0 8px 24px rgba(25,46,34,0.06)',
          }}
        >
          {/* Header */}
          <div style={{ marginBottom: '20px' }}>
            <h2
              style={{
                fontSize: '20px',
                fontWeight: '700',
                color: '#17231e',
                margin: '0 0 6px',
                letterSpacing: '-0.02em',
              }}
            >
              Connect a repository
            </h2>
            <p
              className="connect-card-copy"
              style={{
                fontSize: '14px',
                color: '#5e6c64',
                margin: '0',
                lineHeight: '1.5',
              }}
            >
              Paste a GitHub URL — we clone it and build the graph. No browser crawl, ever.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={connect} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* URL + Branch row + Connect button */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                alignItems: 'flex-end',
              }}
            >
              {/* Repository URL */}
              <label
                style={{
                  flex: '2 1 240px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  minWidth: '0',
                }}
              >
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: '500',
                    color: '#17231e',
                  }}
                >
                  Repository URL
                </span>
                <Input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/HeyBroooo/cognimail"
                  style={{ width: '100%' }}
                />
              </label>

              {/* Branch */}
              <label
                style={{
                  flex: '1 1 160px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  minWidth: '0',
                }}
              >
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: '500',
                    color: '#17231e',
                  }}
                >
                  Branch (optional)
                </span>
                <Input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="Use repository default"
                  style={{ width: '100%' }}
                />
              </label>

              {/* Connect button — aligned to right of input row */}
              <Button
                type="submit"
                disabled={connecting}
                style={{
                  flex: '0 0 auto',
                  background: GREEN,
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 22px',
                  fontSize: '14px',
                  fontWeight: '700',
                  minWidth: '110px',
                  boxShadow: '0 4px 12px rgba(45,122,85,0.25)',
                  transition: 'background 140ms ease, box-shadow 140ms ease, transform 140ms ease',
                  cursor: connecting ? 'not-allowed' : 'pointer',
                  opacity: connecting ? 0.85 : 1,
                  transform: connecting ? 'none' : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!connecting) {
                    (e.currentTarget as HTMLButtonElement).style.background = '#27684d';
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 18px rgba(45,122,85,0.35)';
                    (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!connecting) {
                    (e.currentTarget as HTMLButtonElement).style.background = GREEN;
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 12px rgba(45,122,85,0.25)';
                    (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                  }
                }}
                onFocus={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.outline = '3px solid rgba(45,122,85,0.2)';
                  (e.currentTarget as HTMLButtonElement).style.outlineOffset = '2px';
                }}
                onBlur={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.outline = 'none';
                }}
              >
                {connecting
                  ? connectStage === 'checking'
                    ? 'Checking access…'
                    : 'Cloning…'
                  : 'Connect'}
              </Button>
            </div>

            {/* Advanced accordion */}
            <div
              style={{
                border: '1px solid #dfe6e0',
                borderRadius: '6px',
                background: '#f8faf8',
                overflow: 'hidden',
                marginTop: '2px',
              }}
            >
              <button
                type="button"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 14px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#5e6c64',
                  fontWeight: '500',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  transition: 'background 140ms ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = '#f0f4f1';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'none';
                }}
                onClick={() => setAdvancedOpen((v) => !v)}
                aria-expanded={advancedOpen}
              >
                <ChevronDown
                  size={14}
                  style={{
                    color: '#5e6c64',
                    transition: 'transform 200ms ease',
                    transform: advancedOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ margin: 0 }}>Advanced</span>
                <span style={{ color: '#87938b', fontWeight: '400' }}>— existing checkout or manual owner/name</span>
              </button>

              <AnimatePresence initial={false}>
                {advancedOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div
                      style={{
                        padding: '4px 14px 14px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '12px',
                      }}
                    >
                      <label
                        style={{
                          flex: '1 1 140px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          minWidth: '0',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '13px',
                            fontWeight: '500',
                            color: '#17231e',
                          }}
                        >
                          Owner
                        </span>
                        <Input
                          value={owner}
                          onChange={(e) => setOwner(e.target.value)}
                          placeholder="acme"
                          style={{ width: '100%' }}
                        />
                      </label>
                      <label
                        style={{
                          flex: '1 1 140px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          minWidth: '0',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '13px',
                            fontWeight: '500',
                            color: '#17231e',
                          }}
                        >
                          Repository
                        </span>
                        <Input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="patient-portal"
                          style={{ width: '100%' }}
                        />
                      </label>
                      <label
                        style={{
                          flex: '1 1 140px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          minWidth: '0',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '13px',
                            fontWeight: '500',
                            color: '#17231e',
                          }}
                        >
                          Local checkout path (optional)
                        </span>
                        <Input
                          value={checkoutPath}
                          onChange={(e) => setCheckoutPath(e.target.value)}
                          placeholder="C:\\code\\patient-portal"
                          style={{ width: '100%' }}
                        />
                      </label>
                    </div>
                    <p
                      style={{
                        margin: '0 0 0 14px',
                        fontSize: '12px',
                        color: '#87938b',
                        lineHeight: '1.5',
                      }}
                    >
                      Without a checkout path the API clones into <code>.cbi/checkouts</code>. If the repository is{' '}
                      private, install the GitHub App on it first.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </form>

          {/* Error alert */}
          {error && (
            <div
              style={{
                marginTop: '14px',
                padding: '12px 14px',
                borderRadius: '6px',
                background: 'rgba(189,69,69,0.08)',
                border: '1px solid rgba(189,69,69,0.25)',
              }}
            >
              <p style={{ margin: 0, fontSize: '13px', color: '#bd4545' }}>{error}</p>
            </div>
          )}

          {/* Stage message */}
          <AnimatePresence initial={false}>
            {connectStage && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                style={{
                  marginTop: '14px',
                  fontSize: '12px',
                  color: '#87938b',
                  transition: 'opacity 200ms ease, transform 200ms ease',
                }}
              >
                {connectStage === 'checking'
                  ? 'Checking whether the GitHub App can access this repository…'
                  : connectStage === 'cloning'
                    ? 'Cloning the repository and building the graph — this runs in the background.'
                    : 'Connected. The graph is building — the repository updates as indexing progresses.'}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Access warning */}
          <AnimatePresence initial={false}>
            {access && access.accessible === false && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                style={{ overflow: 'hidden', marginTop: '12px' }}
              >
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '6px',
                    background: 'rgba(242,196,109,0.07)',
                    border: '1px solid rgba(242,196,109,0.35)',
                  }}
                >
                  <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#795615' }}>{access.message}</p>
                  {access.requiresInstall && (
                    <a
                      href="https://github.com/settings/installations"
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-block',
                        marginTop: '10px',
                        padding: '8px 16px',
                        background: GREEN,
                        color: '#fff',
                        borderRadius: '6px',
                        textDecoration: 'none',
                        fontWeight: '600',
                        fontSize: '13px',
                        boxShadow: '0 4px 12px rgba(45,122,85,0.25)',
                        transition: 'background 140ms ease, transform 140ms ease',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.background = '#27684d';
                        (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-1px)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.background = GREEN;
                        (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(0)';
                      }}
                    >
                      Grant access to {access.owner}/{access.name}
                    </a>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
