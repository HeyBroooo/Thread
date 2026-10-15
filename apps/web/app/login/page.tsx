"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ShieldCheck,
  GitBranch,
  Code2,
  FileCode2,
  ArrowLeft,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { loginDestination } from "@/lib/auth-redirect";
export default function LoginPage() {
  const router = useRouter();
  const [returnTo, setReturnTo] = useState("/dashboard");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const destination = loginDestination(params.get("from"));
    setReturnTo(destination);
    if (params.has("error"))
      setError("Google sign-in could not be completed. Please try again.");
    void api
      .authSession()
      .then((session) => {
        if (!active) return;
        if (session.authenticated) {
          router.replace(destination);
          router.refresh();
          return;
        }
        setConfigured(session.configured);
        if (!session.configured)
          setError("Google sign-in is not configured on this server yet.");
      })
      .catch(() => {
        if (active)
          setError(
            "The sign-in service is unavailable. Please try again shortly.",
          );
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [router]);
  return (
    <main className="auth-modern">
      <section
        className="auth-showcase"
        aria-label="A connected view of your code"
      >
        <Brand />
        <div className="auth-showcase-copy">
          <span className="auth-kicker">
            <span /> LESS GUESSWORK. MORE CLARITY.
          </span>
          <h1>
            Big ideas.
            <br />
            Connected <em>thinking.</em>
          </h1>
          <p>
            Find the thread between your code, your questions, and what comes
            next.
          </p>
        </div>
        <div className="auth-map" aria-hidden="true">
          <div className="auth-map-toolbar">
            <span>
              <i />
              <i />
              <i />
            </span>
            <span>YOUR CODE, CONNECTED</span>
            <GitBranch size={14} />
          </div>
          <div className="auth-map-body">
            <svg
              className="auth-map-lines"
              viewBox="0 0 540 260"
              fill="none"
              preserveAspectRatio="none"
            >
              <path
                d="M270 65V125M270 125H100V180M270 125H440V180M270 125V180"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="270" cy="125" r="4" fill="#a9edd5" />
            </svg>
            <div className="auth-map-root">
              <span>
                <Code2 size={20} />
              </span>
              <div>
                <strong>your-next-big-idea</strong>
                <small>Everything starts with a connection</small>
              </div>
              <span className="auth-map-dot" />
            </div>
            <div className="auth-map-leaves">
              {[
                {
                  icon: Code2,
                  name: "Application",
                  detail: "The bigger picture",
                },
                {
                  icon: GitBranch,
                  name: "Dependencies",
                  detail: "Follow every thread",
                },
                {
                  icon: FileCode2,
                  name: "Source code",
                  detail: "Grounded in evidence",
                },
              ].map(({ icon: Icon, name, detail }) => (
                <div key={name}>
                  <Icon size={19} />
                  <strong>{name}</strong>
                  <small>{detail}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="auth-map-caption">
            <span className="auth-map-dot" /> One workspace. The whole picture.
            <span>01 / 03</span>
          </div>
        </div>
        <div className="auth-showcase-bottom">
          <span>Built for curious minds.</span>
          <span>Made for your code.</span>
        </div>
      </section>
      <section className="auth-entry">
        <Link href="/" className="auth-back">
          <ArrowLeft size={15} /> Back to home
        </Link>
        <div className="auth-entry-content">
          <div className="auth-entry-symbol">
            <GitBranch size={25} />
          </div>
          <span className="auth-entry-eyebrow">YOUR PERSONAL WORKSPACE</span>
          <h2>
            A little clarity.
            <br />A lot of possibility.
          </h2>
          <p>
            Welcome to archthread. Sign in to see your code in a whole new way.
          </p>
          <div className="auth-google">
            {ready && configured ? (
              <Button asChild size="lg">
                <a
                  href={`/api/auth/google/start?from=${encodeURIComponent(returnTo)}`}
                >
                  <GoogleMark /> Continue with Google <ArrowRight size={16} />
                </a>
              </Button>
            ) : (
              <Button size="lg" disabled>
                <GoogleMark />
                {ready ? "Sign-in unavailable" : "Checking sign-in..."}
              </Button>
            )}
          </div>
          {error && (
            <div className="auth-error" role="alert">
              {error}
              {ready && !configured && (
                <button type="button" onClick={() => window.location.reload()}>
                  Try again
                </button>
              )}
            </div>
          )}
          <div className="auth-reassurance">
            <ShieldCheck size={17} />
            <span>
              One Google sign-in. No extra password.
              <br />
              Your repositories stay private to your account.
            </span>
          </div>
          <div className="auth-demo">
            <span>Want to explore first?</span>
            <Link href="/repositories/demo">
              Take a look around <ArrowRight size={14} />
            </Link>
          </div>
        </div>
        <footer className="auth-entry-footer">
          <span>Your ideas belong here.</span>
          <span>
            Secure by design <ShieldCheck size={13} />
          </span>
        </footer>
      </section>
    </main>
  );
}
function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.61 4.61 0 0 1-2 3.03v2.52h3.24c1.9-1.75 2.98-4.33 2.98-7.38Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.96-.9 6.62-2.39l-3.24-2.52c-.9.6-2.04.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.05v2.6A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.39 13.92a6 6 0 0 1 0-3.84v-2.6H3.05a10 10 0 0 0 0 9.04l3.34-2.6Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.95c1.47 0 2.79.5 3.82 1.5l2.87-2.88A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.48l3.34 2.6A5.99 5.99 0 0 1 12 5.95Z"
        fill="#EA4335"
      />
    </svg>
  );
}
