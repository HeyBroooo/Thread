import Link from "next/link";
import { Network } from "lucide-react";
export function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-symbol">
        <Network size={21} strokeWidth={1.8} />
      </span>
      <span>
        archthread<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
