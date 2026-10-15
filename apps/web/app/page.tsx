"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  GitBranch,
  GitPullRequest,
  Network,
  ScanLine,
  MessagesSquare,
  ShieldCheck,
  Terminal,
  Code2,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { FaqAccordion } from "@/components/ui/faq-accordion";
const features = [
  {
    icon: Network,
    number: "01",
    title: "See the connections.",
    body: "Turn files, functions, and dependencies into a living map. Go from the big picture to the exact line that matters.",
    label: "Explore the canvas",
    path: "canvas",
  },
  {
    icon: MessagesSquare,
    number: "02",
    title: "Ask better questions.",
    body: "Get answers grounded in your actual code. Every explanation comes with the source, so you can follow the evidence.",
    label: "Meet your codebase",
    path: "chat",
  },
  {
    icon: GitPullRequest,
    number: "03",
    title: "Ship with confidence.",
    body: "Understand what a change touches before it lands. Review pull requests with dependency context and validated findings.",
    label: "Explore PR reviews",
    path: "prs",
  },
];
export default function LandingPage() {
  const reduced = useReducedMotion();
  return (
    <div className="marketing">
      <nav className="marketing-nav">
        <Brand />
        <div className="marketing-links">
          <a href="#platform">Platform</a>
          <a href="#workflow">How it works</a>
          <a href="#faq">FAQs</a>
        </div>
        <Button asChild size="sm">
          <Link href="/dashboard">
            Open workspace <ArrowUpRight size={15} />
          </Link>
        </Button>
      </nav>
      <main>
        <section className="marketing-hero">
          <motion.div
            initial={{ opacity: 0, y: reduced ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="announcement">
              <span className="status-dot" /> A little clarity. A lot more
              possibility. <ArrowRight size={13} />
            </div>
            <h1>
              Your codebase.
              <br />
              <span>Finally, connected.</span>
            </h1>
            <p>
              Less searching. More understanding. Turn your repository into a
              living knowledge graph, and build with the whole picture.
            </p>
            <div className="hero-buttons">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Explore your workspace <ArrowUpRight />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/repositories/demo/canvas">
                  <ScanLine /> Take a product tour
                </Link>
              </Button>
            </div>
            <div className="hero-notes">
              <span>
                <Check size={13} /> Sign in once with Google
              </span>
              <span>
                <Check size={13} /> Built on source evidence
              </span>
              <span>
                <Check size={13} /> Open by design
              </span>
            </div>
          </motion.div>
          <motion.div
            className="product-preview"
            initial={{ opacity: 0, y: reduced ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <div className="preview-top">
              <span className="preview-dots">
                <i />
                <i />
                <i />
              </span>
              <span>
                <GitBranch size={12} /> acme / commerce-platform
              </span>
              <span className="preview-live">
                <span className="status-dot" /> Sample workspace
              </span>
            </div>
            <div className="preview-body">
              <aside className="preview-sidebar">
                <Brand />
                <small>WORKSPACE</small>
                <span className="selected">
                  <Network size={14} /> Codebase canvas
                </span>
                <span>
                  <MessagesSquare size={14} /> Grounded chat
                </span>
                <span>
                  <GitPullRequest size={14} /> Pull requests
                </span>
                <div className="preview-side-bottom">
                  <ShieldCheck size={16} /> Every connection.
                  <br />
                  Backed by evidence.
                </div>
              </aside>
              <div className="preview-canvas">
                <div className="preview-canvas-title">
                  <div>
                    <small>YOUR SYSTEM, AT A GLANCE</small>
                    <h3>A clearer view of what you build.</h3>
                  </div>
                  <span className="mini-tag">
                    main <GitBranch size={11} />
                  </span>
                </div>
                <ArchitectureArt />
                <div className="preview-caption">
                  <span>
                    <i className="legend-dot" /> Components{" "}
                    <i className="legend-dot blue" /> Services{" "}
                    <i className="legend-dot peach" /> Data
                  </span>
                  <Link href="/repositories/demo/canvas">
                    Explore the graph <ArrowUpRight size={13} />
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        </section>
        <div className="stack-strip">
          <span>
            Made for the way
            <br />
            <strong>modern teams build.</strong>
          </span>
          <b>
            <Code2 /> TypeScript
          </b>
          <b>◈ React</b>
          <b>Next.js</b>
          <b>
            <Terminal /> Node.js
          </b>
          <b>
            <GitBranch /> GitHub
          </b>
        </div>
        <section id="platform" className="marketing-section">
          <div className="section-intro">
            <span className="eyebrow">CLARITY AT EVERY LAYER</span>
            <h2>
              From scattered files
              <br />
              to shared understanding.
            </h2>
            <p>
              One connected view for exploring, asking, and reviewing.
              <br />
              Your next good decision starts with context.
            </p>
          </div>
          <div className="feature-triptych">
            {features.map((f) => (
              <Link
                href={`/repositories/demo/${f.path}`}
                className="feature-tile"
                key={f.title}
              >
                <div className="feature-top">
                  <f.icon size={23} />
                  <span>{f.number}</span>
                </div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <span className="feature-link">
                  {f.label}
                  <ArrowUpRight size={16} />
                </span>
              </Link>
            ))}
          </div>
        </section>
        <section id="workflow" className="workflow-section">
          <div>
            <span className="eyebrow">SMALL SETUP. BIG PICTURE.</span>
            <h2>
              Meet your codebase.
              <br />
              In three simple steps.
            </h2>
            <Button asChild variant="outline">
              <Link href="/dashboard#connect">
                Connect your repository <ArrowRight />
              </Link>
            </Button>
          </div>
          <ol>
            {[
              [
                "Connect",
                "Bring a GitHub repository into your private workspace. Your code stays the source of truth.",
              ],
              [
                "Understand",
                "Static analysis maps symbols, imports, and relationships into one connected graph.",
              ],
              [
                "Build",
                "Explore the canvas, ask a question, or review a change with the context you need.",
              ],
            ].map(([title, body], i) => (
              <li key={title}>
                <span>0{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section id="faq" className="marketing-section faq-section">
          <div>
            <span className="eyebrow">A FEW GOOD QUESTIONS</span>
            <h2>Curiosity encouraged.</h2>
            <p>Get to know the intelligence behind your code.</p>
          </div>
          <FaqAccordion />
        </section>
        <section className="closing-cta">
          <span className="eyebrow">MAKE ROOM FOR YOUR NEXT IDEA</span>
          <h2>
            Know your code.
            <br />
            Build what’s next.
          </h2>
          <Button asChild size="lg">
            <Link href="/dashboard">
              Enter your workspace <ArrowUpRight />
            </Link>
          </Button>
          <span>Your own workspace. A clearer perspective.</span>
        </section>
      </main>
      <footer className="marketing-footer">
        <Brand />
        <span>Built for people who build.</span>
        <Link href="/dashboard">
          Open workspace <ArrowUpRight size={14} />
        </Link>
      </footer>
    </div>
  );
}
function ArchitectureArt() {
  const nodes = [
    { name: "Application", sub: "src / app", x: 50, y: 17, type: "root" },
    {
      name: "Storefront",
      sub: "React component",
      x: 22,
      y: 44,
      type: "component",
    },
    {
      name: "API gateway",
      sub: "Service layer",
      x: 71,
      y: 44,
      type: "service",
    },
    {
      name: "ProductList",
      sub: "UI component",
      x: 12,
      y: 75,
      type: "component",
    },
    { name: "useCart", sub: "State hook", x: 40, y: 75, type: "component" },
    {
      name: "Products API",
      sub: "GET /products",
      x: 67,
      y: 75,
      type: "service",
    },
    { name: "Database", sub: "Data layer", x: 89, y: 75, type: "data" },
  ];
  return (
    <div
      className="architecture-art"
      aria-label="Illustrative dependency graph"
    >
      <svg viewBox="0 0 1000 330" preserveAspectRatio="none" aria-hidden="true">
        <path d="M500 56 C500 100 220 90 220 145 M500 56 C500 100 710 90 710 145 M220 145 C220 190 120 190 120 248 M220 145 C220 190 400 190 400 248 M710 145 C710 190 670 190 670 248 M710 145 C710 190 890 190 890 248" />
      </svg>
      {nodes.map((n) => (
        <div
          key={n.name}
          className={`graph-art-node ${n.type}`}
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          <span>
            {n.type === "data" ? (
              <Network size={15} />
            ) : n.type === "service" ? (
              <Terminal size={15} />
            ) : (
              <Code2 size={15} />
            )}
          </span>
          <div>
            <b>{n.name}</b>
            <small>{n.sub}</small>
          </div>
        </div>
      ))}
      <span className="graph-evidence">
        <ShieldCheck size={12} /> Source-verified relationships
      </span>
    </div>
  );
}
