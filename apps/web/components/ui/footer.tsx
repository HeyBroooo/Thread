import { motion } from 'framer-motion';

export function Footer() {
  return (
    <footer className="site-footer">
      <motion.p
        className="faint small"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        style={{ margin: 0 }}
      >
        Codebase Intelligence — the graph is the product. GitHub always owns approval and merge.
      </motion.p>
    </footer>
  );
}
