'use client';

import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowUpRight, GitFork } from 'lucide-react';

const PRODUCT = [
  { label: 'Connect', href: '#connect' },
  { label: 'Repositories', href: '#repos' },
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how' },
];

const RESOURCES = [
  { label: 'FAQ', href: '#faq' },
  { label: 'Canvas', href: '#features' },
  { label: 'Grounded chat', href: '#features' },
  { label: 'PR impact', href: '#features' },
];

export function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <div className="lp-footer-brand">
          <Link href="/" className="lp-footer-logo">
            <Image src="/logo-128.png" alt="" width={34} height={34} />
            <span>Codebase Intelligence</span>
          </Link>
          <p className="lp-footer-tag">
            The graph is the product. Evidence on every node, citations on every answer.
          </p>
          <a
            className="lp-footer-social"
            href="https://github.com/HeyBroooo/Thread"
            target="_blank"
            rel="noreferrer"
          >
            <GitFork size={15} strokeWidth={2.2} aria-hidden="true" />
            GitHub
            <ArrowUpRight size={13} strokeWidth={2} aria-hidden="true" />
          </a>
        </div>

        <nav className="lp-footer-cols" aria-label="Footer">
          <div className="lp-footer-col">
            <h4>Product</h4>
            {PRODUCT.map((item) => (
              <a key={item.label} href={item.href}>{item.label}</a>
            ))}
          </div>
          <div className="lp-footer-col">
            <h4>Surfaces</h4>
            {RESOURCES.map((item) => (
              <a key={item.label} href={item.href}>{item.label}</a>
            ))}
          </div>
        </nav>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="lp-footer-bottom"
      >
        <span>© {new Date().getFullYear()} Codebase Intelligence</span>
        <span>GitHub always owns approval and merge.</span>
      </motion.div>
    </footer>
  );
}
